import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { marked } from 'marked';
import { hubAPI, notesAPI } from '../api';

/*
 * AI Hub chat state and streaming, shared by every style's AI Hub screen.
 * Chats are saved in this device's localStorage; answers stream from /ai/hub/chat.
 */
const STORE_KEY = 'peblo-ai-hub-v1';
const MODEL_KEY = 'peblo-ai-hub-model';
const API_BASE = import.meta.env.VITE_API_URL || '/api';

export const STARTERS = [
  'Plan my day from my tasks and deadlines',
  'What did I write about this week?',
  'Summarise my notes tagged #exams',
  'What should I do first today?',
];

function load(key, fallback) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
}
function save(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage full or blocked */ }
}
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Markdown → HTML with [n] turned into clickable citation pills (only for sources that exist). */
export function renderAnswer(text, sourceCount) {
  const html = marked.parse(escapeHtml(text || ''), { breaks: true });
  return html.replace(/\[(\d{1,2})\]/g, (m, n) => {
    const i = Number(n);
    return i >= 1 && i <= sourceCount ? `<button type="button" class="pb-cite" data-cite="${i}">${i}</button>` : m;
  });
}

export function groupLabel(ts) {
  const d = new Date(ts);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  if (d >= today) return 'Today';
  if (d >= new Date(today.getTime() - 6 * 86400000)) return 'This week';
  return 'Earlier';
}



export default function useHubChat() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [chats, setChats] = useState(() => load(STORE_KEY, []));
  const [activeId, setActiveId] = useState(() => load(STORE_KEY, [])[0]?.id || null);
  const [input, setInput] = useState('');
  const [attached, setAttached] = useState([]); // [{id,title}]
  const [streaming, setStreaming] = useState(false);
  const [focusedSource, setFocusedSource] = useState(null);
  const [modelChoice, setModelChoice] = useState(() => load(MODEL_KEY, null)); // {provider, model} | null = automatic
  const abortRef = useRef(null);
  const threadRef = useRef(null);
  const inputRef = useRef(null);

  const { data: models } = useQuery({ queryKey: ['hub-models'], queryFn: () => hubAPI.models().then((r) => r.data), staleTime: 15000 });
  const { data: allNotes = [] } = useQuery({
    queryKey: ['notes', 'sidebar'],
    queryFn: () => notesAPI.getAll({ sort: 'updated' }).then((r) => r.data.notes || []),
  });

  useEffect(() => { save(STORE_KEY, chats.slice(0, 60)); }, [chats]);
  useEffect(() => { save(MODEL_KEY, modelChoice); }, [modelChoice]);

  const active = chats.find((c) => c.id === activeId) || null;
  const lastAssistant = active ? [...active.messages].reverse().find((m) => m.role === 'assistant') : null;
  const panelSources = lastAssistant?.sources || [];

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: streaming ? 'auto' : 'smooth' });
  }, [active?.messages, streaming]);

  // Model picker options
  const local = models?.local;
  const routing = models?.routing || 'auto';
  const localModels = local?.enabled && local?.ok ? (local.models.length ? local.models : [local.chatModel]).filter((m) => !/embed/i.test(m)) : [];
  const cloudModels = (models?.cloud || []).filter((c) => c.configured);
  const noAI = !localModels.length && !cloudModels.length;

  const currentModelLabel = modelChoice
    ? { name: modelChoice.model, kind: modelChoice.provider === 'ollama' ? 'local' : 'cloud' }
    : localModels.length && (routing === 'ollama' || routing === 'ask' || !cloudModels.length)
      ? { name: local.chatModel, kind: 'local', auto: true }
      : cloudModels.length && routing !== 'ollama'
        ? { name: cloudModels[0].model, kind: 'cloud', auto: true }
        : { name: 'No model', kind: 'off', auto: true };

  const updateChat = useCallback((id, fn) => {
    setChats((list) => list.map((c) => (c.id === id ? fn(c) : c)));
  }, []);

  const send = useCallback(async (text, opts = {}) => {
    // opts.history (retry / regenerate) already ends with the user's message.
    const content = opts.history ? opts.history[opts.history.length - 1]?.content : (text ?? input).trim();
    if (!content || streaming) return;

    let chatId = activeId;
    let history = active?.messages || [];
    if (!active || opts.newChat) {
      chatId = uid();
      history = [];
      const chat = { id: chatId, title: content.slice(0, 60), createdAt: Date.now(), updatedAt: Date.now(), messages: [] };
      setChats((list) => [chat, ...list]);
      setActiveId(chatId);
    }

    const att = opts.attached || attached;
    const userMsg = { id: uid(), role: 'user', content, attached: att };
    const botId = uid();
    const bot = { id: botId, role: 'assistant', content: '', sources: [], status: 'thinking', startedAt: Date.now() };
    const baseHistory = opts.history || [...history, userMsg];
    updateChat(chatId, (c) => ({ ...c, updatedAt: Date.now(), messages: [...baseHistory, bot] }));
    if (!opts.history) setInput('');
    setStreaming(true);
    setFocusedSource(null);

    const controller = new AbortController();
    abortRef.current = controller;
    const payload = {
      messages: baseHistory.map((m) => ({ role: m.role, content: m.content })),
      noteIds: (opts.history ? (opts.history[opts.history.length - 1]?.attached || []) : att).map((n) => n.id),
      allowCloud: !!opts.allowCloud,
      ...(modelChoice ? { provider: modelChoice.provider, model: modelChoice.model } : {}),
    };

    const patchBot = (fn) => updateChat(chatId, (c) => ({ ...c, messages: c.messages.map((m) => (m.id === botId ? fn(m) : m)) }));

    try {
      const res = await fetch(`${API_BASE}/ai/hub/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop();
        for (const part of parts) {
          if (!part.startsWith('data: ')) continue;
          const ev = JSON.parse(part.slice(6));
          if (ev.type === 'sources') patchBot((m) => ({ ...m, sources: ev.sources, searched: ev.searched, excludedPrivate: ev.excludedPrivate }));
          else if (ev.type === 'delta') patchBot((m) => ({ ...m, status: 'streaming', content: m.content + ev.text }));
          else if (ev.type === 'done') patchBot((m) => ({ ...m, status: 'done', meta: { provider: ev.provider, model: ev.model, local: ev.local, ms: ev.ms } }));
          else if (ev.type === 'consent') patchBot((m) => ({ ...m, status: 'consent', consent: { provider: ev.provider, message: ev.message }, userText: content }));
          else if (ev.type === 'error') patchBot((m) => ({ ...m, status: 'error', error: ev.message, code: ev.code }));
        }
      }
      patchBot((m) => (m.status === 'streaming' || m.status === 'thinking' ? { ...m, status: 'done' } : m));
    } catch (err) {
      if (controller.signal.aborted) patchBot((m) => ({ ...m, status: 'stopped' }));
      else patchBot((m) => ({ ...m, status: 'error', error: 'Could not reach Peblo. Is the app still running?' }));
    } finally {
      setStreaming(false);
      abortRef.current = null;
      setAttached([]);
    }
  }, [input, streaming, activeId, active, attached, modelChoice, updateChat]);

  // ?q=… from Home / command palette starts a new chat
  useEffect(() => {
    const q = params.get('q');
    if (q && !streaming) {
      const note = params.get('note');
      const opts = { newChat: true };
      if (note) opts.attached = [{ id: note, title: params.get('noteTitle') || 'Note' }];
      setParams({}, { replace: true });
      send(q, opts);
    }
  }, [params]); // eslint-disable-line react-hooks/exhaustive-deps

  const newChat = () => { setActiveId(null); setInput(''); setAttached([]); inputRef.current?.focus(); };
  const deleteChat = (id) => {
    setChats((list) => list.filter((c) => c.id !== id));
    if (id === activeId) setActiveId(null);
  };

  // Re-run the question that produced `msg`, optionally with consent to use a cloud model.
  const rerun = (msg, extra = {}) => {
    const idx = active.messages.findIndex((m) => m.id === msg.id);
    const history = active.messages.slice(0, idx);
    if (!history.length || history[history.length - 1].role !== 'user') return;
    send(null, { history, ...extra });
  };
  const retryWithCloud = (msg) => rerun(msg, { allowCloud: true });
  const regenerate = (msg) => rerun(msg);

  const saveAsNote = async (msg) => {
    const idx = active.messages.findIndex((m) => m.id === msg.id);
    const question = active.messages.slice(0, idx).reverse().find((m) => m.role === 'user')?.content || 'AI answer';
    const refs = (msg.sources || []).map((s) => `${s.n}. ${s.title}`).join('\n');
    const { data } = await notesAPI.create({
      title: question.slice(0, 80),
      content: msg.content + (refs ? `\n\n---\n**Sources**\n\n${refs}` : ''),
      tags: ['ai'],
    });
    queryClient.invalidateQueries({ queryKey: ['notes'] });
    navigate(`/notes/${data.note.id}`);
  };

  const privacyLine = currentModelLabel.kind === 'local'
    ? { cls: 'local', text: 'Runs on this device. Nothing leaves your computer.' }
    : currentModelLabel.kind === 'cloud'
      ? { cls: 'cloud', text: `Your question and matching notes go to ${currentModelLabel.name}.` }
      : { cls: 'off', text: 'No AI model is set up yet.' };

  const stop = () => abortRef.current?.abort();

  return {
    chats, activeId, setActiveId, active, input, setInput, attached, setAttached, streaming,
    focusedSource, setFocusedSource, modelChoice, setModelChoice, models, allNotes,
    local, routing, localModels, cloudModels, noAI, currentModelLabel, lastAssistant, panelSources,
    send, stop, newChat, deleteChat, retryWithCloud, regenerate, saveAsNote, privacyLine,
    threadRef, inputRef,
  };
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { marked } from 'marked';
import {
  Sparkles, Plus, ArrowUp, Square, ChevronDown, PanelRight, Lock, FileText, CheckSquare,
  CalendarDays, Copy, RotateCcw, FilePlus2, X, Cloud, Trash2, Search,
} from 'lucide-react';
import { hubAPI, notesAPI } from '../api';
import '../styles/ai-hub.css';

const STORE_KEY = 'peblo-ai-hub-v1';
const MODEL_KEY = 'peblo-ai-hub-model';
const API_BASE = import.meta.env.VITE_API_URL || '/api';

const STARTERS = [
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
function renderAnswer(text, sourceCount) {
  const html = marked.parse(escapeHtml(text || ''), { breaks: true });
  return html.replace(/\[(\d{1,2})\]/g, (m, n) => {
    const i = Number(n);
    return i >= 1 && i <= sourceCount ? `<button type="button" class="pb-cite" data-cite="${i}">${i}</button>` : m;
  });
}

function groupLabel(ts) {
  const d = new Date(ts);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  if (d >= today) return 'Today';
  if (d >= new Date(today.getTime() - 6 * 86400000)) return 'This week';
  return 'Earlier';
}

const SOURCE_ICON = { note: FileText, task: CheckSquare, agenda: CalendarDays };

export default function AIHubPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [chats, setChats] = useState(() => load(STORE_KEY, []));
  const [activeId, setActiveId] = useState(() => load(STORE_KEY, [])[0]?.id || null);
  const [input, setInput] = useState('');
  const [attached, setAttached] = useState([]); // [{id,title}]
  const [streaming, setStreaming] = useState(false);
  const [showSources, setShowSources] = useState(true);
  const [focusedSource, setFocusedSource] = useState(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);
  const [attachQuery, setAttachQuery] = useState('');
  const [chatFilter, setChatFilter] = useState('');
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

  const onThreadClick = (e) => {
    const btn = e.target.closest('[data-cite]');
    if (!btn) return;
    setShowSources(true);
    setFocusedSource(Number(btn.dataset.cite));
    document.getElementById(`src-${btn.dataset.cite}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };

  const grouped = useMemo(() => {
    const out = {};
    for (const c of chats.filter((x) => !chatFilter || x.title.toLowerCase().includes(chatFilter.toLowerCase()))) {
      const g = groupLabel(c.updatedAt);
      (out[g] = out[g] || []).push(c);
    }
    return ['Today', 'This week', 'Earlier'].filter((g) => out[g]).map((g) => [g, out[g]]);
  }, [chats, chatFilter]);

  const attachMatches = allNotes
    .filter((n) => !attached.find((a) => a.id === n.id))
    .filter((n) => !attachQuery || (n.title || '').toLowerCase().includes(attachQuery.toLowerCase()))
    .slice(0, 6);

  const privacyLine = currentModelLabel.kind === 'local'
    ? { cls: 'local', text: 'Runs on this device. Nothing leaves your computer.' }
    : currentModelLabel.kind === 'cloud'
      ? { cls: 'cloud', text: `Your question and matching notes go to ${currentModelLabel.name}.` }
      : { cls: 'off', text: 'No AI model is set up yet.' };

  return (
    <div className="hub">
      {/* Conversations */}
      <section className="hub-convs" aria-label="Conversations">
        <div className="pb-topbar" style={{ padding: '0 12px 0 18px' }}>
          <span className="title grow">AI Hub</span>
          <button type="button" className="pb-btn primary sm" onClick={newChat}><Plus size={13} strokeWidth={2.4} /> New chat</button>
        </div>
        <div style={{ padding: '12px 12px 6px 12px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div className="pb-seg" style={{ display: 'flex' }}>
            <button type="button" className="on">Chats</button>
            <Link to="/ai/connections">Connections</Link>
          </div>
          <label className="hub-search">
            <Search size={14} />
            <span className="sr-only">Search chats</span>
            <input value={chatFilter} onChange={(e) => setChatFilter(e.target.value)} placeholder="Search chats" />
          </label>
        </div>
        <div className="hub-conv-list">
          {grouped.length === 0 && <p className="pb-muted" style={{ padding: '8px 12px', fontSize: 12.5 }}>Your chats are saved on this device.</p>}
          {grouped.map(([label, items]) => (
            <div key={label}>
              <div className="pb-section-label" style={{ padding: '10px 10px 4px' }}>{label}</div>
              {items.map((c) => {
                const meta = [...c.messages].reverse().find((m) => m.meta)?.meta;
                return (
                  <div key={c.id} className={`hub-conv${c.id === activeId ? ' on' : ''}`}>
                    <button type="button" className="hub-conv-main" onClick={() => setActiveId(c.id)}>
                      <span className="t">{c.title}</span>
                      <span className="m">
                        <span className={`pb-dot ${meta ? (meta.local ? 'local' : 'cloud') : 'off'}`} />
                        {meta ? `${meta.model} · ${meta.local ? 'Local' : 'Cloud'}` : 'No answer yet'}
                      </span>
                    </button>
                    <button type="button" className="pb-icon-btn hub-conv-del" aria-label={`Delete chat "${c.title}"`} onClick={() => deleteChat(c.id)}><Trash2 size={13} /></button>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </section>

      {/* Chat */}
      <section className="hub-chat" aria-label="Chat">
        <div className="pb-topbar" style={{ padding: '0 14px 0 20px' }}>
          <div className="hub-picker">
            <button type="button" className="pb-btn" aria-haspopup="listbox" aria-expanded={pickerOpen} onClick={() => setPickerOpen((v) => !v)}>
              <span className={`pb-dot ${currentModelLabel.kind}`} />
              {currentModelLabel.name}
              {currentModelLabel.kind !== 'off' && <span className={`pb-badge ${currentModelLabel.kind}`}>{currentModelLabel.kind === 'local' ? 'Local' : 'Cloud'}</span>}
              {currentModelLabel.auto && currentModelLabel.kind !== 'off' && <span className="pb-muted" style={{ fontSize: 11.5 }}>auto</span>}
              <ChevronDown size={14} color="var(--pb-fg-3)" />
            </button>
            {pickerOpen && (
              <div className="hub-picker-menu" role="listbox">
                <button type="button" role="option" aria-selected={!modelChoice} className={!modelChoice ? 'on' : ''} onClick={() => { setModelChoice(null); setPickerOpen(false); }}>
                  <span className="t">Automatic</span>
                  <span className="m">Follows your setting in Connections</span>
                </button>
                <div className="hub-picker-label">On this device</div>
                {localModels.length ? localModels.map((m) => (
                  <button key={m} type="button" role="option" aria-selected={modelChoice?.model === m} className={modelChoice?.model === m ? 'on' : ''} onClick={() => { setModelChoice({ provider: 'ollama', model: m }); setPickerOpen(false); }}>
                    <span className="t"><span className="pb-dot local" /> {m} <span className="pb-badge local">Local</span></span>
                    <span className="m">Private · works offline</span>
                  </button>
                )) : <p className="hub-picker-empty">{local?.enabled ? 'Ollama is not running.' : 'Local AI is off.'} <Link to="/ai/connections">Set up</Link></p>}
                <div className="hub-picker-label">Cloud · your question and sources are sent</div>
                {cloudModels.length ? cloudModels.map((c) => (
                  <button key={c.provider} type="button" role="option" aria-selected={modelChoice?.provider === c.provider} className={modelChoice?.provider === c.provider ? 'on' : ''} disabled={routing === 'ollama'} onClick={() => { setModelChoice({ provider: c.provider, model: c.model }); setPickerOpen(false); }}>
                    <span className="t"><span className="pb-dot cloud" /> {c.model} <span className="pb-badge cloud">Cloud</span></span>
                    <span className="m">{routing === 'ollama' ? 'Off: your setting is Local only' : `${c.label} · your key`}</span>
                  </button>
                )) : <p className="hub-picker-empty">No cloud keys. <Link to="/ai/connections">Add one</Link></p>}
              </div>
            )}
          </div>
          <span className="title grow" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{active?.title || 'New chat'}</span>
          <button type="button" className={`pb-btn ${showSources ? 'soft' : ''}`} onClick={() => setShowSources((v) => !v)} aria-pressed={showSources}>
            <PanelRight size={14} /> Sources{panelSources.length ? ` · ${panelSources.length}` : ''}
          </button>
        </div>

        <div className="hub-thread" ref={threadRef} onClick={onThreadClick}>
          {!active || active.messages.length === 0 ? (
            <div className="hub-welcome">
              <div className="hub-welcome-icon"><Sparkles size={22} /></div>
              <h1 className="pb-display">Ask your notes anything.</h1>
              <p className="pb-muted">Answers come from your notes, tasks and calendar, with numbered sources you can check.</p>
              {noAI ? (
                <Link to="/ai/connections" className="pb-btn primary">Set up a model</Link>
              ) : (
                <div className="hub-starters">
                  {STARTERS.map((s) => <button key={s} type="button" className="pb-chip" onClick={() => send(s, { newChat: true })}>{s}</button>)}
                </div>
              )}
            </div>
          ) : (
            active.messages.map((m) => (m.role === 'user' ? (
              <div key={m.id} className="hub-user">
                {m.content}
                {m.attached?.length > 0 && <div className="hub-user-att">{m.attached.map((a) => <span key={a.id}>{a.title}</span>)}</div>}
              </div>
            ) : (
              <div key={m.id} className="hub-bot">
                <div className="hub-bot-avatar"><Sparkles size={16} /></div>
                <div className="hub-bot-body">
                  <div className="hub-bot-meta">
                    {m.meta ? (
                      <>
                        <strong>{m.meta.model}</strong>
                        <span className={`pb-badge ${m.meta.local ? 'local' : 'cloud'}`}>{m.meta.local ? 'Local' : 'Cloud'}</span>
                        <span>· {m.sources?.length || 0} source{m.sources?.length === 1 ? '' : 's'} · {(m.meta.ms / 1000).toFixed(1)} s</span>
                      </>
                    ) : m.status === 'thinking' ? (
                      <span>Searching your notes{m.sources?.length ? ` · found ${m.sources.length}` : ''}…</span>
                    ) : m.status === 'streaming' ? (
                      <span>Writing · {m.sources?.length || 0} sources</span>
                    ) : null}
                  </div>

                  {m.content && <div className="hub-md" dangerouslySetInnerHTML={{ __html: renderAnswer(m.content, m.sources?.length || 0) }} />}
                  {m.status === 'thinking' && <div className="hub-typing"><span /><span /><span /></div>}

                  {m.status === 'consent' && (
                    <div className="hub-card warn">
                      <div className="hub-card-head"><Cloud size={16} /> <strong>Use a cloud model for this answer?</strong><span className="pb-badge warn">Needs your OK</span></div>
                      <p>{m.consent.message}</p>
                      <div className="hub-card-actions">
                        <button type="button" className="pb-btn primary sm" onClick={() => retryWithCloud(m)}>Yes, just this once</button>
                        <Link to="/ai/connections" className="pb-btn sm">Set up Local AI</Link>
                      </div>
                    </div>
                  )}
                  {m.status === 'error' && (
                    <div className="hub-card danger">
                      <p style={{ margin: 0 }}>{m.error}</p>
                      <div className="hub-card-actions">
                        <button type="button" className="pb-btn sm" onClick={() => regenerate(m)}><RotateCcw size={13} /> Try again</button>
                        <Link to="/ai/connections" className="pb-btn ghost sm">Check connections</Link>
                      </div>
                    </div>
                  )}
                  {m.status === 'stopped' && <p className="pb-muted" style={{ fontSize: 12 }}>Stopped.</p>}

                  {m.status === 'done' && m.content && (
                    <div className="hub-actions">
                      <button type="button" className="pb-btn sm" onClick={() => saveAsNote(m)}><FilePlus2 size={13} /> Save as note</button>
                      <button type="button" className="pb-btn ghost sm" onClick={() => navigator.clipboard?.writeText(m.content)}><Copy size={13} /> Copy</button>
                      <button type="button" className="pb-btn ghost sm" onClick={() => regenerate(m)}><RotateCcw size={13} /> Regenerate</button>
                    </div>
                  )}
                </div>
              </div>
            )))
          )}
        </div>

        <div className="hub-composer-wrap">
          <form className="hub-composer" onSubmit={(e) => { e.preventDefault(); send(); }}>
            {(attached.length > 0 || attachOpen) && (
              <div className="hub-chips">
                {attached.map((a) => (
                  <span key={a.id} className="pb-chip on">
                    <FileText size={12} /> {a.title}
                    <button type="button" aria-label={`Remove ${a.title}`} onClick={() => setAttached((l) => l.filter((x) => x.id !== a.id))}><X size={12} /></button>
                  </span>
                ))}
              </div>
            )}
            {attachOpen && (
              <div className="hub-attach">
                <input autoFocus value={attachQuery} onChange={(e) => setAttachQuery(e.target.value)} placeholder="Find a note to attach…" aria-label="Find a note to attach" />
                {attachMatches.map((n) => (
                  <button key={n.id} type="button" onClick={() => { setAttached((l) => [...l, { id: n.id, title: n.title || 'Untitled' }]); setAttachOpen(false); setAttachQuery(''); }}>
                    <FileText size={13} /> {n.title || 'Untitled'}
                  </button>
                ))}
              </div>
            )}
            <label htmlFor="hub-input" className="sr-only">Message</label>
            <textarea
              id="hub-input"
              ref={inputRef}
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
              placeholder={active?.messages.length ? 'Ask a follow-up…' : 'Ask about your notes, tasks and calendar…'}
            />
            <div className="hub-composer-foot">
              <span className={`hub-privacy ${privacyLine.cls}`}><Lock size={13} /> {privacyLine.text}</span>
              <button type="button" className="pb-btn ghost sm" onClick={() => setAttachOpen((v) => !v)}><Plus size={13} /> Attach note</button>
              {streaming ? (
                <button type="button" className="hub-send" aria-label="Stop" onClick={() => abortRef.current?.abort()}><Square size={13} fill="currentColor" /></button>
              ) : (
                <button type="submit" className="hub-send" aria-label="Send" disabled={!input.trim()}><ArrowUp size={16} strokeWidth={2.4} /></button>
              )}
            </div>
          </form>
        </div>
      </section>

      {/* Sources */}
      {showSources && (
        <aside className="hub-sources" aria-label="Sources used">
          <div className="pb-topbar" style={{ padding: '0 16px 0 18px' }}>
            <span className="title grow">Sources used</span>
            {panelSources.length > 0 && <span className="pb-badge accent">{panelSources.length}</span>}
          </div>
          <div className="hub-sources-list">
            {lastAssistant?.searched && (
              <div className="hub-src-note">
                <strong>Found by local search</strong><br />
                Searched {lastAssistant.searched.notes} notes and {lastAssistant.searched.tasks} open tasks on this device.
              </div>
            )}
            {panelSources.length === 0 ? (
              <p className="pb-muted" style={{ fontSize: 12.5, lineHeight: 1.5 }}>When you ask something, the notes, tasks and deadlines the answer used show up here, so you can check them.</p>
            ) : panelSources.map((s) => {
              const Icon = SOURCE_ICON[s.kind] || FileText;
              return (
                <div key={s.n} id={`src-${s.n}`} className={`hub-src${focusedSource === s.n ? ' focus' : ''}`}>
                  <div className="hub-src-head"><span className="pb-cite" style={{ cursor: 'default' }}>{s.n}</span><Icon size={14} color="var(--pb-fg-3)" /><span className="t">{s.title}</span></div>
                  <span className="pb-muted" style={{ fontSize: 11.5 }}>{s.meta}</span>
                  {s.snippet && <span className="hub-src-snip">{s.snippet}</span>}
                  {s.kind === 'note' && s.id && <Link to={`/notes/${s.id}`} className="pb-link">Open note</Link>}
                  {s.kind !== 'note' && <Link to="/tasks" className="pb-link">Open tasks</Link>}
                </div>
              );
            })}
          </div>
          {lastAssistant?.excludedPrivate > 0 && (
            <div className="hub-sources-foot"><Lock size={13} /> {lastAssistant.excludedPrivate} note{lastAssistant.excludedPrivate === 1 ? '' : 's'} tagged #private left out</div>
          )}
        </aside>
      )}
    </div>
  );
}

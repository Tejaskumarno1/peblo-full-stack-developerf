import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import {
  Sparkles,
  Send,
  FilePlus,
  FilePen,
  X,
  User,
  FileText,
  ArrowUpRight,
} from 'lucide-react';
import { marked } from 'marked';
import { aiAPI, notesAPI } from '../api/index';
import '../styles/ai-chat.css';

const SUGGESTIONS = [
  { label: 'Sprint planning notes', prompt: 'Create meeting notes for sprint planning with action items' },
  { label: 'Grocery & meal prep', prompt: 'Add a grocery list note and a meal prep ideas note' },
  { label: 'React performance research', prompt: 'Write research notes on React performance tips' },
];

function TypingIndicator() {
  return (
    <div className="ai-chat-msg-row assistant">
      <div className="ai-chat-avatar assistant">
        <Sparkles size={14} />
      </div>
      <div className="ai-chat-bubble">
        <div className="ai-chat-typing-dots" aria-label="AI is thinking">
          <span />
          <span />
          <span />
        </div>
      </div>
    </div>
  );
}

export default function AiChatPanel() {
  const navigate = useNavigate();
  const [mounted, setMounted] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [hasChatted, setHasChatted] = useState(false);
  const [input, setInput] = useState('');
  const [mode, setMode] = useState('create');
  const [noteOptions, setNoteOptions] = useState([]);
  const [selectedNoteId, setSelectedNoteId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const listRef = useRef(null);
  const inputRef = useRef(null);

  const loadNotes = useCallback(() => {
    notesAPI
      .getAll({ sort: 'updated' })
      .then((res) => {
        const notes = res.data.notes || [];
        setNoteOptions(notes);
        setSelectedNoteId((prev) =>
          prev && notes.some((n) => n.id === prev) ? prev : notes[0]?.id || ''
        );
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (isOpen) loadNotes();
  }, [isOpen, loadNotes]);

  useEffect(() => {
    if (!isOpen) return;
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, loading, isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const t = setTimeout(() => inputRef.current?.focus(), 200);
    return () => clearTimeout(t);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e) => {
      if (e.key === 'Escape') setIsOpen(false);
    };
    const onShortcut = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        setIsOpen((o) => !o);
      }
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('keydown', onShortcut);
    document.body.style.overflow = window.innerWidth <= 520 ? 'hidden' : '';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('keydown', onShortcut);
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  const resizeTextarea = () => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  };

  const sendMessage = async (text) => {
    const trimmed = (text ?? input).trim();
    if (!trimmed || loading) return;

    if (mode === 'append' && !selectedNoteId) {
      setError('Pick a note below, or switch to “New notes”.');
      return;
    }

    setError('');
    setInput('');
    if (inputRef.current) inputRef.current.style.height = 'auto';
    setHasChatted(true);
    setMessages((prev) => [...prev, { role: 'user', text: trimmed }]);
    setLoading(true);

    try {
      const res = await aiAPI.chat({
        message: trimmed,
        mode,
        noteId: mode === 'append' ? selectedNoteId : undefined,
      });

      const { reply, notes, updatedNote } = res.data;
      const links = [];

      if (updatedNote) {
        links.push({ id: updatedNote.id, title: updatedNote.title, kind: 'updated' });
        window.dispatchEvent(new CustomEvent('note-updated', { detail: updatedNote }));
      }
      for (const n of notes || []) {
        links.push({ id: n.id, title: n.title, kind: 'created' });
      }

      setMessages((prev) => [...prev, { role: 'assistant', text: reply, links }]);
      loadNotes();
    } catch (err) {
      const msg =
        err.response?.data?.error ||
        'Could not reach AI. Check your connection and GEMINI_API_KEY in server/.env.';
      setError(msg);
      setMessages((prev) => [...prev, { role: 'assistant', text: msg, isError: true }]);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const showWelcome = !hasChatted && messages.length === 0;

  if (!mounted) return null;

  return createPortal(
    <div className="ai-chat-root">
      <button
        type="button"
        className={`ai-chat-fab ${isOpen ? 'is-open' : ''}`}
        onClick={() => setIsOpen(true)}
        aria-label="Open AI Note Assistant"
        aria-expanded={isOpen}
        title="AI Assistant (Ctrl+Shift+A)"
      >
        <span className="ai-chat-fab-icon-wrap">
          <Sparkles size={20} strokeWidth={2.25} />
        </span>
        <span>AI Assistant</span>
        <kbd className="ai-chat-fab-kbd">⇧⌘A</kbd>
      </button>

      {isOpen && (
        <div className="ai-chat-overlay" role="presentation" onClick={() => setIsOpen(false)}>
          <section
            className="ai-chat-window"
            role="dialog"
            aria-labelledby="ai-chat-title"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="ai-chat-header">
              <div className="ai-chat-header-top">
                <div className="ai-chat-brand">
                  <div className="ai-chat-brand-icon">
                    <Sparkles size={20} />
                  </div>
                  <div>
                    <h2 id="ai-chat-title" className="ai-chat-window-title">
                      AI Note Assistant
                    </h2>
                    <p className="ai-chat-subtitle">Describe what to capture — I&apos;ll create or update notes</p>
                  </div>
                </div>
                <button
                  type="button"
                  className="ai-chat-close"
                  onClick={() => setIsOpen(false)}
                  aria-label="Close chat"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="ai-chat-mode" role="tablist" aria-label="Note mode">
                <button
                  type="button"
                  role="tab"
                  aria-selected={mode === 'create'}
                  className={`ai-chat-mode-btn ${mode === 'create' ? 'active' : ''}`}
                  onClick={() => setMode('create')}
                >
                  <span className="mode-label">
                    <FilePlus size={14} /> New notes
                  </span>
                  <span className="mode-hint">Create from scratch</span>
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={mode === 'append'}
                  className={`ai-chat-mode-btn ${mode === 'append' ? 'active' : ''}`}
                  onClick={() => setMode('append')}
                >
                  <span className="mode-label">
                    <FilePen size={14} /> Add to note
                  </span>
                  <span className="mode-hint">Append a section</span>
                </button>
              </div>

              {mode === 'append' && (
                <div className="ai-chat-note-picker">
                  <label htmlFor="ai-chat-note-select">Note</label>
                  <select
                    id="ai-chat-note-select"
                    value={selectedNoteId}
                    onChange={(e) => setSelectedNoteId(e.target.value)}
                    disabled={noteOptions.length === 0}
                  >
                    {noteOptions.length === 0 ? (
                      <option value="">No notes yet — create in Workspace</option>
                    ) : (
                      noteOptions.map((n) => (
                        <option key={n.id} value={n.id}>
                          {n.title || 'Untitled'}
                        </option>
                      ))
                    )}
                  </select>
                </div>
              )}
            </header>

            <div className="ai-chat-messages" ref={listRef}>
              {showWelcome && (
                <div className="ai-chat-welcome">
                  <div className="ai-chat-welcome-icon">
                    <Sparkles size={24} />
                  </div>
                  <h3>What should I write?</h3>
                  <p>Try a quick prompt below or type your own message.</p>
                  <div className="ai-chat-suggestions">
                    {SUGGESTIONS.map((s) => (
                      <button
                        key={s.prompt}
                        type="button"
                        className="ai-chat-chip"
                        onClick={() => sendMessage(s.prompt)}
                        disabled={loading}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {messages.map((m, i) => (
                <div key={i} className={`ai-chat-msg-row ${m.role}`}>
                  <div className={`ai-chat-avatar ${m.role}`}>
                    {m.role === 'assistant' ? <Sparkles size={14} /> : <User size={14} />}
                  </div>
                  <div className={`ai-chat-bubble ${m.isError ? 'error' : ''}`}>
                    <div 
                      className="ai-chat-markdown"
                      dangerouslySetInnerHTML={{ __html: marked.parse(m.text || '') }} 
                    />
                    {m.links?.length > 0 && (
                      <div className="ai-chat-results">
                        {m.links.map((link) => (
                          <button
                            key={link.id}
                            type="button"
                            className="ai-chat-result-card"
                            onClick={() => {
                              setIsOpen(false);
                              navigate(`/notes/${link.id}`);
                            }}
                          >
                            <FileText size={14} />
                            <span className="ai-chat-result-badge">
                              {link.kind === 'updated' ? 'Updated' : 'New'}
                            </span>
                            <span className="ai-chat-result-title">{link.title}</span>
                            <ArrowUpRight size={14} />
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}

              {loading && <TypingIndicator />}
            </div>

            <footer className="ai-chat-footer">
              {error && <p className="ai-chat-error" role="alert">{error}</p>}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  sendMessage();
                }}
              >
                <div className="ai-chat-input-wrap">
                  <textarea
                    ref={inputRef}
                    rows={1}
                    placeholder={
                      mode === 'append'
                        ? 'What should I add to this note?'
                        : 'e.g. Create 3 notes for my product launch…'
                    }
                    value={input}
                    onChange={(e) => {
                      setInput(e.target.value);
                      resizeTextarea();
                    }}
                    onKeyDown={handleKeyDown}
                    disabled={loading}
                    aria-label="Message to AI"
                  />
                  <button
                    type="submit"
                    className="ai-chat-send"
                    disabled={loading || !input.trim()}
                    aria-label="Send message"
                  >
                    <Send size={18} />
                  </button>
                </div>
                <p className="ai-chat-input-hint">Enter to send · Shift+Enter for new line</p>
              </form>
            </footer>
          </section>
        </div>
      )}
    </div>,
    document.body
  );
}

import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  Sparkles,
  Send,
  FilePlus,
  FilePen,
  Zap,
  X,
  User,
  FileText,
  ArrowUpRight,
  CheckCircle2,
  Calendar,
  Flag,
  MapPin,
  GripHorizontal,
  Trash2,
  StopCircle,
  Paperclip
} from 'lucide-react';
import { marked } from 'marked';
import { aiAPI, notesAPI } from '../api/index';
import { useUIStore } from '../store/useUIStore';
import { useQueryClient } from '@tanstack/react-query';
import '../styles/ai-chat.css';

const SUGGESTIONS = [
  { label: 'Sprint planning notes', prompt: 'Create meeting notes for sprint planning with action items' },
  { label: 'Grocery & meal prep', prompt: 'Add a grocery list note and a meal prep ideas note' },
  { label: 'React performance research', prompt: 'Write research notes on React performance tips' },
];

const INTAKE_SUGGESTIONS = [
  { label: 'Paste meeting notes', prompt: 'Meeting with product team on June 10 at 2pm. Discussed Q3 roadmap. John to finalize specs by Friday. Sarah handles design mockups by next Wednesday. Launch target: July 15. Budget review due June 20.' },
  { label: 'Paste an email', prompt: 'Hi Team, Please complete the quarterly report by June 15. The client presentation is scheduled for June 18 at 10am. Make sure to review the analytics dashboard before the meeting. Also, we need to hire 2 new developers - start screening candidates ASAP. Best, Manager' },
  { label: 'Braindump ideas', prompt: 'Need to fix the login bug ASAP. Also should redesign the dashboard - maybe add charts? Remember to call dentist tomorrow 3pm. Buy groceries: milk, eggs, bread. Project deadline is next Friday. Team standup every day at 9:30am.' },
];

const INTAKE_TEMPLATES = [
  { id: 'auto', label: 'Auto-detect', hint: 'AI figures out the type' },
  { id: 'meeting', label: 'Meeting Notes', hint: 'Attendees, decisions, action items' },
  { id: 'email', label: 'Email Thread', hint: 'Sender, requests, deadlines' },
  { id: 'project', label: 'Project Brief', hint: 'Scope, milestones, deliverables' },
  { id: 'braindump', label: 'Braindump', hint: 'Unstructured thoughts → organized' },
  { id: 'syllabus', label: 'Course / Syllabus', hint: 'Schedule, assignments, exams' },
];

const SLASH_COMMANDS = [
  { cmd: '/summarize', label: 'Summarize note', prompt: 'Please summarize the following: ' },
  { cmd: '/actions', label: 'Extract action items', prompt: 'Extract all action items and deadlines from: ' },
  { cmd: '/rewrite', label: 'Rewrite professional', prompt: 'Rewrite the following text to be more professional: ' },
  { cmd: '/fix', label: 'Fix grammar', prompt: 'Fix all grammar and spelling mistakes in: ' }
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
  const location = useLocation();
  const queryClient = useQueryClient();
  const [mounted, setMounted] = useState(false);
  
  const { 
    isAiChatOpen: isOpen, 
    setAiChatOpen: setIsOpen, 
    aiChatMessages: messages, 
    setAiChatMessages: setMessages, 
    addAiChatMessage,
    hasChatted, 
    setHasChatted,
    clearAiChatMessages
  } = useUIStore();

  const [input, setInput] = useState('');
  const [mode, setMode] = useState('intake'); // Default to Smart Intake
  const [noteOptions, setNoteOptions] = useState([]);
  const [selectedNoteId, setSelectedNoteId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [intakeTemplate, setIntakeTemplate] = useState('auto');
  const [attachedFile, setAttachedFile] = useState(null);
  
  // Dragging state
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0 });

  const listRef = useRef(null);
  const inputRef = useRef(null);
  const abortControllerRef = useRef(null);
  const fileInputRef = useRef(null);

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
    if (isOpen) {
      loadNotes();
      
      // Auto-detect context
      const match = location.pathname.match(/^\/notes\/([a-zA-Z0-9_-]+)$/);
      if (match) {
        const noteId = match[1];
        setMode('append');
        setSelectedNoteId(noteId);
      }
    }
  }, [isOpen, loadNotes, location.pathname]);

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

  const handlePointerDown = (e) => {
    // Only drag from the header area, avoid buttons/inputs
    if (e.target.closest('button') || e.target.closest('.ai-chat-mode') || e.target.closest('select')) return;
    setIsDragging(true);
    dragStart.current = { x: e.clientX - position.x, y: e.clientY - position.y };
    e.target.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e) => {
    if (!isDragging) return;
    setPosition({
      x: e.clientX - dragStart.current.x,
      y: e.clientY - dragStart.current.y
    });
  };

  const handlePointerUp = (e) => {
    setIsDragging(false);
    e.target.releasePointerCapture(e.pointerId);
  };

  const resizeTextarea = () => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  };

  const sendMessage = async (text) => {
    const trimmed = (text ?? input).trim();
    if ((!trimmed && !attachedFile) || loading) return;

    if (mode === 'append' && !selectedNoteId) {
      setError('Pick a note below, or switch to "New notes".');
      return;
    }

    if (abortControllerRef.current) abortControllerRef.current.abort();
    abortControllerRef.current = new AbortController();

    setError('');
    setInput('');
    const fileToUpload = attachedFile;
    setAttachedFile(null);
    if (inputRef.current) inputRef.current.style.height = 'auto';
    setHasChatted(true);
    
    const userMessageText = fileToUpload 
      ? `📄 **${fileToUpload.name}**\n\n${trimmed}`.trim()
      : trimmed;
      
    addAiChatMessage({ role: 'user', text: userMessageText });
    setLoading(true);

    try {
      if (mode === 'intake') {
        // Smart Intake mode
        let res;
        if (fileToUpload) {
          const formData = new FormData();
          formData.append('file', fileToUpload);
          if (trimmed) formData.append('context', trimmed);
          res = await aiAPI.smartIntakeUpload(formData, { signal: abortControllerRef.current.signal });
        } else {
          res = await aiAPI.smartIntake(
            { rawData: trimmed, template: intakeTemplate },
            { signal: abortControllerRef.current.signal }
          );
        }
        const { reply, note, todos } = res.data;

        const links = [];
        if (note) {
          links.push({ id: note.id, title: note.title, kind: 'created' });
          queryClient.invalidateQueries({ queryKey: ['notes'] });
        }
        if (todos && todos.length > 0) {
          queryClient.invalidateQueries({ queryKey: ['todos'] });
          window.dispatchEvent(new CustomEvent('todo-updated'));
        }

        addAiChatMessage({
          role: 'assistant',
          text: reply,
          links,
          intakeResult: { note, todos: todos || [] }
        });
        loadNotes();
      } else {
        // Regular chat mode (create) - STREAMING SSE
        const tempId = Date.now().toString();
        setMessages(prev => [...prev, { id: tempId, role: 'assistant', text: '', isStreaming: true }]);

        const token = localStorage.getItem('token');
        const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3001';
        const response = await fetch(`${apiUrl}/ai/chat-stream`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {})
          },
          body: JSON.stringify({ message: trimmed, mode, noteId: mode === 'append' ? selectedNoteId : undefined }),
          signal: abortControllerRef.current.signal
        });

        if (!response.ok) {
          throw new Error('Failed to reach AI streaming endpoint');
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let done = false;
        let accumulatedJsonStr = '';
        let streamedReply = '';
        let finalData = null;

        while (!done) {
          const { value, done: readerDone } = await reader.read();
          if (value) {
            const chunk = decoder.decode(value, { stream: true });
            const lines = chunk.split('\n');
            for (const line of lines) {
              if (line.startsWith('data: ')) {
                const dataStr = line.replace('data: ', '');
                if (!dataStr) continue;
                try {
                  const dataObj = JSON.parse(dataStr);
                  if (dataObj.error) {
                    throw new Error(dataObj.error);
                  }
                  if (dataObj.done) {
                    finalData = dataObj;
                  } else if (dataObj.chunk) {
                    accumulatedJsonStr += dataObj.chunk;
                    // Regex extract the reply value from the accumulating JSON string
                    const match = accumulatedJsonStr.match(/"reply"\s*:\s*"((?:[^"\\]|\\.)*)/);
                    if (match) {
                      streamedReply = match[1].replace(/\\n/g, '\n').replace(/\\"/g, '"');
                      setMessages(prev => prev.map(m => m.id === tempId ? { ...m, text: streamedReply } : m));
                    }
                  }
                } catch (e) {} // ignore incomplete JSON lines
              }
            }
          }
          done = readerDone;
        }

        const { reply, notes, updatedNote } = finalData || { reply: streamedReply, notes: [] };
        const links = [];

        if (updatedNote) {
          links.push({ id: updatedNote.id, title: updatedNote.title, kind: 'updated' });
          queryClient.invalidateQueries({ queryKey: ['notes'] });
        }
        for (const n of notes || []) {
          links.push({ id: n.id, title: n.title, kind: 'created' });
          queryClient.invalidateQueries({ queryKey: ['notes'] });
        }

        setMessages(prev => prev.map(m => m.id === tempId ? { ...m, text: reply, links, isStreaming: false } : m));
        loadNotes();
      }
    } catch (err) {
      if (err.name === 'CanceledError' || err.message === 'canceled' || err.name === 'AbortError') {
         setMessages(prev => {
           const last = prev[prev.length - 1];
           if (last?.isStreaming) return prev.map(m => m.id === last.id ? { ...m, text: m.text + '\n\n*(Cancelled by user)*', isStreaming: false } : m);
           return [...prev, { role: 'assistant', text: 'Request cancelled by user.', isError: true }];
         });
         return;
      }
      let msg = err.response?.data?.error || err.response?.data?.message || err.message || 'Could not reach AI. Check your connection.';
      if (typeof msg !== 'string') {
        try { msg = JSON.stringify(msg); } catch(e) { msg = 'An unknown error occurred'; }
      }
      setError(msg);
      addAiChatMessage({ role: 'assistant', text: msg, isError: true });
    } finally {
      setLoading(false);
      abortControllerRef.current = null;
    }
  };

  const stopRequest = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const handleCommandClick = (prompt) => {
    setInput(prompt);
    inputRef.current?.focus();
    resizeTextarea();
  };

  const clearHistory = () => {
    clearAiChatMessages();
    setHasChatted(false);
    setError('');
  };

  const showWelcome = !hasChatted && messages.length === 0;
  const contextMatch = location.pathname.match(/^\/notes\/([a-zA-Z0-9_-]+)$/);
  const contextNoteName = contextMatch ? noteOptions.find(n => n.id === contextMatch[1])?.title || 'Current Note' : null;

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
            className={`ai-chat-window ${isDragging ? 'dragging' : ''}`}
            role="dialog"
            aria-labelledby="ai-chat-title"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
            style={{ transform: `translate(${position.x}px, ${position.y}px)` }}
          >
            <header 
              className="ai-chat-header"
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
              style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
            >
              <div className="ai-chat-header-drag-indicator">
                <GripHorizontal size={14} />
              </div>
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
                    {contextNoteName && (
                      <div className="ai-chat-context-pill">
                        <MapPin size={10} /> Context: {contextNoteName}
                      </div>
                    )}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '4px' }}>
                  {messages.length > 0 && (
                    <button
                      type="button"
                      className="ai-chat-close"
                      onClick={clearHistory}
                      aria-label="Clear history"
                      title="Clear history"
                    >
                      <Trash2 size={16} />
                    </button>
                  )}
                  <button
                    type="button"
                    className="ai-chat-close"
                    onClick={() => setIsOpen(false)}
                    aria-label="Close assistant"
                  >
                    <X size={20} />
                  </button>
                </div>
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
                  aria-selected={mode === 'intake'}
                  className={`ai-chat-mode-btn ${mode === 'intake' ? 'active' : ''}`}
                  onClick={() => setMode('intake')}
                >
                  <span className="mode-label">
                    <Zap size={14} /> Smart Intake
                  </span>
                  <span className="mode-hint">Paste data → Notes + Tasks</span>
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
                    {mode === 'intake' ? <Zap size={24} /> : <Sparkles size={24} />}
                  </div>
                  <h3>{mode === 'intake' ? 'Paste any data' : 'What should I write?'}</h3>
                  <p>{mode === 'intake'
                    ? 'Drop meeting notes, emails, braindumps — I\'ll create notes & tasks with deadlines.'
                    : 'Try a quick prompt below or type your own message.'}
                  </p>
                  <div className="ai-chat-suggestions">
                    {(mode === 'intake' ? INTAKE_SUGGESTIONS : SUGGESTIONS).map((s) => (
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
                      dangerouslySetInnerHTML={{ __html: marked.parse(typeof m.text === 'string' ? m.text : (m.text ? JSON.stringify(m.text) : '')) }} 
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
                    {/* Smart Intake: Show extracted tasks */}
                    {m.intakeResult?.todos?.length > 0 && (
                      <div className="ai-intake-tasks">
                        <div className="ai-intake-tasks-header">
                          <CheckCircle2 size={14} />
                          <span>{m.intakeResult.todos.length} task{m.intakeResult.todos.length > 1 ? 's' : ''} created</span>
                        </div>
                        {m.intakeResult.todos.map((todo) => (
                          <div key={todo.id} className="ai-intake-task-card">
                            <div className={`ai-intake-priority-dot priority-${todo.priority}`} />
                            <div className="ai-intake-task-info">
                              <span className="ai-intake-task-text">{todo.text}</span>
                              <div className="ai-intake-task-meta">
                                {todo.deadline && (
                                  <span className="ai-intake-task-deadline">
                                    <Calendar size={11} />
                                    {new Date(todo.deadline).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                                  </span>
                                )}
                                <span className={`ai-intake-task-priority priority-${todo.priority}`}>
                                  <Flag size={11} />
                                  {todo.priority}
                                </span>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}

              {loading && <TypingIndicator />}
            </div>

            <footer className="ai-chat-footer" style={{ position: 'relative' }}>
              {error && <p className="ai-chat-error" role="alert">{error}</p>}
              
              {input.startsWith('/') && (
                <div className="ai-chat-slash-menu">
                  <div className="ai-chat-slash-menu-title">Commands</div>
                  {SLASH_COMMANDS.filter(c => c.cmd.startsWith(input)).map((cmd) => (
                    <button
                      key={cmd.cmd}
                      className="ai-chat-slash-item"
                      onClick={() => handleCommandClick(cmd.prompt)}
                      type="button"
                    >
                      <span className="slash-cmd">{cmd.cmd}</span>
                      <span className="slash-desc">{cmd.label}</span>
                    </button>
                  ))}
                  {SLASH_COMMANDS.filter(c => c.cmd.startsWith(input)).length === 0 && (
                    <div className="ai-chat-slash-item" style={{ color: 'var(--ai-text-muted)' }}>No matching commands</div>
                  )}
                </div>
              )}

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  sendMessage();
                }}
              >
                <div className="ai-chat-input-wrap" style={{ flexDirection: 'column', alignItems: 'flex-start' }}>
                  {attachedFile && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '4px 8px', background: 'var(--ai-message-bot)', borderRadius: '4px', fontSize: '12px', marginBottom: '8px', width: 'fit-content', border: '1px solid var(--ai-border)' }}>
                      <Paperclip size={12} />
                      <span style={{ maxWidth: '150px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{attachedFile.name}</span>
                      <button type="button" onClick={() => setAttachedFile(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', color: 'inherit' }}>
                        <X size={14}/>
                      </button>
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: '8px', width: '100%', alignItems: 'flex-end' }}>
                    <textarea
                      ref={inputRef}
                      rows={mode === 'intake' ? 3 : 1}
                      placeholder={
                        mode === 'intake'
                          ? 'Paste meeting notes, emails, project briefs, braindumps…'
                          : mode === 'append'
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
                    
                    <input 
                      type="file" 
                      ref={fileInputRef} 
                      style={{ display: 'none' }} 
                      accept=".pdf,.txt"
                      onChange={(e) => {
                        if (e.target.files && e.target.files[0]) {
                          setAttachedFile(e.target.files[0]);
                        }
                        e.target.value = '';
                      }}
                    />
                    
                    <button 
                      type="button" 
                      className="ai-chat-send"
                      style={{ background: 'transparent', color: 'var(--ai-text-muted)' }}
                      onClick={() => { if (fileInputRef.current) fileInputRef.current.click(); }}
                      disabled={loading}
                      title="Attach PDF or TXT file"
                    >
                      <Paperclip size={18} />
                    </button>

                    {loading ? (
                      <button
                        type="button"
                        className="ai-chat-send stop-btn"
                        aria-label="Stop generation"
                        onClick={stopRequest}
                      >
                        <StopCircle size={18} />
                      </button>
                    ) : (
                      <button
                        type="submit"
                        className="ai-chat-send"
                        disabled={!input.trim() && !attachedFile}
                        aria-label="Send message"
                      >
                        <Send size={18} />
                      </button>
                    )}
                  </div>
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

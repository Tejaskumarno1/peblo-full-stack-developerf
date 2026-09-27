import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, ArrowUp, Square, Lock, X, RotateCcw } from 'lucide-react';
import useHubChat, { renderAnswer } from '../hooks/useHubChat';

const TILTS = [-1.5, 1.2, -0.6, 0.9, -1];
const FOLLOW_UPS = ['Quiz me on this', 'Explain it more simply', 'Make flashcards from this'];

/** Soft Studio · AI Hub (mockup: SoftAI). Same chat engine as the other styles, friendlier layout. */
export default function SoftAI() {
  const {
    chats, activeId, setActiveId, active, input, setInput, attached, setAttached, streaming,
    focusedSource, setFocusedSource, modelChoice, setModelChoice, allNotes,
    local, routing, localModels, cloudModels, noAI, currentModelLabel, lastAssistant, panelSources,
    send, stop, newChat, deleteChat, retryWithCloud, regenerate, saveAsNote,
    threadRef, inputRef,
  } = useHubChat();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);
  const [attachQuery, setAttachQuery] = useState('');
  const [copied, setCopied] = useState(null);

  const onThreadClick = (e) => {
    const btn = e.target.closest('[data-cite]');
    if (!btn) return;
    const n = Number(btn.dataset.cite);
    setFocusedSource(n);
    document.getElementById(`s-src-${n}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };

  const matches = allNotes
    .filter((n) => !attached.find((a) => a.id === n.id))
    .filter((n) => !attachQuery || (n.title || '').toLowerCase().includes(attachQuery.toLowerCase()))
    .slice(0, 6);

  const modelText = currentModelLabel.kind === 'local' ? `${currentModelLabel.name} · on this computer`
    : currentModelLabel.kind === 'cloud' ? `${currentModelLabel.name} · cloud` : 'No AI set up';

  const copy = (m) => { navigator.clipboard?.writeText(m.content); setCopied(m.id); setTimeout(() => setCopied(null), 1500); };

  return (
    <div className="soft-page s-ai">
      {/* ---------- chats ---------- */}
      <aside className="s-chats" aria-label="Chats">
        <div className="s-tile-head" style={{ padding: '0 4px 8px' }}>
          <h1 className="s-h2">Chats</h1>
          <button type="button" className="s-new small" aria-label="New chat" title="New chat" onClick={newChat}><Plus size={17} strokeWidth={2.6} /></button>
        </div>
        <div className="s-chat-list">
          {chats.length === 0 && <p className="s-empty small" style={{ padding: '4px 14px' }}>Your chats will show up here.</p>}
          {chats.map((c) => (
            <div key={c.id} className={`s-chat${c.id === activeId ? ' on' : ''}`}>
              <button type="button" className="s-chat-main" onClick={() => setActiveId(c.id)}>{c.title}</button>
              <button type="button" className="s-chat-x" aria-label={`Delete chat "${c.title}"`} onClick={() => deleteChat(c.id)}><X size={14} strokeWidth={2.4} /></button>
            </div>
          ))}
        </div>
        <span className="s-chats-note"><Lock size={16} /> Chats stay on this computer</span>
      </aside>

      {/* ---------- conversation ---------- */}
      <main className="s-convo" aria-label="Conversation">
        <div className="s-thread" ref={threadRef} onClick={onThreadClick}>
          {!active || active.messages.length === 0 ? (
            <div className="s-welcome">
              <span className="s-welcome-blob" aria-hidden="true" />
              <h2 className="s-welcome-title">Ask your notes anything.</h2>
              <p className="s-empty">Answers come from your notes, tasks and calendar. Every answer shows where it came from.</p>
              {noAI ? (
                <Link to="/ai/connections" className="s-accent-btn" style={{ display: 'inline-flex', alignItems: 'center', textDecoration: 'none' }}>Set up AI</Link>
              ) : (
                <div className="s-suggest">
                  {['Plan my day from my tasks', 'What did I write about this week?', 'What should I do first today?'].map((s) => (
                    <button key={s} type="button" className="s-dashed s-suggest-btn" onClick={() => send(s, { newChat: true })}>{s}</button>
                  ))}
                </div>
              )}
            </div>
          ) : active.messages.map((m, i) => (m.role === 'user' ? (
            <div key={m.id} className="s-user">
              <div className="s-user-bubble">{m.content}</div>
              {m.attached?.length > 0 && <div className="s-user-att">{m.attached.map((a) => <span key={a.id} className="s-tag" style={{ background: 'var(--s-peach)', fontSize: 12.5, padding: '4px 12px' }}>{a.title}</span>)}</div>}
            </div>
          ) : (
            <div key={m.id} className="s-bot">
              <span className="s-bot-blob" aria-hidden="true" />
              <div className="s-bot-col">
                {m.content && <div className={`s-bot-bubble${m.status === 'streaming' ? ' live' : ''}`} dangerouslySetInnerHTML={{ __html: renderAnswer(m.content, m.sources?.length || 0) }} />}
                {m.status === 'thinking' && <div className="s-bot-bubble s-typing"><span /><span /><span /></div>}
                {m.status === 'consent' && (
                  <div className="s-bot-bubble" style={{ background: 'var(--s-butter)' }}>
                    <p style={{ margin: 0 }}><strong>Use a cloud model for this answer?</strong> {m.consent.message}</p>
                    <div className="s-bot-actions" style={{ marginTop: 10 }}>
                      <button type="button" className="s-act dark" onClick={() => retryWithCloud(m)}>Yes, just this once</button>
                      <Link to="/ai/connections" className="s-act">Set up Local AI</Link>
                    </div>
                  </div>
                )}
                {m.status === 'error' && (
                  <div className="s-bot-bubble" style={{ background: 'var(--s-peach)' }}>
                    <p style={{ margin: 0 }}>{m.error}</p>
                    <div className="s-bot-actions" style={{ marginTop: 10 }}>
                      <button type="button" className="s-act" onClick={() => regenerate(m)}><RotateCcw size={13} /> Try again</button>
                      <Link to="/ai/connections" className="s-act">Check Your AI</Link>
                    </div>
                  </div>
                )}
                <div className="s-bot-actions">
                  <span className="s-bot-meta">
                    {m.meta ? `${m.meta.local ? 'On this computer' : 'Cloud'} · ${m.meta.model} · ${m.sources?.length || 0} source${m.sources?.length === 1 ? '' : 's'}`
                      : m.status === 'thinking' ? `Reading your notes${m.sources?.length ? ` · found ${m.sources.length}` : ''}…`
                        : m.status === 'streaming' ? 'Writing…' : m.status === 'stopped' ? 'Stopped' : ''}
                  </span>
                  {m.status === 'done' && m.content && (
                    <>
                      <button type="button" className="s-act" onClick={() => saveAsNote(m)}>Save as note</button>
                      <button type="button" className="s-act" onClick={() => copy(m)}>{copied === m.id ? 'Copied' : 'Copy'}</button>
                      <button type="button" className="s-act" onClick={() => regenerate(m)}>Try again</button>
                    </>
                  )}
                </div>
                {m.status === 'done' && m.content && i === active.messages.length - 1 && (
                  <div className="s-suggest">
                    {FOLLOW_UPS.map((s) => <button key={s} type="button" className="s-dashed s-suggest-btn" onClick={() => send(s)}>{s}</button>)}
                  </div>
                )}
              </div>
            </div>
          )))}
        </div>

        <form className="s-composer" onSubmit={(e) => { e.preventDefault(); send(); }}>
          <div className="s-composer-row">
            <label htmlFor="s-ai-input" className="s-sr">Message</label>
            <input
              id="s-ai-input"
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={active?.messages.length ? 'Ask a follow-up…' : 'Ask about your notes, tasks and calendar…'}
              autoComplete="off"
            />
            {streaming ? (
              <button type="button" className="s-send big" aria-label="Stop" onClick={stop}><Square size={15} fill="currentColor" /></button>
            ) : (
              <button type="submit" className="s-send big" aria-label="Send" disabled={!input.trim()}><ArrowUp size={18} strokeWidth={2.4} /></button>
            )}
          </div>
          <div className="s-composer-chips">
            {attached.map((a) => (
              <span key={a.id} className="s-tag s-att" style={{ background: 'var(--s-peach)' }}>
                {a.title}
                <button type="button" aria-label={`Remove ${a.title}`} onClick={() => setAttached((l) => l.filter((x) => x.id !== a.id))}><X size={12} strokeWidth={2.6} /></button>
              </span>
            ))}
            <div className="s-menu-wrap">
              <button type="button" className="s-dashed s-add-note" onClick={() => setAttachOpen((v) => !v)} aria-expanded={attachOpen}>+ Add a note</button>
              {attachOpen && (
                <div className="s-menu up s-attach">
                  <input autoFocus value={attachQuery} onChange={(e) => setAttachQuery(e.target.value)} placeholder="Find a note…" aria-label="Find a note to add" />
                  {matches.map((n) => (
                    <button key={n.id} type="button" onClick={() => { setAttached((l) => [...l, { id: n.id, title: n.title || 'Untitled' }]); setAttachOpen(false); setAttachQuery(''); }}>{n.title || 'Untitled'}</button>
                  ))}
                  {matches.length === 0 && <span className="s-empty small" style={{ padding: 8 }}>No notes match.</span>}
                </div>
              )}
            </div>
            <span className="grow" />
            <div className="s-menu-wrap">
              <button type="button" className={`s-model ${currentModelLabel.kind}`} onClick={() => setPickerOpen((v) => !v)} aria-expanded={pickerOpen}>
                <span className="dot" /> {modelText}
              </button>
              {pickerOpen && (
                <div className="s-menu up right" role="listbox">
                  <button type="button" role="option" aria-selected={!modelChoice} onClick={() => { setModelChoice(null); setPickerOpen(false); }}>Automatic · follows Your AI</button>
                  {localModels.map((m) => (
                    <button key={m} type="button" role="option" aria-selected={modelChoice?.model === m} onClick={() => { setModelChoice({ provider: 'ollama', model: m }); setPickerOpen(false); }}>{m} · on this computer</button>
                  ))}
                  {cloudModels.map((c) => (
                    <button key={c.provider} type="button" role="option" aria-selected={modelChoice?.provider === c.provider} disabled={routing === 'ollama'} onClick={() => { setModelChoice({ provider: c.provider, model: c.model }); setPickerOpen(false); }}>{c.model} · cloud{routing === 'ollama' ? ' (off)' : ''}</button>
                  ))}
                  {!localModels.length && !cloudModels.length && <Link to="/ai/connections" className="s-menu-link">{local?.enabled ? 'Ollama is not running. Open Your AI' : 'Set up AI in Your AI'}</Link>}
                </div>
              )}
            </div>
          </div>
        </form>
      </main>

      {/* ---------- sources ---------- */}
      <aside className="s-sources" aria-label="Where this came from">
        <h2 className="s-col-title" style={{ padding: '4px 4px 0' }}>Where this came from</h2>
        <span className="s-sources-sub">
          {lastAssistant?.searched
            ? `Peblo read ${lastAssistant.searched.notes} notes and ${lastAssistant.searched.tasks} tasks. ${panelSources.length ? `${panelSources.length === 1 ? 'This one' : `These ${panelSources.length}`} matched.` : 'Nothing matched.'}`
            : 'When you ask something, the notes and tasks the answer used show up here.'}
        </span>
        <div className="s-source-list">
          {panelSources.map((s, i) => (
            <Link
              key={s.n}
              id={`s-src-${s.n}`}
              to={s.kind === 'note' && s.id ? `/notes/${s.id}` : '/tasks'}
              className={`s-source${focusedSource === s.n ? ' focus' : ''}`}
              style={{ transform: `rotate(${TILTS[i % TILTS.length]}deg)` }}
            >
              <span className="s-source-head"><span className="n">{s.n}</span><span className="t">{s.title}</span></span>
              <span className="m">{s.meta}</span>
              {s.snippet && <span className="s">{s.snippet}</span>}
            </Link>
          ))}
        </div>
        {lastAssistant?.excludedPrivate > 0 && <span className="s-sources-sub"><Lock size={13} /> {lastAssistant.excludedPrivate} private note{lastAssistant.excludedPrivate === 1 ? '' : 's'} left out</span>}
      </aside>
    </div>
  );
}

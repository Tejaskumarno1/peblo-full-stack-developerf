import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, ArrowUp, Square, Lock, X, RotateCcw } from 'lucide-react';
import useHubChat, { renderAnswer, groupLabel } from '../../hooks/useHubChat';

const FOLLOW_UPS = ['Quiz me on this', 'Explain it more simply', 'Make a checklist from this'];

/**
 * AI Hub layout shared by River and Orbit: chats, the conversation, and where each answer came from.
 * Class names start with the style's prefix ("r" for River, "o" for Orbit); each style's CSS draws them.
 */
export default function HubScreen({ p, starters, welcome = 'Ask your notes anything.' }) {
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
  const c = (name) => `${p}-${name}`;

  const onThreadClick = (e) => {
    const btn = e.target.closest('[data-cite]');
    if (!btn) return;
    const n = Number(btn.dataset.cite);
    setFocusedSource(n);
    document.getElementById(`${p}-src-${n}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };

  const matches = allNotes
    .filter((n) => !attached.find((a) => a.id === n.id))
    .filter((n) => !attachQuery || (n.title || '').toLowerCase().includes(attachQuery.toLowerCase()))
    .slice(0, 6);
  const modelText = currentModelLabel.kind === 'local' ? `${currentModelLabel.name} · on this computer`
    : currentModelLabel.kind === 'cloud' ? `${currentModelLabel.name} · cloud` : 'No AI set up';
  const copy = (m) => { navigator.clipboard?.writeText(m.content); setCopied(m.id); setTimeout(() => setCopied(null), 1500); };

  let lastGroup = null;

  return (
    <div className={c('ai')}>
      <aside className={c('chats')} aria-label="Chats">
        <div className={c('chats-head')}>
          <h1>Chats</h1>
          <button type="button" className={c('icon-btn')} style={{ width: 40, height: 40 }} aria-label="New chat" title="New chat" onClick={newChat}><Plus size={18} strokeWidth={2.4} /></button>
        </div>
        {chats.length === 0 && <p className={c('quiet')} style={{ padding: '4px 10px', fontSize: 13 }}>Your chats will show up here.</p>}
        {chats.map((ch) => {
          const g = groupLabel(ch.updatedAt || ch.createdAt || Date.now());
          const head = g !== lastGroup ? g : null;
          lastGroup = g;
          return (
            <div key={ch.id}>
              {head && <div className={c('chat-group')}>{head.toUpperCase()}</div>}
              <div className={`${c('chat')}${ch.id === activeId ? ' on' : ''}`}>
                <button type="button" className="main" onClick={() => setActiveId(ch.id)}>{ch.title}</button>
                <button type="button" className="x" aria-label={`Delete chat "${ch.title}"`} onClick={() => deleteChat(ch.id)}><X size={14} strokeWidth={2.4} /></button>
              </div>
            </div>
          );
        })}
        <span className="grow" />
        <span className={c('quiet')} style={{ fontSize: 12.5, display: 'flex', gap: 6, alignItems: 'center', padding: '8px 10px 0' }}><Lock size={14} /> Chats stay on this computer</span>
      </aside>

      <main className={c('convo')} aria-label="Conversation">
        <div className={c('thread')} ref={threadRef} onClick={onThreadClick}>
          {!active || active.messages.length === 0 ? (
            <div className={c('welcome')}>
              <h2>{welcome}</h2>
              <p className={c('quiet')}>Answers come from your notes, tasks and calendar, and every answer shows what it read.</p>
              {noAI ? (
                <Link to="/ai/connections" className={c('btn')}>Set up AI</Link>
              ) : (
                <div className={c('suggest')}>
                  {starters.map((s) => <button key={s} type="button" onClick={() => send(s, { newChat: true })}>{s}</button>)}
                </div>
              )}
            </div>
          ) : active.messages.map((m, i) => (m.role === 'user' ? (
            <div key={m.id} className={c('user')}>
              <div className={c('user-bubble')}>{m.content}</div>
              {m.attached?.length > 0 && <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{m.attached.map((a) => <span key={a.id} className={c('tag')}>{a.title}</span>)}</div>}
            </div>
          ) : (
            <div key={m.id} className={c('bot')}>
              {m.content && <div className={c('bot-text')} dangerouslySetInnerHTML={{ __html: renderAnswer(m.content, m.sources?.length || 0) }} />}
              {m.status === 'thinking' && <div className={c('typing')} aria-label="Thinking"><span /><span /><span /></div>}
              {m.status === 'consent' && (
                <div className={`${c('bot-box')} warn`}>
                  <p style={{ margin: 0 }}><strong>Use a cloud model for this answer?</strong> {m.consent.message}</p>
                  <div className={c('bot-meta')} style={{ marginTop: 10 }}>
                    <button type="button" onClick={() => retryWithCloud(m)}>Yes, just this once</button>
                    <Link to="/ai/connections">Set up Local AI</Link>
                  </div>
                </div>
              )}
              {m.status === 'error' && (
                <div className={`${c('bot-box')} warn`}>
                  <p style={{ margin: 0 }}>{m.error}</p>
                  <div className={c('bot-meta')} style={{ marginTop: 10 }}>
                    <button type="button" onClick={() => regenerate(m)}><RotateCcw size={13} /> Try again</button>
                    <Link to="/ai/connections">Check Your AI</Link>
                  </div>
                </div>
              )}
              <div className={c('bot-meta')}>
                <span>
                  {m.meta ? `${m.meta.local ? 'On this computer' : 'Cloud'} · ${m.meta.model} · ${m.sources?.length || 0} source${m.sources?.length === 1 ? '' : 's'}`
                    : m.status === 'thinking' ? `Reading your notes${m.sources?.length ? ` · found ${m.sources.length}` : ''}…`
                      : m.status === 'streaming' ? 'Writing…' : m.status === 'stopped' ? 'Stopped' : ''}
                </span>
                {m.status === 'done' && m.content && (
                  <>
                    <button type="button" onClick={() => saveAsNote(m)}>Save as note</button>
                    <button type="button" onClick={() => copy(m)}>{copied === m.id ? 'Copied' : 'Copy'}</button>
                    <button type="button" onClick={() => regenerate(m)}>Try again</button>
                  </>
                )}
              </div>
              {m.status === 'done' && m.content && i === active.messages.length - 1 && (
                <div className={c('suggest')} style={{ justifyContent: 'flex-start' }}>
                  {FOLLOW_UPS.map((s) => <button key={s} type="button" onClick={() => send(s)}>{s}</button>)}
                </div>
              )}
            </div>
          )))}
        </div>

        <form className={c('composer')} onSubmit={(e) => { e.preventDefault(); send(); }}>
          <div className={c('composer-row')}>
            <label htmlFor={`${p}-ai-input`} className={c('sr')}>Message</label>
            <input
              id={`${p}-ai-input`}
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={active?.messages.length ? 'Ask a follow-up…' : 'Ask about your notes, tasks and calendar…'}
              autoComplete="off"
            />
            {streaming ? (
              <button type="button" className={c('icon-btn')} aria-label="Stop" onClick={stop}><Square size={15} fill="currentColor" /></button>
            ) : (
              <button type="submit" className={c('icon-btn')} aria-label="Send" disabled={!input.trim()}><ArrowUp size={19} strokeWidth={2.4} /></button>
            )}
          </div>
          <div className={c('composer-chips')}>
            {attached.map((a) => (
              <span key={a.id} className="chip att">
                {a.title}
                <button type="button" aria-label={`Remove ${a.title}`} onClick={() => setAttached((l) => l.filter((x) => x.id !== a.id))}><X size={12} strokeWidth={2.6} /></button>
              </span>
            ))}
            <div className={c('menu-wrap')}>
              <button type="button" className="chip" onClick={() => setAttachOpen((v) => !v)} aria-expanded={attachOpen}>+ Add a note</button>
              {attachOpen && (
                <div className={`${c('pop')} up ${c('attach')}`}>
                  <input autoFocus value={attachQuery} onChange={(e) => setAttachQuery(e.target.value)} placeholder="Find a note…" aria-label="Find a note to add" />
                  {matches.map((n) => (
                    <button key={n.id} type="button" onClick={() => { setAttached((l) => [...l, { id: n.id, title: n.title || 'Untitled' }]); setAttachOpen(false); setAttachQuery(''); }}>{n.title || 'Untitled'}</button>
                  ))}
                  {matches.length === 0 && <span className="empty">No notes match.</span>}
                </div>
              )}
            </div>
            <span className="grow" />
            <div className={c('menu-wrap')}>
              <button type="button" className={`${c('model')} ${currentModelLabel.kind}`} onClick={() => setPickerOpen((v) => !v)} aria-expanded={pickerOpen}>
                <span className="dot" /> {modelText}
              </button>
              {pickerOpen && (
                <div className={`${c('pop')} up right`} role="listbox" style={{ width: 280 }}>
                  <button type="button" role="option" aria-selected={!modelChoice} onClick={() => { setModelChoice(null); setPickerOpen(false); }}>Automatic · follows Your AI</button>
                  {localModels.map((m) => (
                    <button key={m} type="button" role="option" aria-selected={modelChoice?.model === m} onClick={() => { setModelChoice({ provider: 'ollama', model: m }); setPickerOpen(false); }}>{m} · on this computer</button>
                  ))}
                  {cloudModels.map((cm) => (
                    <button key={cm.provider} type="button" role="option" aria-selected={modelChoice?.provider === cm.provider} disabled={routing === 'ollama'} onClick={() => { setModelChoice({ provider: cm.provider, model: cm.model }); setPickerOpen(false); }}>{cm.model} · cloud{routing === 'ollama' ? ' (off)' : ''}</button>
                  ))}
                  {!localModels.length && !cloudModels.length && <Link to="/ai/connections">{local?.enabled ? 'Ollama is not running. Open Your AI' : 'Set up AI in Your AI'}</Link>}
                </div>
              )}
            </div>
          </div>
        </form>
      </main>

      <aside className={c('sources')} aria-label="Where this came from">
        <h2 className={c('h3')}>WHERE THIS CAME FROM</h2>
        <span className={c('quiet')} style={{ fontSize: 13 }}>
          {lastAssistant?.searched
            ? `Peblo read ${lastAssistant.searched.notes} notes and ${lastAssistant.searched.tasks} tasks. ${panelSources.length ? `${panelSources.length === 1 ? 'This one' : `These ${panelSources.length}`} matched.` : 'Nothing matched.'}`
            : 'When you ask something, the notes and tasks the answer used show up here.'}
        </span>
        {panelSources.map((s) => (
          <Link key={s.n} id={`${p}-src-${s.n}`} to={s.kind === 'note' && s.id ? `/notes/${s.id}` : '/tasks'} className={`${c('source')}${focusedSource === s.n ? ' focus' : ''}`}>
            <span className="h"><span className="n">{s.n}</span><span>{s.title}</span></span>
            <span className="m">{s.meta}</span>
            {s.snippet && <span className="s">{s.snippet}</span>}
          </Link>
        ))}
        {lastAssistant?.excludedPrivate > 0 && <span className={c('quiet')} style={{ fontSize: 12.5, display: 'flex', gap: 6, alignItems: 'center' }}><Lock size={13} /> {lastAssistant.excludedPrivate} private note{lastAssistant.excludedPrivate === 1 ? '' : 's'} left out</span>}
      </aside>
    </div>
  );
}

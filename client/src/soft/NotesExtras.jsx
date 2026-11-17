import { useEffect, useMemo, useRef, useState } from 'react';
import { Tag as TagIcon, X, Sparkles, ArrowUp } from 'lucide-react';
import { renderAnswer } from '../hooks/useHubChat';
import { authHeaders, signOutIfRejected } from '../api/token';
import { useOutside } from './NotesPanelParts';
import { useDialogFocus } from './a11y';
import './notesextras.css';

/** The Tags filter row: a "Tags" button that opens a picker (many tags, Any / All), chips for the chosen tags and Clear. */
export function TagFilterBar({ tags, sel, setSel, match, setMatch }) {
  const [open, setOpen] = useState(false);
  const btn = useRef(null);
  const all = useMemo(() => [...new Set([...tags, ...sel])], [tags, sel]);
  const toggle = (t) => setSel(sel.includes(t) ? sel.filter((x) => x !== t) : [...sel, t]);
  if (!all.length && !sel.length) return null;
  return (
    <div className="np-tagbar" data-testid="tag-filter">
      <button type="button" ref={btn} className={`np-tagbtn${sel.length ? ' set' : ''}`} data-testid="tag-filter-btn" aria-haspopup="dialog" aria-expanded={open} onMouseDown={(e) => { if (open) e.stopPropagation(); /* the outside-click closer must not close it first, or this click would reopen it */ }} onClick={() => setOpen((v) => !v)}><TagIcon size={14} strokeWidth={1.9} />Tags{sel.length ? ` (${sel.length})` : ''}</button>
      {sel.map((t) => <span key={t} className="np-tagchip" data-testid="tag-chip">#{t}<button type="button" aria-label={`Remove tag ${t}`} onClick={() => toggle(t)}><X size={12} strokeWidth={2.6} /></button></span>)}
      {sel.length > 1 && <span className="np-tagmode" data-testid="tag-mode-note">{match === 'all' ? 'all of these' : 'any of these'}</span>}
      {sel.length > 0 && <button type="button" className="np-tagclear" data-testid="tag-clear" onClick={() => setSel([])}>Clear</button>}
      {open && <TagPicker tags={all} sel={sel} toggle={toggle} match={match} setMatch={setMatch} onClose={() => setOpen(false)} />}
    </div>
  );
}

function TagPicker({ tags, sel, toggle, match, setMatch, onClose }) {
  const ref = useRef(null);
  const [f, setF] = useState('');
  useOutside(ref, true, onClose);
  useDialogFocus(ref, false);
  const shown = tags.filter((t) => t.toLowerCase().includes(f.trim().toLowerCase().replace(/^#/, '')));
  return (
    <div className="np-tagpop" role="dialog" aria-label="Filter by tags" ref={ref} tabIndex={-1} data-testid="tag-picker">
      <input className="np-tagfind" aria-label="Find a tag" placeholder="Find a tag" value={f} onChange={(e) => setF(e.target.value)} />
      <div className="np-taglist" role="group" aria-label="Tags">
        {shown.map((t) => <label key={t} className="np-tagopt"><input type="checkbox" checked={sel.includes(t)} onChange={() => toggle(t)} />#{t}</label>)}
        {shown.length === 0 && <p className="np-hint">No tag matches.</p>}
      </div>
      <div className="np-seg" role="radiogroup" aria-label="Match">
        {[['any', 'Any tag'], ['all', 'All tags']].map(([k, n]) => <button key={k} type="button" role="radio" aria-checked={match === k} className={match === k ? 'on' : ''} data-testid={`tag-match-${k}`} onClick={() => setMatch(k)}>{n}</button>)}
      </div>
    </div>
  );
}

/** After a bulk action that partly failed: the notes that did not work and why. `extra` is an optional button (e.g. Undo the ones that did). */
export function BulkFailDialog({ fails, extra, onClose }) {
  const ref = useRef(null);
  useDialogFocus(ref, true);
  return (
    <div className="bf-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }} onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }}>
      <div className="bf-box" role="dialog" aria-modal="true" aria-label="Notes that failed" data-testid="bulk-fail-dialog" ref={ref} tabIndex={-1}>
        <h3>{fails.length} note{fails.length === 1 ? '' : 's'} did not work</h3>
        <ul>{fails.map((f) => <li key={f.id}><b>{f.title}</b><span>{f.error}</span></li>)}</ul>
        <div className="bf-btns">{extra && <button type="button" onClick={() => { extra.run(); onClose(); }}>{extra.label}</button>}<button type="button" className="go" onClick={onClose}>Close</button></div>
      </div>
    </div>
  );
}

/** A labelled row of choices shown all at once (N32: text size and page width in the note's "..." menu, instead of cycling). */
export function SegRow({ label, icon, value, options, onPick, testid }) {
  return (
    <div className="nx-segrow" role="group" aria-label={label} data-testid={testid}>
      <span className="nx-seglab">{icon}{label}</span>
      <span className="nx-seg">
        {options.map(([k, name, aria]) => <button key={k} type="button" aria-pressed={value === k} aria-label={aria || undefined} className={value === k ? 'on' : ''} data-testid={testid ? `${testid}-${k}` : undefined} onClick={() => onPick(k)}>{name}</button>)}
      </span>
    </div>
  );
}

/*
 * N27: where the cursor was in the editor, so a reload (a merged save, someone else's edit) can put it back.
 * Kept as the index of the block the cursor is in and the number of characters before it in that block. The merged text may
 * have moved things a little, so this is "as close as possible"; nothing is done when the editor did not have the cursor.
 */
const BLOCK_SEL = '.bn-block-content';
export function captureCaret(root) {
  try {
    const sel = window.getSelection();
    if (!root || !sel || !sel.rangeCount || !root.contains(sel.anchorNode)) return null;
    const node = sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement;
    const block = node?.closest(BLOCK_SEL);
    const index = [...root.querySelectorAll(BLOCK_SEL)].indexOf(block);
    if (index < 0) return null;
    const r = document.createRange();
    r.selectNodeContents(block);
    r.setEnd(sel.anchorNode, sel.anchorOffset);
    const scroller = root.closest('.s-note-main');
    return { index, offset: r.toString().length, scrollTop: scroller ? scroller.scrollTop : null };
  } catch { return null; }
}
export function restoreCaret(root, saved, tries = 40) {
  if (!saved || !root) return;
  const blocks = root.querySelectorAll(BLOCK_SEL);
  const editable = root.querySelector('[contenteditable="true"]');
  if (!blocks.length || !editable || (blocks.length <= saved.index && tries > 0)) { if (tries > 0) setTimeout(() => restoreCaret(root, saved, tries - 1), 50); return; }
  try {
    const block = blocks[Math.min(saved.index, blocks.length - 1)];
    const walk = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    let left = saved.offset; let at = null; let off = 0; let last = null;
    for (let t = walk.nextNode(); t; t = walk.nextNode()) { last = t; if (left <= t.length) { at = t; off = left; break; } left -= t.length; }
    if (!at && last) { at = last; off = last.length; }
    editable.focus({ preventScroll: true });
    const sel = window.getSelection();
    const r = document.createRange();
    if (at) r.setStart(at, off); else r.setStart(block, 0);
    r.collapse(true);
    sel.removeAllRanges(); sel.addRange(r);
    const scroller = root.closest('.s-note-main');
    if (scroller && saved.scrollTop !== null) scroller.scrollTop = saved.scrollTop;
  } catch { /* the editor changed shape: leave the cursor where it is */ }
}

const API_BASE = import.meta.env.VITE_API_URL || '/api';
/**
 * N52: "Ask about this note" answers inside the side card, from the same one-shot endpoint the Ask page streams from
 * (POST /ai/hub/chat with the note attached). "Continue in Ask" opens the full page with the same question.
 */
export function NoteAskPanel({ noteId, noteTitle, beforeAsk, onOpenFull }) {
  const [question, setQuestion] = useState('');
  const [ans, setAns] = useState(null); // { q, text, status: thinking|streaming|done|error|consent|stopped, error, consent }
  const abortRef = useRef(null);
  useEffect(() => () => abortRef.current?.abort(), []);
  useEffect(() => { abortRef.current?.abort(); setAns(null); }, [noteId]);
  const run = async (q, allowCloud = false) => {
    const text = q.trim();
    if (!text || !noteId) return;
    abortRef.current?.abort();
    const ctl = new AbortController(); abortRef.current = ctl;
    setAns({ q: text, text: '', status: 'thinking' });
    try { await beforeAsk?.(); } catch { /* the save status says so */ }
    try {
      const res = signOutIfRejected(await fetch(`${API_BASE}/ai/hub/chat`, { method: 'POST', headers: authHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify({ messages: [{ role: 'user', content: text }], noteIds: [noteId], allowCloud }), signal: ctl.signal }));
      if (!res.ok || !res.body) {
        let msg = ''; try { const j = await res.json(); msg = typeof j?.error === 'string' ? j.error : (j?.error?.message || j?.message || ''); } catch { /* not JSON */ }
        setAns((a) => ({ ...a, status: 'error', error: msg || `The AI could not answer (error ${res.status}).` }));
        return;
      }
      const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const parts = buf.split('\n\n'); buf = parts.pop();
        for (const part of parts) {
          if (!part.startsWith('data: ')) continue;
          let ev; try { ev = JSON.parse(part.slice(6)); } catch { continue; }
          if (ev.type === 'delta') setAns((a) => ({ ...a, status: 'streaming', text: a.text + ev.text }));
          else if (ev.type === 'done') setAns((a) => ({ ...a, status: 'done' }));
          else if (ev.type === 'consent') setAns((a) => ({ ...a, status: 'consent', consent: { provider: ev.provider, message: ev.message } }));
          else if (ev.type === 'error') setAns((a) => ({ ...a, status: 'error', error: ev.message }));
        }
      }
      setAns((a) => (a && (a.status === 'streaming' || a.status === 'thinking') ? { ...a, status: 'done' } : a));
    } catch {
      setAns((a) => (a ? { ...a, status: ctl.signal.aborted ? 'stopped' : 'error', error: 'Could not reach Peblo. Is the app still running?' } : a));
    }
  };
  const ask = (q) => { run(q); setQuestion(''); };
  const busy = !!ans && (ans.status === 'thinking' || ans.status === 'streaming');
  return (
    <form className="s-note-ask rl-ask" onSubmit={(e) => { e.preventDefault(); ask(question); }}>
      <label htmlFor="s-note-ask" className="s-ask-label" style={{ fontSize: 15 }}><Sparkles size={17} /> Ask about this note</label>
      <div className="s-ask-row small">
        <input id="s-note-ask" value={question} onChange={(e) => setQuestion(e.target.value)} placeholder={noteId ? 'What should I remember from this?' : 'Save the note to ask about it'} disabled={!noteId} autoComplete="off" />
        <button type="submit" className="s-send small" aria-label="Ask" disabled={!question.trim() || !noteId || busy}><ArrowUp size={16} strokeWidth={2.4} /></button>
      </div>
      {!ans && (
        <div className="s-chips" style={{ gap: 6 }}>
          <button type="button" className="s-chip small" disabled={!noteId} onClick={() => ask('Summarise this note in a few short bullet points.')}>Summarise</button>
          <button type="button" className="s-chip small" disabled={!noteId} onClick={() => ask('Make 8 flashcards (question and answer) from this note.')}>Flashcards</button>
          <button type="button" className="s-chip small" disabled={!noteId} onClick={() => ask('List the tasks and to-dos hidden in this note.')}>Find tasks</button>
        </div>
      )}
      {ans && (
        <div className="nx-answer" data-testid="note-ask-answer" aria-live="polite">
          <p className="nx-q">{ans.q}</p>
          {ans.status === 'thinking' && <p className="nx-muted" role="status">Thinking…</p>}
          {ans.text && <div className="nx-a" dangerouslySetInnerHTML={{ __html: renderAnswer(ans.text, 0) }} />}
          {ans.status === 'error' && <p className="nx-err" role="alert">{ans.error}</p>}
          {ans.status === 'stopped' && <p className="nx-muted">Stopped.</p>}
          {ans.status === 'consent' && <p className="nx-muted">{ans.consent?.message || 'This needs a cloud AI model.'} <button type="button" className="nx-link" onClick={() => run(ans.q, true)}>Use {ans.consent?.provider || 'the cloud model'} for this answer</button></p>}
          <div className="nx-abtns">
            {busy ? <button type="button" className="nx-link" onClick={() => abortRef.current?.abort()}>Stop</button> : <button type="button" className="nx-link" onClick={() => setAns(null)}>Clear</button>}
            <button type="button" className="nx-link" data-testid="note-ask-full" onClick={() => onOpenFull?.(ans.q)}>Continue in Ask</button>
          </div>
        </div>
      )}
    </form>
  );
}

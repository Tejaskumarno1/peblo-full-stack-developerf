import { useEffect, useMemo, useState } from 'react';
import { ArrowUp, CircleCheck, Clock, Send, X, Heart, Lightbulb, ThumbsUp, FileText, History, Link2, MessageSquare, Pencil, Eye, Sparkles, User } from 'lucide-react';
import { commentsApi, ago } from '../utils/comments';


const ICONS = { like: ThumbsUp, love: Heart, idea: Lightbulb, done: CircleCheck };
export function useReactions(token, sid) {
  const [reactions, setReactions] = useState([]);
  const rbase = `/api/public/note/${encodeURIComponent(token)}/reactions`;
  useEffect(() => {
    if (!token) return undefined;
    let live = true;
    const load = () => fetch(`${rbase}?sid=${encodeURIComponent(sid)}`).then((r) => (r.ok ? r.json() : null)).then((j) => { if (live && j) setReactions(j.reactions); }).catch(() => {});
    load();
    const t = setInterval(load, 20000);
    return () => { live = false; clearInterval(t); };
  }, [token, sid]); // eslint-disable-line react-hooks/exhaustive-deps
  const react = async (kind) => {
    setReactions((rs) => rs.map((r) => (r.kind === kind ? { ...r, mine: !r.mine, n: r.n + (r.mine ? -1 : 1) } : r)));
    try { const r = await fetch(rbase, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: sid, kind }) }); if (r.ok) setReactions((await r.json()).reactions); } catch { /* the next refresh corrects it */ }
  };

  return { reactions, react };
}

const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();

/** Plain-language answers worked out from the page text itself, so the card works without any AI service. */
function answer(kind, text, headings) {
  const lines = String(text || '').split('\n').map(clean).filter(Boolean);
  const body = lines.filter((l) => l.length > 24);
  if (kind === 'sum') {
    const parts = body.slice(0, 2).map((l) => (l.length > 160 ? `${l.slice(0, 157)}…` : l));
    return parts.length ? parts.join(' ') : 'This page is short, so there is not much to summarise yet.';
  }
  if (kind === 'dec') {
    const hit = lines.filter((l) => /\b(decid|agree|approved|will|must|owner|sign[- ]off)/i.test(l)).slice(0, 3);
    return hit.length ? hit.join(' · ') : 'No decisions are written down on this page.';
  }
  if (kind === 'task') {
    const hit = lines.filter((l) => /^(\[ \]|- \[ \]|todo|action)/i.test(l) || /\b(by (mon|tue|wed|thu|fri)|due)\b/i.test(l)).slice(0, 3);
    return hit.length ? hit.join(' · ') : 'No tasks found on this page.';
  }
  const q = kind.toLowerCase().split(/\W+/).filter((w) => w.length > 3);
  const scored = body.map((l) => [q.filter((w) => l.toLowerCase().includes(w)).length, l]).sort((a, b) => b[0] - a[0]);
  if (scored[0]?.[0] > 0) return scored[0][1].slice(0, 200);
  const h = headings.find((x) => q.some((w) => x.title.toLowerCase().includes(w)));
  return h ? `See the section "${h.title}".` : 'I could not find that on this page.';
}

export default function ShareCards({ token, sid, name, canEdit, owner, canComment, pageText, headings, changes, showChanges, onToggleChanges, onHistory, onJump, sheet }) {
  const [q, setQ] = useState('');
  const [reply, setReply] = useState('');
  const [comments, setComments] = useState([]);
  const { reactions, react } = useReactions(token, sid);
  const [askOpen, setAskOpen] = useState(false);
  useEffect(() => {
    if (!canComment || !token || !window.matchMedia?.('(min-width: 1620px)').matches) return undefined;
    let live = true;
    const load = () => commentsApi.list({ kind: 'guest', share: token, sid, name }).then((list) => { if (live) setComments(list); }).catch(() => {});
    load();
    const t = setInterval(load, 20000);
    return () => { live = false; clearInterval(t); };
  }, [canComment, token, sid, name]);

  const open = useMemo(() => comments.filter((c) => !c.parentId && c.status === 'open'), [comments]);
  const ask = (kind) => setReply(answer(kind, pageText, headings));
  const submit = (event) => { event.preventDefault(); if (q.trim()) { ask(q.trim()); } };

  return (
    <aside className={`rcards${sheet ? ' in-sheet' : ''}`} data-testid={sheet ? 'rcards-sheet' : 'rcards'} aria-label="Page cards">
      <section className="rc rc-ask" data-testid="rc-ask">
        <h3><Sparkles size={16} />Ask about this page</h3>
        <form className="rc-q" onSubmit={submit}>
          <input aria-label="Ask about this page" placeholder="What should I remember from this?" value={q} onChange={(e) => setQ(e.target.value)} />
          <button type="submit" aria-label="Ask"><ArrowUp size={16} /></button>
        </form>
        <div className="rc-chips">
          <button type="button" onClick={() => ask('sum')}>Summarise</button>
          <button type="button" onClick={() => ask('dec')}>Key decisions</button>
          <button type="button" onClick={() => ask('task')}>Find tasks</button>
        </div>
        {reply && <p className="rc-reply" data-testid="rc-reply">{reply}</p>}
      </section>
      {!canComment && !canEdit && <section className="rc rc-com" data-testid="rc-comments-locked">
        <h3><MessageSquare size={16} />Comments</h3>
        <p className="rc-none">Comments are for people who can edit. Ask the owner for access and your note joins the thread.</p>
        <button type="button" className="rc-ask-btn" data-testid="request-edit" onClick={() => setAskOpen(true)}><Send size={14} />Request edit access</button>
      </section>}
      {canComment && <section className="rc rc-com" data-testid="rc-comments">
        <h3><MessageSquare size={16} />Comments<span className="n">{open.length}</span></h3>
        {open.length === 0 && <p className="rc-none">No open comments. Select words in the page to start one.</p>}
        {open.slice(0, 3).map((c) => <div className="rc-c" key={c.id}><span className="rc-av">{(c.author?.name || '?')[0].toUpperCase()}</span><div><b>{c.author?.name}</b><small>{ago(c.createdAt)}</small><p>{c.body}</p></div></div>)}
      </section>}
      {changes && <section className="rc rc-chg" data-testid="rc-changes">
        <h3><History size={16} />Since your last visit<span className="n">{changes.count} change{changes.count > 1 ? 's' : ''}</span></h3>
        <label className="rc-sw"><span>Show marks in the page</span><input type="checkbox" role="switch" checked={showChanges} onChange={onToggleChanges} /></label>
      </section>}
      {reactions.length > 0 && <div className="rc-react" data-testid="rc-react" role="group" aria-label="Reactions">{reactions.map((r) => { const Icon = ICONS[r.kind]; return <button key={r.kind} type="button" data-testid={`rx-${r.kind}`} className={r.mine ? 'on' : ''} aria-pressed={r.mine} aria-label={`${r.kind} ${r.n}`} onClick={() => react(r.kind)}><Icon size={15} />{r.n > 0 && <b>{r.n}</b>}</button>; })}</div>}
      <button type="button" className="rc-ver" data-testid="rc-versions" onClick={onHistory}><History size={15} />Version history</button>
    {askOpen && <EditRequest token={token} sid={sid} name={name} owner={owner} onClose={() => setAskOpen(false)} />}
    </aside>
  );
}

const rel = (iso) => { if (!iso) return ''; const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000); if (m < 1) return 'just now'; if (m < 60) return `${m} min ago`; if (m < 1440) return `${Math.round(m / 60)} h ago`; return `${Math.round(m / 1440)} d ago`; };
const left = (iso) => { if (!iso) return 'No end'; const d = Math.round((new Date(iso).getTime() - Date.now()) / 86400000); return d <= 0 ? 'Today' : `In ${d} day${d > 1 ? 's' : ''}`; };

/** S32: details about a shared to-do, in the left column. */
export function TodoAbout({ data }) {
  const rows = [[User, 'Shared by', data.author || 'Someone'], [Clock, 'Updated', rel(data.updatedAt)], [Link2, 'Link ends', left(data.expiresAt)], [data.canEdit ? Pencil : Eye, 'Your role', data.canEdit ? 'Can edit' : 'Can view']];
  return (
    <aside className="about-card" data-testid="todo-about" aria-label="About this to-do">
      <h3>About this to-do</h3>
      {rows.map(([Icon, k, v]) => <div className="ab-row" key={k}><span className="ab-i"><Icon size={15} /></span><b>{k}</b><em>{v}</em></div>)}
    </aside>
  );
}

/** S32: people here and the keep-a-copy card, in the right column of a shared to-do. */
export function TodoCards({ viewers, myColor, peerColor, saved, busy, onSave }) {
  return (
    <aside className="rcards todo-cards" data-testid="todo-cards" aria-label="Page cards">
      <section className="rc rc-ask" data-testid="rc-people">
        <h3>People here</h3>
        <div className="rc-people">{viewers.slice(0, 5).map((v) => <span key={v.id} className="hd-av" style={{ background: v.self ? myColor : peerColor(v.id) }} title={v.name}>{(v.name || 'G')[0].toUpperCase()}</span>)}<span className="rc-names">{viewers.map((v) => v.self ? 'You' : v.name).slice(0, 3).join(', ') || 'Just you'}</span></div>
      </section>
      <section className="rc rc-chg" data-testid="rc-keep">
        <h3>Keep this to-do</h3>
        <p className="rc-none">Save a copy to your own tasks. The original stays shared.</p>
        <button type="button" className="rc-save" disabled={busy} onClick={onSave}><FileText size={15} />{saved ? 'Open in Peblo' : 'Save to my Peblo'}</button>
      </section>
    </aside>
  );
}

/** S28: ask the owner for edit access. */
export function EditRequest({ token, sid, name, owner, onClose, kind = 'note' }) {
  const [who, setWho] = useState(name && name !== 'Guest' ? name : '');
  const [msg, setMsg] = useState('');
  const [state, setState] = useState('idle');
  const send = async () => {
    setState('busy');
    try {
      const r = await fetch(`/api/public/${kind}/${encodeURIComponent(token)}/edit-request`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: sid, name: who || 'Guest', message: msg }) });
      setState(r.ok ? 'sent' : 'error');
    } catch { setState('error'); }
  };
  return (
    <div className="er-back" data-testid="edit-request" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="er-card" role="dialog" aria-modal="true" aria-label="Ask for edit access">
        <button type="button" className="er-x" aria-label="Close" onClick={onClose}><X size={16} /></button>
        <h3>{owner ? `Ask ${owner} for edit access` : 'Ask for edit access'}</h3>
        {state === 'sent' ? <p className="er-done" data-testid="edit-request-sent">Request sent. The owner gets a notification. This page keeps working while you wait.</p> : <>
          <label>Your name<input aria-label="Your name" data-testid="er-name" value={who} maxLength={40} onChange={(e) => setWho(e.target.value)} /></label>
          <label>Message<textarea aria-label="Message" data-testid="er-msg" rows={3} maxLength={400} value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="What would you like to change?" /></label>
          <div className="er-btns"><button type="button" className="btn primary" data-testid="er-send" disabled={state === 'busy'} onClick={send}><Send size={15} />Send request</button><button type="button" className="btn" onClick={onClose}>Cancel</button></div>
          {state === 'error' && <p className="er-err" role="alert">That did not go through. Try again.</p>}
          <small>{owner || 'The owner'} gets a notification. This page keeps working while you wait.</small>
        </>}
      </div>
    </div>
  );
}

/** Under the page when the side cards have no room: reactions and, for viewers, the edit request. */
export function EndOfPage({ token, sid, name, canEdit, owner }) {
  const { reactions, react } = useReactions(token, sid);
  const [askOpen, setAskOpen] = useState(false);
  return (
    <section className="endcap" data-testid="endcap" aria-label="React to this page">
      <b>Was this useful?</b>
      <div className="rc-react" role="group" aria-label="Reactions">{reactions.map((r) => { const Icon = ICONS[r.kind]; return <button key={r.kind} type="button" data-testid={`end-react-${r.kind}`} className={r.mine ? 'on' : ''} aria-pressed={r.mine} aria-label={`${r.kind} ${r.n}`} onClick={() => react(r.kind)}><Icon size={15} />{r.n > 0 && <b>{r.n}</b>}</button>; })}</div>
      {!canEdit && <button type="button" className="rc-ask-btn" data-testid="end-request-edit" onClick={() => setAskOpen(true)}><Send size={14} />Request edit access</button>}
      {askOpen && <EditRequest token={token} sid={sid} name={name} owner={owner} onClose={() => setAskOpen(false)} />}
    </section>
  );
}

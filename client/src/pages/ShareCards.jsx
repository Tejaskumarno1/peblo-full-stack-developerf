import { useEffect, useMemo, useState } from 'react';
import { ArrowUp, History, MessageSquare, Sparkles } from 'lucide-react';
import { commentsApi, ago } from '../utils/comments';

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

export default function ShareCards({ token, sid, name, canComment, pageText, headings, changes, showChanges, onToggleChanges, onHistory, onJump }) {
  const [q, setQ] = useState('');
  const [reply, setReply] = useState('');
  const [comments, setComments] = useState([]);

  useEffect(() => {
    if (!canComment || !token) return undefined;
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
    <aside className="rcards" data-testid="rcards" aria-label="Page cards">
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
      {canComment && <section className="rc rc-com" data-testid="rc-comments">
        <h3><MessageSquare size={16} />Comments<span className="n">{open.length}</span></h3>
        {open.length === 0 && <p className="rc-none">No open comments. Select words in the page to start one.</p>}
        {open.slice(0, 3).map((c) => <div className="rc-c" key={c.id}><span className="rc-av">{(c.author?.name || '?')[0].toUpperCase()}</span><div><b>{c.author?.name}</b><small>{ago(c.createdAt)}</small><p>{c.body}</p></div></div>)}
      </section>}
      {changes && <section className="rc rc-chg" data-testid="rc-changes">
        <h3><History size={16} />Since your last visit<span className="n">{changes.count} change{changes.count > 1 ? 's' : ''}</span></h3>
        <label className="rc-sw"><span>Show marks in the page</span><input type="checkbox" role="switch" checked={showChanges} onChange={onToggleChanges} /></label>
      </section>}
      <button type="button" className="rc-ver" data-testid="rc-versions" onClick={onHistory}><History size={15} />Version history</button>
    </aside>
  );
}

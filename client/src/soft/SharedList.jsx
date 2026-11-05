import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import api from '../api/client';
import './sharedlist.css';

const sidKey = 'peblo-list-session';
const nameKey = 'peblo-list-name';
const getSid = () => {
  try { let s = localStorage.getItem(sidKey); if (!s) { s = `g${crypto.randomUUID().replace(/-/g, '')}`; localStorage.setItem(sidKey, s); } return s; } catch { return `g${Math.random().toString(36).slice(2)}${Date.now().toString(36)}abcdef`; }
};
const when = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  const days = Math.round((new Date(d).setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0)) / 86400000);
  const t = d.getHours() === 23 && d.getMinutes() === 59 ? '' : ` ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
  if (days === 0) return `Today${t}`;
  if (days === 1) return `Tomorrow${t}`;
  if (days === -1) return `Yesterday${t}`;
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) + t;
};
const PERM_TEXT = { view: 'Read-only', tick: 'You can tick and comment', add: 'You can propose tasks', edit: 'You can edit' };

/** What a guest sees on a shared task list: progress, the tasks, and whatever the owner allowed them to do. */
export default function SharedList() {
  const { token } = useParams();
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [name, setName] = useState(() => { try { return localStorage.getItem(nameKey) || ''; } catch { return ''; } });
  const [draft, setDraft] = useState('');
  const [note, setNote] = useState('');
  const [openC, setOpenC] = useState(null);
  const [cText, setCText] = useState('');
  const sid = useMemo(getSid, []);

  const load = useCallback(async () => {
    try { const r = await api.get(`/public/list/${encodeURIComponent(token)}`); setData(r.data); setErr(''); } catch (e) { setErr(e?.response?.data?.error || 'This list is not shared any more.'); }
  }, [token]);
  useEffect(() => { load(); const i = setInterval(load, 20000); return () => clearInterval(i); }, [load]);
  useEffect(() => { document.title = data ? `${data.list} · Peblo` : 'Shared list · Peblo'; }, [data]);

  const who = () => { const n = name.trim() || 'Guest'; try { localStorage.setItem(nameKey, n); } catch { /* ignore */ } return n; };
  const tick = async (t) => {
    setData((d) => ({ ...d, tasks: d.tasks.map((x) => (x.id === t.id ? { ...x, completed: !t.completed } : x)), progress: { ...d.progress, done: d.progress.done + (t.completed ? -1 : 1) } }));
    try { await api.put(`/public/list/${token}/tasks/${t.id}`, { completed: !t.completed, sessionId: sid, name: who() }); } catch (e) { setNote(e?.response?.data?.error || 'Could not save that.'); }
    load();
  };
  const add = async (e) => {
    e.preventDefault();
    if (!draft.trim()) return;
    try { const r = await api.post(`/public/list/${token}/tasks`, { text: draft.trim(), sessionId: sid, name: who() }); setNote(r.data.waiting ? 'Sent. It joins the list when the owner approves it.' : 'Added.'); setDraft(''); load(); } catch (er) { setNote(er?.response?.data?.error || 'Could not add that.'); }
  };
  const comment = async (t) => {
    if (!cText.trim()) return;
    try { await api.post(`/public/list/${token}/tasks/${t.id}/comments`, { body: cText.trim(), sessionId: sid, name: who() }); setCText(''); load(); } catch (er) { setNote(er?.response?.data?.error || 'Could not send that.'); }
  };

  if (err) return <main className="sl-page"><div className="sl-wrap"><h1>This list is not shared any more</h1><p className="sl-sub">{err}</p></div></main>;
  if (!data) return <main className="sl-page"><div className="sl-wrap"><p className="sl-sub">Loading...</p></div></main>;
  const pct = data.progress.total ? Math.round((data.progress.done / data.progress.total) * 100) : 0;
  const canTick = data.perm !== 'view' && data.perm !== undefined;
  const open = data.tasks.filter((t) => !t.completed);
  const done = data.tasks.filter((t) => t.completed);
  const ends = data.expiresAt ? ` · ends ${new Date(data.expiresAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}` : '';
  const row = (t) => (
    <li key={t.id} className="sl-task" data-testid="shared-task">
      <div className="sl-trow">
        {canTick ? <button type="button" className={`sl-box${t.completed ? ' on' : ''}`} role="checkbox" aria-checked={t.completed} aria-label={`Mark "${t.text}" ${t.completed ? 'not done' : 'done'}`} onClick={() => tick(t)} /> : <span className={`sl-box ro${t.completed ? ' on' : ''}`} aria-hidden="true" />}
        <span className={`sl-text${t.completed ? ' done' : ''}`}>{t.text}</span>
        {t.priority === 'high' && !t.completed && <span className="sl-chip hi">High</span>}
        {t.deadline && <span className="sl-chip">{t.completed ? 'Done' : when(t.deadline)}</span>}
        {data.perm !== 'view' && <button type="button" className="sl-cbtn" onClick={() => setOpenC(openC === t.id ? null : t.id)}>{t.comments.length ? `${t.comments.length} comment${t.comments.length === 1 ? '' : 's'}` : 'Comment'}</button>}
      </div>
      {t.steps.length > 0 && <ul className="sl-steps">{t.steps.map((s, i) => <li key={i} className={s.done ? 'done' : ''}>{s.text}</li>)}</ul>}
      {openC === t.id && (
        <div className="sl-comments">
          {t.comments.map((c, i) => <p key={i}><b>{c.author}</b> {c.body}</p>)}
          <form onSubmit={(e) => { e.preventDefault(); comment(t); }}><input aria-label="Your comment" placeholder="Write a comment" value={cText} onChange={(e) => setCText(e.target.value)} /><button type="submit">Send</button></form>
        </div>
      )}
    </li>
  );
  return (
    <main className="sl-page">
      <div className="sl-wrap">
        <header className="sl-top"><span className="sl-dot" /><b>peblo</b><span className="grow" /><span className="sl-pill" data-testid="shared-perm">{PERM_TEXT[data.perm]}{ends}</span></header>
        <h1>{data.list}</h1>
        <p className="sl-sub">Shared by {data.owner || 'the owner'} · updated {when(data.updatedAt).toLowerCase() || 'recently'}</p>
        {data.showProgress && (
          <section className="sl-card" data-testid="shared-progress">
            <div className="sl-prog"><b>Progress</b><b>{data.progress.done} of {data.progress.total} done</b></div>
            <div className="sl-bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${pct}%` }} /></div>
            {data.next && <p className="sl-next">Next up: {data.next.text}{data.next.deadline ? `, due ${when(data.next.deadline).toLowerCase()}` : ''}</p>}
          </section>
        )}
        <ul className="sl-list sl-card">{open.map(row)}{open.length === 0 && <li className="sl-empty">Everything on this list is done.</li>}</ul>
        {done.length > 0 && <ul className="sl-list sl-card dim">{done.map(row)}</ul>}
        {(data.perm === 'add' || data.perm === 'edit') && (
          <form className="sl-add" onSubmit={add}>
            <input aria-label="Your name" placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} />
            <input aria-label="Add a task" placeholder={data.perm === 'add' ? 'Suggest a task (the owner approves it)' : 'Add a task'} value={draft} onChange={(e) => setDraft(e.target.value)} />
            <button type="submit" disabled={!draft.trim()}>{data.perm === 'add' ? 'Suggest' : 'Add'}</button>
          </form>
        )}
        {canTick && data.perm !== 'add' && data.perm !== 'edit' && <div className="sl-add"><input aria-label="Your name" placeholder="Your name (shown on comments)" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} /></div>}
        {note && <p className="sl-note" role="status">{note}</p>}
        <p className="sl-foot">Text and links are readable by any AI that opens this page.</p>
      </div>
    </main>
  );
}

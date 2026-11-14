// The discussion on a team task (mockup K04): comments with @mentions, review requests and the activity trail in one thread.
import { useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AtSign, Send, Eye } from 'lucide-react';
import { todosAPI } from '../api';
import './teamshare.css';

const ago = (d) => {
  const s = Math.max(0, (Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
};
const LINE = {
  status: (a) => `moved this to ${{ todo: 'To do', doing: 'In progress', review: 'In review' }[a.detail] || a.detail}`,
  done: () => 'marked this done',
  review: (a) => `asked for a review${a.detail && a.detail !== 'asked for a review' ? `: ${a.detail}` : ''}`,
  assign: () => 'changed who it is assigned to',
};
export const Initial = ({ name, size = 28 }) => <span className="tt-av" style={{ width: size, height: size }} aria-hidden>{(name || '?').trim()[0]?.toUpperCase()}</span>;

export default function TaskThread({ taskId, team }) {
  const qc = useQueryClient();
  const [text, setText] = useState('');
  const [mentions, setMentions] = useState([]);
  const [picker, setPicker] = useState(false);
  const [review, setReview] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const box = useRef(null);
  const { data } = useQuery({ queryKey: ['thread', taskId], queryFn: () => todosAPI.thread(taskId).then((r) => r.data), refetchInterval: 10000 });
  const items = useMemo(() => {
    if (!data) return [];
    const c = (data.comments || []).map((x) => ({ ...x, type: 'comment' }));
    const a = (data.activity || []).filter((x) => x.kind !== 'comment').map((x) => ({ ...x, type: 'activity' }));
    return [...c, ...a].sort((x, y) => +new Date(x.createdAt) - +new Date(y.createdAt));
  }, [data]);
  const others = team.people.filter((p) => p.id !== team.me);
  const refresh = () => { qc.invalidateQueries({ queryKey: ['thread', taskId] }); qc.invalidateQueries({ queryKey: ['todos'] }); };
  const mention = (p) => {
    const first = p.name.split(' ')[0];
    setText((t) => `${t}${t && !/\s$/.test(t) ? ' ' : ''}@${first} `);
    setMentions((m) => (m.includes(p.id) ? m : [...m, p.id]));
    setPicker(false);
    box.current?.focus();
  };
  const send = async () => {
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true); setErr('');
    try {
      const ids = mentions.filter((id) => { const p = team.people.find((x) => x.id === id); return p && body.includes('@' + p.name.split(' ')[0]); });
      await todosAPI.comment(taskId, body, ids);
      setText(''); setMentions([]); refresh();
    } catch (e) { setErr(e.response?.data?.error || 'Could not post that.'); }
    setBusy(false);
  };
  const ask = async (p) => {
    try { await todosAPI.requestReview(taskId, [p.id]); setReview(false); refresh(); } catch (e) { setErr(e.response?.data?.error || 'Could not ask for a review.'); }
  };
  const body = (b) => b.split(/(@\w+)/g).map((part, i) => (/^@\w+$/.test(part) ? <b key={i} className="tt-at">{part}</b> : part));

  return (
    <section className="s-sheet-sec tt" aria-label="Discussion" data-testid="task-thread">
      <span className="s-sheet-lab">Discussion</span>
      <ol className="tt-list">
        {items.length === 0 && <li className="tt-empty">No comments yet. Ask a question or leave an update.</li>}
        {items.map((x) => x.type === 'comment' ? (
          <li key={x.id} className="tt-c" data-testid="thread-comment"><Initial name={x.name} /><div><p className="tt-h"><b>{x.userId === team.me ? 'You' : x.name}</b><span>{ago(x.createdAt)}</span></p><p className="tt-b">{body(x.body)}</p></div></li>
        ) : (
          <li key={x.id} className="tt-a" data-testid="thread-activity"><span>{x.userId === team.me ? 'You' : x.name} {(LINE[x.kind] || (() => x.kind))(x)}</span><span>{ago(x.createdAt)}</span></li>
        ))}
      </ol>
      <div className="tt-compose">
        <textarea ref={box} rows={2} aria-label="Write a comment" placeholder="Write a comment" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(); } }} />
        <div className="tt-actions">
          <button type="button" className="tt-ico" data-testid="thread-mention" aria-label="Mention someone" aria-expanded={picker} onClick={() => { setPicker(!picker); setReview(false); }}><AtSign size={16} /></button>
          <button type="button" className="tt-ico" data-testid="thread-review" aria-label="Ask for a review" aria-expanded={review} onClick={() => { setReview(!review); setPicker(false); }}><Eye size={16} /> Ask for a review</button>
          <button type="button" className="tt-send" data-testid="thread-send" disabled={!text.trim() || busy} onClick={send}><Send size={15} /> Comment</button>
        </div>
        {(picker || review) && (
          <div className="s-sheet-pills tk-people" role="group" aria-label={review ? 'Who should review it' : 'Who to mention'}>
            {others.length === 0 && <span className="tk-anyone">Nobody else is in this team yet.</span>}
            {others.map((p) => <button key={p.id} type="button" data-testid="thread-person" onClick={() => (review ? ask(p) : mention(p))}>{p.name.split(' ')[0]}</button>)}
          </div>
        )}
        {err && <p className="s-sheet-error" role="alert">{err}</p>}
      </div>
    </section>
  );
}


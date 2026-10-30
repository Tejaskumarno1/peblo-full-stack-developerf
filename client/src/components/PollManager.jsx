import { useCallback, useEffect, useState } from 'react';
import { BarChart3, Plus, X } from 'lucide-react';
import api from '../api/client';

/** Owner side: write polls into the shared page, watch the results, close or reset them. */
export default function PollManager({ noteId }) {
  const [polls, setPolls] = useState([]);
  const [form, setForm] = useState(false);
  const [q, setQ] = useState('');
  const [opts, setOpts] = useState(['', '']);
  const [named, setNamed] = useState(false);
  const [err, setErr] = useState('');
  const load = useCallback(async () => {
    try { const { data } = await api.get(`/share/note/${noteId}/polls`); setPolls(data.polls || []); } catch { /* shown empty */ }
  }, [noteId]);
  useEffect(() => {
    void load();
    const t = window.setInterval(load, 4000);
    return () => window.clearInterval(t);
  }, [load]);
  const create = async () => {
    setErr('');
    try {
      await api.post(`/share/note/${noteId}/polls`, { question: q, options: opts.filter((o) => o.trim()), named });
      setForm(false); setQ(''); setOpts(['', '']); setNamed(false); await load();
    } catch (e) { setErr(e?.response?.data?.error || 'Could not add the poll.'); }
  };
  const act = async (pid, verb) => {
    setErr('');
    try { await api.post(`/share/note/${noteId}/polls/${pid}/${verb}`); } catch (e) { setErr(e?.response?.data?.error || 'Could not change the poll. Try again.'); }
    await load();
  };
  return (
    <div className="pm" data-testid="poll-manager">
      <div className="pm-head"><b><BarChart3 size={14} aria-hidden="true" />Polls on this page</b>
        {!form && <button type="button" data-testid="poll-add" onClick={() => setForm(true)}><Plus size={13} />Add a poll</button>}</div>
      {polls.length === 0 && !form && <small className="pm-empty">Ask readers a question. They answer on the page.</small>}
      <ul>
        {polls.map((p) => (
          <li key={p.id} data-testid="pm-item">
            <div className="pm-q">{p.question}<small data-testid="pm-count">{p.total} {p.total === 1 ? 'vote' : 'votes'}{p.open ? '' : ' · closed'}</small></div>
            {p.options.map((o, i) => <div className="pm-o" key={i}><span>{o}</span><b>{p.counts[i]}</b></div>)}
            <div className="pm-acts">
              <button type="button" data-testid="pm-close" onClick={() => act(p.id, p.open ? 'close' : 'reopen')}>{p.open ? 'Close' : 'Reopen'}</button>
              <button type="button" data-testid="pm-reset" onClick={() => act(p.id, 'reset')}>Reset</button>
              <button type="button" data-testid="pm-remove" aria-label="Delete poll" onClick={() => act(p.id, 'remove')}><X size={13} /></button>
            </div>
          </li>
        ))}
      </ul>
      {err && !form && <small className="pm-err" role="alert">{err}</small>}
      {form && <div className="pm-form">
        <input data-testid="pm-q" placeholder="Your question" aria-label="Poll question" maxLength={140} value={q} onChange={(e) => setQ(e.target.value)} />
        {opts.map((o, i) => <input key={i} data-testid={`pm-opt-${i}`} placeholder={`Option ${i + 1}`} aria-label={`Option ${i + 1}`} maxLength={60} value={o} onChange={(e) => setOpts((cur) => cur.map((x, j) => (j === i ? e.target.value : x)))} />)}
        {opts.length < 4 && <button type="button" className="pm-more" data-testid="pm-more" onClick={() => setOpts((cur) => [...cur, ''])}>Add option</button>}
        <label className="pm-named"><input type="checkbox" data-testid="pm-named" checked={named} onChange={(e) => setNamed(e.target.checked)} />Show who voted what</label>
        {err && <small className="pm-err" role="alert">{err}</small>}
        <div className="pm-acts"><button type="button" className="ok" data-testid="pm-create" onClick={create}>Add to page</button><button type="button" onClick={() => setForm(false)}>Cancel</button></div>
      </div>}
      <style>{`
.pm{margin-top:12px;padding-top:10px;border-top:1px solid rgba(127,127,127,.25)}
.pm-head{display:flex;align-items:center;justify-content:space-between;gap:8px}
.pm-head b{display:inline-flex;align-items:center;gap:6px;font-size:13px}
.pm button{border:1px solid rgba(127,127,127,.4);background:transparent;color:inherit;border-radius:8px;padding:4px 9px;font:inherit;font-size:12.5px;cursor:pointer;display:inline-flex;align-items:center;gap:4px}
.pm button.ok{background:#e2501a;border-color:#e2501a;color:#fff}
.pm ul{list-style:none;margin:8px 0 0;padding:0;display:flex;flex-direction:column;gap:10px}
.pm li{border:1px solid rgba(127,127,127,.25);border-radius:10px;padding:8px 10px}
.pm-q{display:flex;flex-direction:column;font-weight:600;font-size:13px}
.pm-q small,.pm-empty{opacity:.65;font-weight:400;font-size:11.5px}
.pm-o{display:flex;justify-content:space-between;font-size:12.5px;padding:2px 0}
.pm-acts{display:flex;gap:6px;margin-top:6px}
.pm-form{display:flex;flex-direction:column;gap:6px;margin-top:8px}
.pm-form input[type=text],.pm-form input:not([type]){border:1px solid rgba(127,127,127,.4);background:transparent;color:inherit;border-radius:8px;padding:6px 9px;font:inherit;font-size:13px}
.pm-named{display:flex;align-items:center;gap:6px;font-size:12.5px}
.pm-err{color:#c0392b}
`}</style>
    </div>
  );
}

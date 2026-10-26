import { useCallback, useEffect, useState } from 'react';
import { BarChart3, Check, Lock } from 'lucide-react';

/** Polls the owner wrote into the page: pick an option, see live results. */
export default function PagePolls({ token, sid, getName }) {
  const [polls, setPolls] = useState([]);
  const [busy, setBusy] = useState('');
  const base = `/api/public/note/${encodeURIComponent(token)}/polls`;
  const load = useCallback(async () => {
    try { const r = await fetch(`${base}?sid=${encodeURIComponent(sid)}`); if (r.ok) setPolls((await r.json()).polls || []); } catch { /* try again on the next tick */ }
  }, [base, sid]);
  useEffect(() => {
    void load();
    const t = window.setInterval(load, 5000);
    return () => window.clearInterval(t);
  }, [load]);
  const vote = async (p, choice) => {
    if (!p.open || busy) return;
    setPolls((cur) => cur.map((x) => (x.id === p.id ? { ...x, mine: choice } : x)));
    setBusy(p.id);
    try {
      const r = await fetch(`${base}/${p.id}/vote`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: sid, name: getName?.() || undefined, choice }) });
      if (r.ok) setPolls((await r.json()).polls || []); else await load();
    } catch { await load(); } finally { setBusy(''); }
  };
  if (!polls.length) return null;
  return (
    <section className="page-polls" data-testid="page-polls" aria-label="Polls">
      {polls.map((p) => {
        const show = p.mine !== null && p.mine !== undefined || !p.open;
        return (
          <div className="pp" key={p.id} data-testid="page-poll">
            <h3><BarChart3 size={16} aria-hidden="true" />{p.question}{!p.open && <span className="pp-closed"><Lock size={12} />Closed</span>}</h3>
            <ul>
              {p.options.map((o, i) => {
                const pct = p.total ? Math.round((p.counts[i] / p.total) * 100) : 0;
                return (
                  <li key={i}>
                    <button type="button" className={`pp-opt${p.mine === i ? ' mine' : ''}`} disabled={!p.open} aria-pressed={p.mine === i} data-testid={`pp-opt-${i}`} onClick={() => vote(p, i)}>
                      {show && <i style={{ width: `${pct}%` }} aria-hidden="true" />}
                      <span className="pp-t">{p.mine === i && <Check size={14} aria-hidden="true" />}{o}</span>
                      {show && <span className="pp-n" data-testid={`pp-count-${i}`}>{p.counts[i]} · {pct}%</span>}
                    </button>
                    {show && p.voters && <small className="pp-who">{p.voters.filter((v) => v.choice === i).map((v) => v.name).join(', ')}</small>}
                  </li>
                );
              })}
            </ul>
            <small className="pp-total" data-testid="pp-total">{p.total} {p.total === 1 ? 'vote' : 'votes'}{p.named ? '' : ' · votes are anonymous'}</small>
          </div>
        );
      })}
      <style>{`
.page-polls{display:flex;flex-direction:column;gap:14px;margin:28px 0}
.page-polls .pp{border:1px solid rgba(127,127,127,.3);border-radius:14px;padding:14px 16px}
.page-polls h3{margin:0 0 10px;font-size:16px;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.page-polls .pp-closed{display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:600;opacity:.7;text-transform:uppercase;letter-spacing:.04em}
.page-polls ul{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px}
.page-polls .pp-opt{position:relative;overflow:hidden;display:flex;justify-content:space-between;align-items:center;gap:10px;width:100%;text-align:left;border:1px solid rgba(127,127,127,.35);background:transparent;color:inherit;border-radius:10px;padding:9px 12px;font:inherit;cursor:pointer}
.page-polls .pp-opt:disabled{cursor:default}
.page-polls .pp-opt.mine{border-color:#e2501a}
.page-polls .pp-opt i{position:absolute;inset:0 auto 0 0;background:rgba(226,80,26,.16);transition:width .3s}
.page-polls .pp-t,.page-polls .pp-n{position:relative;display:inline-flex;align-items:center;gap:6px}
.page-polls .pp-n{font-size:12.5px;opacity:.75}
.page-polls .pp-who,.page-polls .pp-total{display:block;margin-top:4px;opacity:.65;font-size:12px}
`}</style>
    </section>
  );
}

import { useEffect, useState } from 'react';
import { GitCompare, RotateCcw, History } from 'lucide-react';

/** S24: the saved earlier versions of a shared note. Anyone can compare; only editors can restore (after one confirm). */
export default function ShareVersions({ token, sid, unlock, name, onCompare, onRestored, onError }) {
  const [list, setList] = useState(null);
  const [canRestore, setCanRestore] = useState(false);
  const [ask, setAsk] = useState(null);
  const [busy, setBusy] = useState('');
  const head = unlock ? { 'X-Share-Unlock': unlock } : {};
  const base = `/api/public/note/${encodeURIComponent(token)}/versions`;
  useEffect(() => {
    let live = true;
    fetch(`${base}?sid=${encodeURIComponent(sid)}`, { headers: head }).then((r) => r.json()).then((j) => { if (live) { setList(j.versions || []); setCanRestore(!!j.canRestore); } }).catch(() => { if (live) setList([]); });
    return () => { live = false; };
  }, [token, sid]); // eslint-disable-line react-hooks/exhaustive-deps
  const compare = async (v) => {
    setBusy(v.id);
    try {
      const j = await fetch(`${base}/${encodeURIComponent(v.id)}?sid=${encodeURIComponent(sid)}`, { headers: head }).then((r) => r.json());
      onCompare?.(j.content || '', new Date(v.createdAt).getTime());
    } catch { onError?.('Could not open that version'); } finally { setBusy(''); }
  };
  const restore = async (v) => {
    setBusy(v.id);
    try {
      const r = await fetch(`${base}/${encodeURIComponent(v.id)}/restore`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...head }, body: JSON.stringify({ sessionId: sid, name }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'Could not restore that version');
      setAsk(null); onRestored?.();
    } catch (cause) { onError?.(cause.message); } finally { setBusy(''); }
  };
  const when = (d) => new Date(d).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' });
  return (
    <div className="ver-list" data-testid="versions">
      <h5>Versions</h5>
      {list === null && <p className="fly-empty">Loading versions</p>}
      {list && list.length === 0 && <p className="fly-empty" data-testid="versions-empty">No earlier versions yet.</p>}
      {list && list.map((v) => (
        <div className="ver-row" key={v.id} data-testid="version-row">
          <History size={15} aria-hidden="true" />
          <div className="ver-main"><b>{v.label || when(v.createdAt)}</b><small>{v.by ? `${v.by}, ` : ''}{v.label ? when(v.createdAt) : 'saved version'}</small></div>
          <button type="button" className="ver-btn" data-testid="version-compare" disabled={!!busy} onClick={() => compare(v)}><GitCompare size={14} />Compare</button>
          {canRestore && <button type="button" className="ver-btn" data-testid="version-restore" disabled={!!busy} onClick={() => setAsk(ask === v.id ? null : v.id)}><RotateCcw size={14} />Restore</button>}
          {ask === v.id && <div className="ver-ask" role="alertdialog" data-testid="version-confirm"><span>Restore this version? Today's text is kept as a version.</span><button type="button" className="ver-btn dark" data-testid="version-confirm-yes" disabled={!!busy} onClick={() => restore(v)}>Restore this version</button><button type="button" className="ver-btn" onClick={() => setAsk(null)}>Cancel</button></div>}
        </div>
      ))}
      {list && list.length > 0 && !canRestore && <p className="ver-note" data-testid="versions-note">Restore this version: editors only.</p>}
    </div>
  );
}

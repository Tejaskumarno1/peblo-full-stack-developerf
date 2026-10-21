import { useEffect, useMemo, useState } from 'react';
import { X, RotateCcw } from 'lucide-react';
import { notesAPI } from '../api/index';
import { diffRows, collapseRows, plainForDiff } from '../utils/diff';
import { relTime } from './softUtils';

// Shows what is different between an earlier version and the note as it is now, side by side.
export default function VersionDiff({ doc, version, onClose, onRestore }) {
  const [old, setOld] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    notesAPI.getBackup(doc.id, version.id)
      .then((r) => { if (live) setOld(r.data?.backup?.content ?? ''); })
      .catch(() => { if (live) setError('Could not open that version.'); });
    return () => { live = false; };
  }, [doc.id, version.id]);

  const { rows, added, removed } = useMemo(() => {
    if (old == null) return { rows: [], added: 0, removed: 0 };
    const all = diffRows(plainForDiff(old), plainForDiff(doc.content || ''));
    return {
      rows: collapseRows(all),
      added: all.filter((r) => r.kind === 'add' || r.kind === 'change').length,
      removed: all.filter((r) => r.kind === 'del' || r.kind === 'change').length,
    };
  }, [old, doc.content]);
  const same = old != null && added === 0 && removed === 0;

  return (
    <div className="s-share-back" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }} onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }}>
      <div className="s-vd" role="dialog" aria-label="Compare versions">
        <div className="s-share-head">
          <div><b>Compare with an earlier version</b><small>{relTime(version.createdAt)} → now{old != null && !same ? `  ·  ${added} line${added === 1 ? '' : 's'} added, ${removed} removed` : ''}</small></div>
          <button type="button" className="s-capture-close" aria-label="Close" onClick={onClose}><X size={16} strokeWidth={2.4} /></button>
        </div>
        {error && <p className="s-share-msg warn" role="alert">{error}</p>}
        {old == null && !error && <p className="s-share-msg">Loading…</p>}
        {same && <p className="s-share-msg">This version is the same as the note now.</p>}
        {old != null && !same && (
          <div className="s-vd-grid">
            <div className="s-vd-cap">Earlier version</div>
            <div className="s-vd-cap">Now</div>
            {rows.map((r, i) => (r.kind === 'gap' ? (
              <div key={i} className="s-vd-gap">{r.count} unchanged line{r.count === 1 ? '' : 's'}</div>
            ) : (
              <div key={i} className="s-vd-row" data-kind={r.kind}>
                <div className={`s-vd-cell${r.l != null && r.kind !== 'same' ? ' del' : ''}`}>{r.l ?? ''}</div>
                <div className={`s-vd-cell${r.r != null && r.kind !== 'same' ? ' add' : ''}`}>{r.r ?? ''}</div>
              </div>
            )))}
          </div>
        )}
        <div className="s-vd-foot">
          <button type="button" className="s-outline" onClick={onClose}>Close</button>
          <button type="button" className="s-accent-btn" disabled={old == null || same} onClick={() => onRestore(version)}><RotateCcw size={14} /> Restore this version</button>
        </div>
      </div>
    </div>
  );
}

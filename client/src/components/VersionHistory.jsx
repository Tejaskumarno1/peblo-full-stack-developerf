import { useEffect, useMemo, useState } from 'react';
import { Ic } from '../utils/icons';
import { createPortal } from 'react-dom';
import { X, RotateCcw } from 'lucide-react';
import { notesAPI } from '../api';

// PEB-190: a note's saved versions. Pick one to read it, see what differs from today's text, and restore it.
const V = (name, fallback) => `var(--o-${name}, var(--s-${name}, var(--r-${name}, ${fallback})))`;

/** Lines only in the old version (removed) and only in the current one (added). Order-insensitive, which is enough to see what changed. */
export function diffLines(oldText, newText) {
  const a = String(oldText || '').split('\n').map((l) => l.trim()).filter(Boolean);
  const b = String(newText || '').split('\n').map((l) => l.trim()).filter(Boolean);
  const inB = new Set(b); const inA = new Set(a);
  return { removed: a.filter((l) => !inB.has(l)), added: b.filter((l) => !inA.has(l)) };
}

export default function VersionHistory({ noteId, currentContent, onClose, onRestored }) {
  const [versions, setVersions] = useState(null);
  const [sel, setSel] = useState(null);
  const [body, setBody] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [label, setLabel] = useState('');
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let alive = true;
    notesAPI.getBackups(noteId).then((r) => { if (alive) setVersions(r.data.backups || []); }).catch(() => { if (alive) { setVersions([]); setError('Could not load the versions.'); } });
    return () => { alive = false; };
  }, [noteId, reload]);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  useEffect(() => {
    setBody(null);
    if (!sel) return undefined;
    let alive = true;
    notesAPI.getBackup(noteId, sel).then((r) => { if (alive) setBody(r.data.backup); }).catch(() => { if (alive) setError('Could not open that version.'); });
    return () => { alive = false; };
  }, [noteId, sel]);

  const diff = useMemo(() => (body ? diffLines(body.content, currentContent) : null), [body, currentContent]);
  const restore = async () => {
    if (!sel || busy) return;
    setBusy(true); setError('');
    try { const r = await notesAPI.revertBackup(noteId, sel); onRestored(r.data.note); onClose(); }
    catch (e) { setError(e.response?.data?.error || 'Could not restore it.'); setBusy(false); }
  };
  const nameNow = async () => {
    const name = label.trim();
    if (!name || busy) return;
    setBusy(true); setError('');
    try { await notesAPI.nameVersion(noteId, name); setLabel(''); setReload((n) => n + 1); }
    catch (e) { setError(e.response?.data?.error || 'Could not name this version.'); }
    setBusy(false);
  };
  const when = (d) => new Date(d).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

  const panel = { background: V('surface', '#fff'), color: V('fg', '#111'), border: `1px solid ${V('line', '#ddd')}`, borderRadius: 12, width: 'min(920px, 94vw)', height: 'min(620px, 88vh)', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,.3)' };
  const btn = { height: 36, padding: '0 14px', borderRadius: 8, border: `1px solid ${V('line', '#ccc')}`, background: V('surface', '#fff'), color: V('fg', '#111'), font: 'inherit', fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 };

  return createPortal(
    <div role="presentation" onMouseDown={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', display: 'grid', placeItems: 'center', zIndex: 1000 }}>
      <div role="dialog" aria-modal="true" aria-label="Version history" data-testid="version-history" onMouseDown={(e) => e.stopPropagation()} style={panel}>
        <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: `1px solid ${V('line', '#ddd')}` }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>Version history</h2>
          <button type="button" aria-label="Close" onClick={onClose} style={{ ...btn, width: 36, padding: 0, justifyContent: 'center' }}><X size={16} /></button>
        </header>
        <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
          <ul aria-label="Saved versions" style={{ listStyle: 'none', margin: 0, padding: 8, width: 230, overflowY: 'auto', borderRight: `1px solid ${V('line', '#ddd')}` }}>
            {versions === null && <li style={{ padding: 10, opacity: 0.7 }}>Loading…</li>}
            {versions?.length === 0 && <li style={{ padding: 10, opacity: 0.7 }}>No earlier versions yet. Peblo keeps one each time a note changes a lot.</li>}
            {versions?.map((v) => (
              <li key={v.id}>
                <button type="button" onClick={() => setSel(v.id)} aria-pressed={sel === v.id} style={{ width: '100%', textAlign: 'left', padding: '8px 10px', borderRadius: 8, border: 'none', cursor: 'pointer', font: 'inherit', background: sel === v.id ? V('soft', '#eee') : 'transparent', color: 'inherit' }}>
                  {v.label && <strong data-testid="vh-label" style={{ display: 'block', color: V('accent', '#2563eb') }}><Ic name="star" size={13} style={{ marginRight: 5, verticalAlign: '-2px' }} />{v.label}</strong>}
                  <strong style={{ display: 'block', fontWeight: v.label ? 500 : 700, fontSize: v.label ? 13 : undefined }}>{when(v.createdAt)}{v.savedBy ? ` · ${v.savedBy}` : ''}</strong>
                  <span style={{ fontSize: 12.5, opacity: 0.75, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.preview || '(empty)'}</span>
                </button>
              </li>
            ))}
          </ul>
          <section style={{ flex: 1, overflowY: 'auto', padding: 16 }} aria-live="polite">
            {!sel && <p style={{ opacity: 0.7 }}>Pick a version on the left to read it and compare it with the note as it is now.</p>}
            {sel && !body && <p style={{ opacity: 0.7 }}>Loading…</p>}
            {body && diff && (
              <>
                <p data-testid="vh-summary" style={{ margin: '0 0 10px', fontWeight: 700 }}>
                  {diff.removed.length || diff.added.length
                    ? `Compared with now: ${diff.removed.length} ${diff.removed.length === 1 ? 'line' : 'lines'} would come back, ${diff.added.length} written since would go.`
                    : 'Same text as the note now.'}
                </p>
                <pre data-testid="vh-text" style={{ whiteSpace: 'pre-wrap', margin: 0, font: 'inherit', lineHeight: 1.55 }}>
                  {String(body.content || '').split('\n').map((l, i) => {
                    const gone = diff.removed.includes(l.trim()) && l.trim();
                    return <span key={i} style={{ display: 'block', background: gone ? 'rgba(46,160,90,.18)' : 'transparent' }}>{l || ' '}</span>;
                  })}
                </pre>
                {diff.added.length > 0 && (
                  <details style={{ marginTop: 14 }}>
                    <summary style={{ cursor: 'pointer', fontWeight: 700 }}>Lines in the note now that this version does not have ({diff.added.length})</summary>
                    <pre style={{ whiteSpace: 'pre-wrap', font: 'inherit' }}>{diff.added.map((l, i) => <span key={i} style={{ display: 'block', background: 'rgba(220,70,60,.15)' }}>{l}</span>)}</pre>
                  </details>
                )}
              </>
            )}
          </section>
        </div>
        <footer style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 10, padding: '12px 18px', borderTop: `1px solid ${V('line', '#ddd')}` }}>
          <form onSubmit={(e) => { e.preventDefault(); void nameNow(); }} style={{ display: 'flex', gap: 6, marginRight: 'auto' }}>
            <input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={80} placeholder="Name the note as it is now" aria-label="Name this version" data-testid="vh-name" style={{ height: 36, padding: '0 10px', borderRadius: 8, border: `1px solid ${V('line', '#ccc')}`, background: 'transparent', color: 'inherit', font: 'inherit', width: 220 }} />
            <button type="submit" disabled={!label.trim() || busy} style={btn} data-testid="vh-save-name">Save version</button>
          </form>
          {error && <span role="alert" style={{ color: '#c0392b' }}>{error}</span>}
          <span style={{ opacity: 0.7, fontSize: 13 }}>Restoring keeps today's text as a version, so you can undo it.</span>
          <button type="button" style={{ ...btn, background: V('ink', V('path', '#222')), color: '#fff', borderColor: 'transparent', opacity: sel && body ? 1 : 0.5 }} disabled={!sel || !body || busy} onClick={restore}><RotateCcw size={14} /> Restore this version</button>
        </footer>
      </div>
    </div>,
    document.body
  );
}

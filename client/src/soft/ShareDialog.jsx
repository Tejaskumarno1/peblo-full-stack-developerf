import { useEffect, useState } from 'react';
import { X, Link2, Copy, Check } from 'lucide-react';
import api from '../api/client';
import { usePublicUrl } from '../api/publicUrl';

// Turns a public, read-only link on or off for one note or task.
export default function ShareDialog({ kind, id, title, onClose }) {
  const [edit, setEdit] = useState(false);
  const [token, setToken] = useState(undefined); // undefined = loading, null = not shared
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    api.get(`/share/${kind}/${id}`).then((r) => { if (live) { setToken(r.data.token); setEdit(!!r.data.edit); } }).catch(() => { if (live) setError('Could not check the link. Try again.'); });
    return () => { live = false; };
  }, [kind, id]);

  const publicUrl = usePublicUrl();
  const base = publicUrl || window.location.origin;
  const url = token ? `${base}/s/${kind}/${token}` : '';
  const local = !publicUrl && /^(localhost|127\.|\[::1\])/.test(window.location.hostname);

  const turnOn = async () => {
    setBusy(true); setError('');
    try { const r = await api.post(`/share/${kind}/${id}`, { edit }); setToken(r.data.token); setEdit(!!r.data.edit); } catch { setError('Could not create the link.'); }
    setBusy(false);
  };
  const setMode = async (next) => {
    setBusy(true); setError('');
    try { const r = await api.post(`/share/${kind}/${id}`, { edit: next }); setEdit(!!r.data.edit); } catch { setError('Could not change that.'); }
    setBusy(false);
  };
  const turnOff = async () => {
    setBusy(true); setError('');
    try { await api.delete(`/share/${kind}/${id}`); setToken(null); } catch { setError('Could not turn the link off.'); }
    setBusy(false);
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(url); } catch { /* the box is selectable as a fallback */ }
    setCopied(true); setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div className="s-share-back" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }} onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }}>
      <div className="s-share" role="dialog" aria-label={`Share this ${kind === 'note' ? 'note' : 'task'}`}>
        <div className="s-share-head">
          <div><b>Share this {kind === 'note' ? 'note' : 'task'}</b><small>{title || (kind === 'note' ? 'Untitled' : 'Task')}</small></div>
          <button type="button" className="s-capture-close" aria-label="Close" onClick={onClose}><X size={16} strokeWidth={2.4} /></button>
        </div>
        {token === undefined && !error && <p className="s-share-msg">Checking…</p>}
        {token === null && (
          <>
            <p className="s-share-msg">Anyone with the link can open it without signing in.{kind === 'todo' ? ' The note linked to this task is shown too.' : ''}</p>
            <Mode edit={edit} onPick={setEdit} kind={kind} />
            <button type="button" className="s-share-go" onClick={turnOn} disabled={busy}><Link2 size={15} /> {busy ? 'Creating…' : 'Create link'}</button>
          </>
        )}
        {token && (
          <>
            <Mode edit={edit} onPick={setMode} kind={kind} disabled={busy} />
            <div className="s-share-row">
              <input readOnly aria-label="Share link" value={url} onFocus={(e) => e.target.select()} />
              <button type="button" className="s-share-go" onClick={copy}>{copied ? <><Check size={15} /> Copied</> : <><Copy size={15} /> Copy</>}</button>
            </div>
            {local && <p className="s-share-msg warn">This link points to your own computer, so other people cannot open it yet. It will work for everyone once Peblo is hosted online.</p>}
            <button type="button" className="s-share-off" onClick={turnOff} disabled={busy}>Stop sharing</button>
          </>
        )}
        {error && <p className="s-share-msg warn" role="alert">{error}</p>}
      </div>
    </div>
  );
}

function Mode({ edit, onPick, kind, disabled }) {
  return (
    <div className="s-share-mode" role="radiogroup" aria-label="What people with the link can do">
      <button type="button" role="radio" aria-checked={!edit} className={edit ? '' : 'on'} disabled={disabled} onClick={() => onPick(false)}>Can view</button>
      <button type="button" role="radio" aria-checked={edit} className={edit ? 'on' : ''} disabled={disabled} onClick={() => onPick(true)}>Can edit</button>
      <small>{edit ? (kind === 'note' ? 'They can change the text. They cannot delete the note or see your other notes.' : 'They can tick it off or reword it.') : 'They can only read it.'}</small>
    </div>
  );
}

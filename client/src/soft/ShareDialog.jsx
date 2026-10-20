import { useEffect, useState } from 'react';
import { X, Link2, Copy, Check } from 'lucide-react';
import api from '../api/client';

// Turns a public, read-only link on or off for one note or task.
export default function ShareDialog({ kind, id, title, onClose }) {
  const [token, setToken] = useState(undefined); // undefined = loading, null = not shared
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    api.get(`/share/${kind}/${id}`).then((r) => { if (live) setToken(r.data.token); }).catch(() => { if (live) setError('Could not check the link. Try again.'); });
    return () => { live = false; };
  }, [kind, id]);

  const url = token ? `${window.location.origin}/s/${kind}/${token}` : '';
  const local = /^(localhost|127\.|\[::1\])/.test(window.location.hostname);

  const turnOn = async () => {
    setBusy(true); setError('');
    try { const r = await api.post(`/share/${kind}/${id}`); setToken(r.data.token); } catch { setError('Could not create the link.'); }
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
            <p className="s-share-msg">Anyone with the link can read it, without signing in. They cannot change anything.{kind === 'todo' ? ' The note linked to this task is shown too.' : ''}</p>
            <button type="button" className="s-share-go" onClick={turnOn} disabled={busy}><Link2 size={15} /> {busy ? 'Creating…' : 'Create link'}</button>
          </>
        )}
        {token && (
          <>
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

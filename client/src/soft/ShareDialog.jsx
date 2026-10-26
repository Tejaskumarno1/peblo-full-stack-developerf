import { useEffect, useState } from 'react';
import { X, Link2, Copy, Check, Bot } from 'lucide-react';
import api from '../api/client';
import { usePublicUrl } from '../api/publicUrl';

const EXPIRY = [['never', 'Never expires', null], ['1', 'In 1 day', 1], ['7', 'In 7 days', 7], ['30', 'In 30 days', 30], ['90', 'In 90 days', 90]];
const daysOf = (key) => EXPIRY.find((e) => e[0] === key)?.[2] ?? null;
const fmtDate = (d) => new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

// Turns a public link on or off for one note or task: read only or editable, with an optional end date.
export default function ShareDialog({ kind, id, title, onClose }) {
  const [edit, setEdit] = useState(false);
  const [expiry, setExpiry] = useState('never');
  const [expiresAt, setExpiresAt] = useState(null);
  const [token, setToken] = useState(undefined); // undefined = loading, null = not shared
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [botCopied, setBotCopied] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    api.get(`/share/${kind}/${id}`).then((r) => {
      if (!live) return;
      setToken(r.data.token); setEdit(!!r.data.edit); setExpiresAt(r.data.expiresAt || null);
    }).catch(() => { if (live) setError('Could not check the link. Try again.'); });
    return () => { live = false; };
  }, [kind, id]);

  const publicUrl = usePublicUrl();
  const base = publicUrl || window.location.origin;
  const url = token ? `${base}/s/${kind}/${token}` : '';
  const local = !publicUrl && /^(localhost|127\.|\[::1\])/.test(window.location.hostname);
  const expired = !!expiresAt && new Date(expiresAt).getTime() <= Date.now();

  const save = async (body, after) => {
    setBusy(true); setError('');
    try { const r = await api.post(`/share/${kind}/${id}`, body); after(r.data); } catch { setError('Could not save that. Try again.'); }
    setBusy(false);
  };
  const turnOn = () => save({ edit, expiresInDays: daysOf(expiry) }, (d) => { setToken(d.token); setEdit(!!d.edit); setExpiresAt(d.expiresAt || null); });
  const setMode = (next) => save({ edit: next }, (d) => setEdit(!!d.edit));
  const setEnds = (key) => { setExpiry(key); save({ expiresInDays: daysOf(key) }, (d) => setExpiresAt(d.expiresAt || null)); };
  const turnOff = async () => {
    setBusy(true); setError('');
    try { await api.delete(`/share/${kind}/${id}`); setToken(null); setExpiresAt(null); setExpiry('never'); } catch { setError('Could not turn the link off.'); }
    setBusy(false);
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(url); } catch { /* the box is selectable as a fallback */ }
    setCopied(true); setTimeout(() => setCopied(false), 1800);
  };

  const copyBot = async () => {
    try { await navigator.clipboard.writeText(url + '.md'); } catch { /* selectable below */ }
    setBotCopied(true); setTimeout(() => setBotCopied(false), 1800);
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
            <Expiry value={expiry} onPick={setExpiry} />
            <button type="button" className="s-share-go" onClick={turnOn} disabled={busy}><Link2 size={15} /> {busy ? 'Creating…' : 'Create link'}</button>
          </>
        )}
        {token && (
          <>
            <Mode edit={edit} onPick={setMode} kind={kind} disabled={busy} />
            <Expiry value={expiresAt ? 'custom' : 'never'} onPick={setEnds} disabled={busy} note={expiresAt ? (expired ? `This link stopped working on ${fmtDate(expiresAt)}. Pick a new end date to turn it back on.` : `The link stops working on ${fmtDate(expiresAt)}.`) : ''} custom={!!expiresAt} />
            <div className="s-share-row">
              <input readOnly aria-label="Share link" value={url} onFocus={(e) => e.target.select()} />
              <button type="button" className="s-share-go" onClick={copy}>{copied ? <><Check size={15} /> Copied</> : <><Copy size={15} /> Copy</>}</button>
            </div>
            {kind === 'note' && <div className="s-share-row bot"><input readOnly aria-label="Plain-text link for bots" value={url + '.md'} onFocus={(e) => e.target.select()} /><button type="button" className="s-share-go ghost" onClick={copyBot}>{botCopied ? <><Check size={15} /> Copied</> : <><Bot size={15} /> For bots</>}</button></div>}
            {kind === 'note' && <p className="s-share-msg">Bots and AI agents that open the normal link get this plain-text version automatically, with a text description of each picture.</p>}
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

function Expiry({ value, onPick, disabled, note, custom }) {
  return (
    <div className="s-share-exp">
      <label htmlFor="s-share-exp">Link expires</label>
      <select id="s-share-exp" value={value} disabled={disabled} onChange={(e) => onPick(e.target.value)}>
        {custom && <option value="custom" disabled>On a set date</option>}
        {EXPIRY.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
      </select>
      {note && <small>{note}</small>}
    </div>
  );
}

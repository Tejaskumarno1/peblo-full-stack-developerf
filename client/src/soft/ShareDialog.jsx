import { useEffect, useRef, useState } from 'react';
import { X, Link2, Copy, Check, Bot, Eye, UserCheck } from 'lucide-react';
import api from '../api/client';
import { usePublicUrl } from '../api/publicUrl';
import './shareRedesign.css';

const EXPIRY = [['never', 'Never expires', null], ['1', 'In 1 day', 1], ['7', 'In 7 days', 7], ['30', 'In 30 days', 30], ['90', 'In 90 days', 90], ['pick', 'Pick a date and time…', null]];
const daysOf = (key) => EXPIRY.find((e) => e[0] === key)?.[2] ?? null;
const fmtDate = (d) => new Date(d).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const MAX_MS = 10 * 365 * 86400000;
/** A Date as the value of a datetime-local input (local time, minutes). */
const localValue = (d) => { const x = new Date(d); x.setMinutes(x.getMinutes() - x.getTimezoneOffset()); return x.toISOString().slice(0, 16); };
const ago = (t) => {
  const s = Math.max(0, Math.round((Date.now() - new Date(t).getTime()) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
};
const STATUS = { waiting: 'Waiting', admitted: 'Let in', declined: 'Declined' };

// Turns a public link on or off for one note or task: read only or editable, copy allowed or not, with an optional end date (any date and time).
// While the link is on it also lists who opened it in the last 30 days and the guests who asked to come in (M8, M13).
export default function ShareDialog({ kind, id, title, onClose }) {
  const [edit, setEdit] = useState(false);
  const [withNote, setWithNote] = useState(false); // tasks only: show the linked note on the link
  const [allowCopy, setAllowCopy] = useState(true); // FM12
  const [expiry, setExpiry] = useState('never');
  const [pickAt, setPickAt] = useState(''); // datetime-local value while "Pick a date" is chosen
  const [expiresAt, setExpiresAt] = useState(null);
  const [token, setToken] = useState(undefined); // undefined = loading, null = not shared
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [botCopied, setBotCopied] = useState('');
  const [error, setError] = useState('');
  const [opens, setOpens] = useState(null);
  const [requests, setRequests] = useState([]);
  const dlg = useRef(null);
  const timers = useRef([]);
  useEffect(() => { dlg.current?.focus(); const t = timers.current; return () => t.forEach(clearTimeout); }, []); // focus inside so Escape works

  useEffect(() => {
    let live = true;
    api.get(`/share/${kind}/${id}`).then((r) => {
      if (!live) return;
      setToken(r.data.token); setEdit(!!r.data.edit); setWithNote(!!r.data.shareNote); setExpiresAt(r.data.expiresAt || null); setAllowCopy(r.data.allowCopy !== false);
    }).catch(() => { if (live) setError('Could not check the link. Try again.'); });
    return () => { live = false; };
  }, [kind, id]);

  // who opened the link, and who asked to come in: loaded once the link is on
  useEffect(() => {
    if (!token) { setOpens(null); setRequests([]); return undefined; }
    let live = true;
    api.get(`/share/${kind}/${id}/opens`).then((r) => { if (live) setOpens(r.data.opens || []); }).catch(() => { if (live) setOpens([]); });
    api.get(`/share/${kind}/${id}/requests`).then((r) => { if (live) setRequests(r.data.requests || []); }).catch(() => {});
    return () => { live = false; };
  }, [kind, id, token]);

  const publicUrl = usePublicUrl();
  const base = publicUrl || window.location.origin;
  const url = token ? `${base}/s/${kind}/${token}` : '';
  const local = !publicUrl && /^(localhost|127\.|\[::1\])/.test(window.location.hostname);
  const expired = !!expiresAt && new Date(expiresAt).getTime() <= Date.now();

  const save = async (body, after) => {
    setBusy(true); setError('');
    try { const r = await api.post(`/share/${kind}/${id}`, body); after(r.data); return true; } catch (e) { setError(e.response?.data?.error || 'Could not save that. Try again.'); return false; } finally { setBusy(false); }
  };
  /** The chosen custom end as ISO, or '' with an error shown when it is not usable. */
  const pickedIso = () => {
    const t = pickAt ? new Date(pickAt).getTime() : NaN;
    if (!Number.isFinite(t) || t <= Date.now() + 60000) { setError('Pick a date and time in the future.'); return ''; }
    if (t > Date.now() + MAX_MS) { setError('A link can last at most 10 years.'); return ''; }
    return new Date(t).toISOString();
  };
  const endBody = () => {
    if (expiry !== 'pick') return { expiresInDays: daysOf(expiry) };
    const iso = pickedIso();
    return iso ? { expiresAt: iso } : null;
  };
  const turnOn = () => { const end = endBody(); if (!end) return; save({ edit, allowCopy, ...end, ...(kind === 'todo' ? { shareNote: withNote } : {}) }, (d) => { setToken(d.token); setEdit(!!d.edit); setExpiresAt(d.expiresAt || null); setAllowCopy(d.allowCopy !== false); }); };
  const setMode = (next) => save({ edit: next }, (d) => setEdit(!!d.edit));
  const setNote = (on) => { setWithNote(on); if (token) save({ shareNote: on }, (d) => setWithNote(!!d.shareNote)); };
  const setCopy = (on) => { setAllowCopy(on); if (token) save({ allowCopy: on }, (d) => setAllowCopy(d.allowCopy !== false)); };
  const setEnds = (key) => {
    setExpiry(key);
    if (key === 'pick') { setPickAt(localValue(expiresAt && !expired ? expiresAt : Date.now() + 7 * 86400000)); return; }
    save({ expiresInDays: daysOf(key) }, (d) => setExpiresAt(d.expiresAt || null));
  };
  const savePicked = () => { const iso = pickedIso(); if (iso) save({ expiresAt: iso }, (d) => { setExpiresAt(d.expiresAt || null); setExpiry('custom'); }); };
  const turnOff = async () => {
    setBusy(true); setError('');
    try { await api.delete(`/share/${kind}/${id}`); setToken(null); setExpiresAt(null); setExpiry('never'); } catch { setError('Could not turn the link off.'); }
    setBusy(false);
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(url); } catch { setError('Could not copy. Select the link and copy it by hand.'); return; }
    setError(''); setCopied(true); timers.current.push(setTimeout(() => setCopied(false), 1800));
  };

  const copyText = async (key, text) => {
    try { await navigator.clipboard.writeText(text); } catch { setError('Could not copy. Select the text and copy it by hand.'); return; }
    setError(''); setBotCopied(key); timers.current.push(setTimeout(() => setBotCopied(''), 1800));
  };
  const prompt = `Read this shared Peblo note and help me with it.\nPlain text: ${url}.md\nPDF with pictures: ${url}.pdf\nIf you have the Peblo MCP connected (${base}/mcp), call read_shared_link with ${url}.`;
  const shownExpiry = expiry === 'pick' ? 'pick' : expiresAt ? 'custom' : 'never';

  return (
    <div className="s-share-back" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }} onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }}>
      <div className="s-share" role="dialog" aria-modal="true" tabIndex={-1} ref={dlg} aria-label={`Share this ${kind === 'note' ? 'note' : 'task'}`} data-testid="share-dialog">
        <div className="s-share-head">
          <div><b>Share this {kind === 'note' ? 'note' : 'task'}</b><small>{title || (kind === 'note' ? 'Untitled' : 'Task')}</small></div>
          <button type="button" className="s-capture-close" aria-label="Close" onClick={onClose}><X size={16} strokeWidth={2.4} /></button>
        </div>
        {token === undefined && !error && <p className="s-share-msg">Checking…</p>}
        {token === null && (
          <>
            <p className="s-share-msg">Anyone with the link can open it without signing in.</p>
            <Mode edit={edit} onPick={setEdit} kind={kind} />
            {kind === 'todo' && <NoteToggle on={withNote} onChange={setNote} />}
            <CopyToggle on={allowCopy} onChange={setAllowCopy} />
            <Expiry value={expiry} onPick={(k) => { setExpiry(k); if (k === 'pick' && !pickAt) setPickAt(localValue(Date.now() + 7 * 86400000)); }} pickAt={pickAt} onPickAt={setPickAt} />
            <button type="button" className="s-share-go" data-testid="share-create" onClick={turnOn} disabled={busy}><Link2 size={15} /> {busy ? 'Creating…' : 'Create link'}</button>
          </>
        )}
        {token && (
          <>
            <Mode edit={edit} onPick={setMode} kind={kind} disabled={busy} />
            {kind === 'todo' && <NoteToggle on={withNote} onChange={setNote} disabled={busy} />}
            <CopyToggle on={allowCopy} onChange={setCopy} disabled={busy} />
            <Expiry value={shownExpiry} onPick={setEnds} disabled={busy} custom={!!expiresAt} pickAt={pickAt} onPickAt={setPickAt} onSavePick={savePicked}
              note={expiry === 'pick' ? '' : expiresAt ? (expired ? `This link stopped working on ${fmtDate(expiresAt)}. Pick a new end date to turn it back on.` : `The link stops working on ${fmtDate(expiresAt)}.`) : ''} />
            <div className="s-share-row">
              <input readOnly aria-label="Share link" value={url} onFocus={(e) => e.target.select()} />
              <button type="button" className="s-share-go" onClick={copy}>{copied ? <><Check size={15} /> Copied</> : <><Copy size={15} /> Copy</>}</button>
            </div>
            {kind === 'note' && allowCopy && (
              <div className="s-share-ai" aria-label="Share with AI">
                <b><Bot size={14} /> Share with AI</b>
                {[['md', 'Text (markdown)', url + '.md'], ['pdf', 'PDF with pictures', url + '.pdf'], ['mcp', 'MCP address', base + '/mcp']].map(([k, label, v]) => (
                  <div className="s-share-row bot" key={k}>
                    <input readOnly aria-label={label} title={label} value={v} onFocus={(e) => e.target.select()} />
                    <button type="button" className="s-share-go ghost" onClick={() => copyText(k, v)}>{botCopied === k ? <><Check size={15} /> Copied</> : <><Copy size={15} /> {label.split(' ')[0]}</>}</button>
                  </div>
                ))}
                <button type="button" className="s-share-go" onClick={() => copyText('prompt', prompt)}>{botCopied === 'prompt' ? <><Check size={15} /> Copied</> : <><Bot size={15} /> Copy as AI prompt</>}</button>
                <small>Bots that open the normal link get the plain-text version automatically, with a text description of each picture.</small>
              </div>
            )}
            {kind === 'note' && !allowCopy && <p className="s-share-msg" data-testid="share-nocopy-note">Copying is off, so there is no plain-text or PDF version for AI tools either.</p>}
            <hr className="s-share-rule" />
            <Activity opens={opens} requests={requests} />
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

function NoteToggle({ on, onChange, disabled }) {
  return (
    <label className="s-share-note" htmlFor="s-share-note">
      <input id="s-share-note" type="checkbox" checked={on} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>Also show the note linked to this task</span>
    </label>
  );
}

/** FM12: copy, download, print and export on the shared page (and the bots' plain-text version). */
function CopyToggle({ on, onChange, disabled }) {
  return (
    <label className="s-share-note" htmlFor="s-share-copy" title="Off hides copy, download, print and export on the page. Someone can still take a screenshot.">
      <input id="s-share-copy" data-testid="share-allow-copy" type="checkbox" checked={on} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>Let guests copy and download</span>
    </label>
  );
}

function Expiry({ value, onPick, disabled, note, custom, pickAt, onPickAt, onSavePick }) {
  const min = localValue(Date.now() + 5 * 60000);
  const max = localValue(Date.now() + MAX_MS);
  return (
    <div className="s-share-exp">
      <label htmlFor="s-share-exp">Link expires</label>
      <select id="s-share-exp" data-testid="share-expiry" value={value} disabled={disabled} onChange={(e) => onPick(e.target.value)}>
        {custom && <option value="custom" disabled>On a set date</option>}
        {EXPIRY.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
      </select>
      {value === 'pick' && (
        <span className="s-share-pick" style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 6 }}>
          <input type="datetime-local" aria-label="Link ends on" data-testid="share-expiry-at" min={min} max={max} value={pickAt} disabled={disabled} onChange={(e) => onPickAt(e.target.value)} />
          {onSavePick && <button type="button" className="s-share-go ghost" data-testid="share-expiry-save" disabled={disabled || !pickAt} onClick={onSavePick}>Set</button>}
        </span>
      )}
      {note && <small>{note}</small>}
    </div>
  );
}

/** M13 and M8: who opened the link in the last 30 days, and guests who asked to come in (declined ones are kept 30 days). */
function Activity({ opens, requests }) {
  return (
    <div className="s-share-activity" data-testid="share-activity" style={{ display: 'grid', gap: 6, fontSize: 12.5 }}>
      <b style={{ display: 'flex', gap: 6, alignItems: 'center' }}><Eye size={14} /> Opened in the last 30 days</b>
      {opens === null && <small>Loading…</small>}
      {opens && opens.length === 0 && <small data-testid="share-opens-none">Nobody has opened this link yet.</small>}
      {opens && opens.length > 0 && (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 4, maxHeight: 132, overflowY: 'auto' }} data-testid="share-opens">
          {opens.slice(0, 20).map((o, i) => (
            <li key={`${o.name}-${i}`} data-testid="share-open-row" style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <span>{o.name}{o.member ? '' : <small style={{ opacity: 0.7 }}> · Guest</small>}</span>
              <small style={{ opacity: 0.75 }}>{o.visits > 1 ? `${o.visits} visits, ` : ''}{ago(o.lastAt)}</small>
            </li>
          ))}
        </ul>
      )}
      {requests.length > 0 && <>
        <b style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 4 }}><UserCheck size={14} /> Asked to come in</b>
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 4, maxHeight: 110, overflowY: 'auto' }} data-testid="share-requests">
          {requests.slice(0, 20).map((r) => (
            <li key={r.id} data-testid="share-request-row" data-status={r.status} style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <span>{r.name} <small style={{ opacity: 0.7 }}>· Guest</small></span>
              <small style={{ fontWeight: r.status === 'declined' ? 700 : 400 }}>{STATUS[r.status] || r.status} · {ago(r.at)}</small>
            </li>
          ))}
        </ul>
      </>}
    </div>
  );
}

import { useState } from 'react';
import { Check, Clock, Link2, Lock, Mail, Pencil, Eye, Power, Sparkles } from 'lucide-react';
import ShareQr from '../components/ShareQr';
import { authHeaders } from '../api/token';

/** S27: the Share panel in the header of a shared page: copy the link, who can do what, QR, invite by email. */
export default function SharePanel({ link, canEdit, expiresAt, title, isOwner, onCopy, onTurnOff, kindPath, token, hasPassword, summary = '', onSummary }) {
  const [sumOpen, setSumOpen] = useState(false);
  const [sumText, setSumText] = useState(summary);
  const [sumErr, setSumErr] = useState('');
  const saveSummary = async (clear) => {
    setSumErr('');
    try {
      const r = await fetch(`/api/public/note/${encodeURIComponent(token)}/summary`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify({ summary: clear ? '' : sumText }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'Could not save the summary.');
      onSummary?.(j.summary || ''); setSumOpen(false); if (clear) setSumText('');
    } catch (cause) { setSumErr(cause.message); }
  };
  const [pwOn, setPwOn] = useState(!!hasPassword);
  const [pwOpen, setPwOpen] = useState(false);
  const [pw, setPw] = useState('');
  const [pwErr, setPwErr] = useState('');
  const savePw = async (clear) => {
    setPwErr('');
    try {
      const r = await fetch(`/api/public/${kindPath}/${encodeURIComponent(token)}/password`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify({ password: clear ? '' : pw }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'Could not save the password.');
      setPwOn(!!j.hasPassword); setPw(''); setPwOpen(false);
    } catch (cause) { setPwErr(cause.message); }
  };
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const days = expiresAt ? Math.max(0, Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 86400000)) : null;
  const invite = (event) => {
    event.preventDefault();
    if (!/.+@.+\..+/.test(email)) return;
    const body = `Here is the link to ${title || 'a page'}: ${link}`;
    window.open(`mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(title || 'A page shared with you')}&body=${encodeURIComponent(body)}`, '_blank');
    setSent(true);
  };
  return (
    <div className="menu share-panel" role="dialog" aria-label="Share" data-testid="share-panel">
      <h4>Share this page</h4>
      <div className="linkbox"><input readOnly value={link} aria-label="Share link" /><button className="btn dark" type="button" data-testid="sp-copy" onClick={onCopy}><Link2 size={15} />Copy</button></div>
      <div className="sp-rows">
        <div className="sp-row">{canEdit ? <Pencil size={16} /> : <Eye size={16} />}<span>Anyone with the link</span><em>{canEdit ? 'Can edit' : 'Can view'}</em></div>
        <div className="sp-row"><Clock size={16} /><span>Link ends</span><em>{days === null ? 'Never' : days === 0 ? 'Today' : `In ${days} day${days > 1 ? 's' : ''}`}</em></div>
        <div className="sp-row" data-testid="sp-password-row"><Lock size={16} /><span>Password</span>{isOwner ? <button type="button" className="sp-link" data-testid="sp-password-toggle" onClick={() => setPwOpen((o) => !o)}>{pwOn ? 'On - change' : 'Off - add'}</button> : <em>{pwOn ? 'On' : 'Off'}</em>}</div>
      </div>
      {isOwner && pwOpen && <form className="sp-pw" onSubmit={(e) => { e.preventDefault(); if (pw.length >= 4) savePw(false); }}>
        <input type="password" aria-label="Link password" data-testid="sp-password" placeholder="At least 4 characters" autoComplete="new-password" maxLength={100} value={pw} onChange={(e) => { setPw(e.target.value); setPwErr(''); }} />
        <button className="btn dark" type="submit" data-testid="sp-password-save" disabled={pw.length < 4}>Save</button>
        {pwOn && <button className="btn" type="button" data-testid="sp-password-clear" onClick={() => savePw(true)}>Remove</button>}
      </form>}
      {pwErr && <p className="sp-note" role="alert">{pwErr}</p>}
      {isOwner && kindPath === 'note' && <>
        <div className="sp-row" data-testid="sp-summary-row"><Sparkles size={16} /><span>Summary for readers</span><button type="button" className="sp-link" data-testid="sp-summary-toggle" onClick={() => { setSumText(summary); setSumOpen((o) => !o); }}>{summary ? 'Edit' : 'Add'}</button></div>
        {sumOpen && <div className="sp-pw sum">
          <textarea aria-label="Summary" data-testid="sp-summary" rows={3} maxLength={400} placeholder="One or two sentences readers see under the title" value={sumText} onChange={(e) => setSumText(e.target.value)} />
          <div className="sp-sum-btns"><button className="btn dark" type="button" data-testid="sp-summary-save" onClick={() => saveSummary(false)}>Save</button>{summary && <button className="btn" type="button" data-testid="sp-summary-clear" onClick={() => saveSummary(true)}>Remove</button>}</div>
        </div>}
        {sumErr && <p className="sp-note" role="alert">{sumErr}</p>}
      </>}
      <form className="sp-invite" onSubmit={invite}>
        <input type="email" aria-label="Invite by email" data-testid="sp-email" placeholder="Invite by email" value={email} onChange={(e) => { setEmail(e.target.value); setSent(false); }} />
        <button className="btn" type="submit" data-testid="sp-invite"><Mail size={15} />{sent ? 'Opened' : 'Invite'}</button>
      </form>
      {sent && <p className="sp-note"><Check size={13} />Your email app opened with the link.</p>}
      <ShareQr link={link} />
      {isOwner && <button type="button" className="danger sp-off" data-testid="sp-off" onClick={onTurnOff}><Power size={16} />Turn sharing off</button>}
    </div>
  );
}

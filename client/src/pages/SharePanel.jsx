import { useState } from 'react';
import { Check, Clock, Link2, Mail, Pencil, Eye, Power } from 'lucide-react';
import ShareQr from '../components/ShareQr';

/** S27: the Share panel in the header of a shared page: copy the link, who can do what, QR, invite by email. */
export default function SharePanel({ link, canEdit, expiresAt, title, isOwner, onCopy, onTurnOff }) {
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
      </div>
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

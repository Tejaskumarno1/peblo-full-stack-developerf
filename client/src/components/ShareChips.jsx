import { useState } from 'react';
import { setLive, useLive } from '../utils/liveStore';
import { Check, Copy, Link2 } from 'lucide-react';
import { Avatar, CollabChips } from './CollabPanel';

/** Next to the note title: this note has a share link, who can do what with it, copy it, and who is on it right now. */
export default function ShareChips({ noteId }) {
  const live = useLive();
  const [copied, setCopied] = useState(false);
  if (!noteId || live.noteId !== noteId || !live.shared) return null;
  const copy = async () => {
    try { await navigator.clipboard.writeText(`${window.location.origin}/s/note/${live.token}`); setCopied(true); window.setTimeout(() => setCopied(false), 1800); } catch { /* blocked: use Share */ }
  };
  return <CollabChips viewers={live.viewers} canEdit={live.canEdit} copied={copied} onCopy={copy} onOpen={() => setLive({ open: !live.open })} />;
}

/** The same share state as separate pieces, for the full screen bar: what is shared, copy link, and who is on it. */
export function useShareParts(noteId) {
  const live = useLive();
  const [copied, setCopied] = useState(false);
  if (!noteId || live.noteId !== noteId || !live.shared) return null;
  const others = live.viewers.filter((v) => !v.self);
  const copy = async () => {
    try { await navigator.clipboard.writeText(`${window.location.origin}/s/note/${live.token}`); setCopied(true); window.setTimeout(() => setCopied(false), 1800); } catch { /* blocked: use Share */ }
  };
  return {
    shared: <span className="cp-chip ok" data-testid="fs-shared"><Link2 size={13} />{live.canEdit ? 'Shared · anyone can edit' : 'Shared · view only'}</span>,
    copy: <button type="button" className="fsx-ic" data-testid="fs-copylink" aria-label="Copy link" title={copied ? 'Copied' : 'Copy link'} onClick={copy}>{copied ? <Check size={16} /> : <Copy size={16} />}</button>,
    live: <button type="button" className="cp-chip btn live" data-testid="fs-live" onClick={() => setLive({ open: !live.open })} aria-label="Open live collaboration">
      <span className="cp-live"><i />Live</span>
      {others.length > 0 && <span className="cp-avs" aria-hidden="true">{others.slice(0, 3).map((v) => <Avatar key={v.id} v={v} size={22} />)}{others.length > 3 && <em>+{others.length - 3}</em>}</span>}
    </button>,
    full: <CollabChips viewers={live.viewers} canEdit={live.canEdit} copied={copied} onCopy={copy} onOpen={() => setLive({ open: !live.open })} />,
  };
}

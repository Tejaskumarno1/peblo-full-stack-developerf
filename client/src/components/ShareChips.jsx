import { useState } from 'react';
import { setLive, useLive } from '../utils/liveStore';
import { CollabChips } from './CollabPanel';

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

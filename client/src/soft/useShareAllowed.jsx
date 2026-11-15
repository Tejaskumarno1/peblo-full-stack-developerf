import { useQuery } from '@tanstack/react-query';
import { Link2Off } from 'lucide-react';
import { workspacesAPI } from '../api';

/** May this note get a public link? Asks the server (organization policy, the team's own switch, and the person's rights in the team).
 *  While the answer is loading, sharing is treated as allowed, so the menu does not flicker; a failed call also leaves it allowed (the server still refuses). */
export function useShareAllowed(noteId, enabled = true) {
  const q = useQuery({
    queryKey: ['share-allowed', noteId],
    enabled: !!noteId && enabled,
    staleTime: 30000,
    retry: false,
    queryFn: () => workspacesAPI.shareAllowed('note', noteId).then((r) => r.data),
  });
  return q.data && q.data.allowed === false ? { allowed: false, reason: q.data.reason || 'Public links are not allowed here.', code: q.data.code } : { allowed: true };
}

/** Shown in place of "Share link" when sharing is not allowed, with the reason, so there is no button that fails. */
export function ShareBlocked({ reason, className = 's-menu-note' }) {
  return <div role="note" className={className} data-testid="share-blocked" style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '8px 12px', fontSize: 12.5, opacity: 0.85, maxWidth: 260, whiteSpace: 'normal' }}><Link2Off size={15} style={{ flex: 'none', marginTop: 2 }} /><span>Public link not available. {reason}</span></div>;
}

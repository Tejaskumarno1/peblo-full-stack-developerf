import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, BellOff } from 'lucide-react';
import { workspacesAPI } from '../api';
import { useAuth } from '../context/AuthContext';

/** One person's choice for one team: muted or not (server table space_prefs). Muted teams send no stored notifications and no live pop-ups;
 *  a direct @mention or a task given to you still arrives. */
export function useSpaceMuted(spaceId) {
  const qc = useQueryClient();
  const { settings, updateSettings } = useAuth();
  const q = useQuery({ queryKey: ['space-prefs', spaceId], enabled: !!spaceId, staleTime: 60000, queryFn: () => workspacesAPI.spacePrefs(spaceId).then((r) => r.data) });
  const setMuted = useCallback(async (muted) => {
    await workspacesAPI.setSpacePrefs(spaceId, { muted });
    qc.setQueryData(['space-prefs', spaceId], { muted });
    // the older pop-up switch (account setting) follows, so pop-ups for notifications already on their way also stop
    try { await updateSettings?.({ spaceMute: { ...(settings?.spaceMute || {}), [spaceId]: muted } }); } catch { /* the server preference is what counts */ }
  }, [spaceId, qc, settings, updateSettings]);
  return { muted: q.data?.muted === true, loading: q.isLoading, setMuted };
}

/** "Mute this team" / "Unmute this team" row for the space pill menu. */
export function MuteMenuItem({ spaceId, name, onDone }) {
  const { muted, setMuted } = useSpaceMuted(spaceId);
  return (
    <button type="button" className="s-space-row plain" role="menuitem" data-testid="space-mute" aria-label={`${muted ? 'Unmute' : 'Mute'} ${name}`}
      onClick={async () => { try { await setMuted(!muted); } catch { /* shown again on the next open */ } onDone?.(); }}>
      {muted ? <Bell size={15} /> : <BellOff size={15} />} {muted ? 'Unmute this team' : 'Mute this team'}
    </button>
  );
}

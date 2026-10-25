import { useQuery } from '@tanstack/react-query';
import api from '../api/client';

/*
 * A small dot on a note in a list when someone from outside (a person on a share link) is in it right now.
 * All rows share one request that refreshes every few seconds.
 */
function usePresence() {
  const { data } = useQuery({
    queryKey: ['collab-presence'],
    queryFn: () => api.get('/collab/presence').then((r) => r.data.presence || {}),
    refetchInterval: 8000,
    staleTime: 6000,
    refetchOnWindowFocus: true,
    retry: false,
  });
  return data || {};
}

export default function LiveDot({ id }) {
  const people = usePresence()[id];
  if (!people || !people.length) return null;
  const names = people.map((p) => p.name);
  const label = names.length === 1 ? `${names[0]} is in this note now` : `${names.slice(0, 2).join(', ')}${names.length > 2 ? ` and ${names.length - 2} more` : ''} are in this note now`;
  return (
    <span className="pb-livedot" title={label} role="img" aria-label={label} data-testid="live-dot" style={{ '--c': people[0].color }}>
      <style>{`.pb-livedot { display: inline-block; width: 9px; height: 9px; border-radius: 50%; background: var(--c, #059669); margin-right: 6px; vertical-align: middle; box-shadow: 0 0 0 0 var(--c, #059669); animation: pb-live 1.8s ease-out infinite; flex: none; }
        @keyframes pb-live { 0% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--c, #059669) 60%, transparent); } 100% { box-shadow: 0 0 0 7px transparent; } }
        @media (prefers-reduced-motion: reduce) { .pb-livedot { animation: none; } }`}</style>
    </span>
  );
}

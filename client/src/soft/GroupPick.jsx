import { useQuery } from '@tanstack/react-query';
import api from '../api/client';
import { useCurrentSpace } from './spaces';

/*
 * FM23: pick a group instead of one person. A group is expanded here into its members who are in this team, and the
 * caller adds them through the usual rules (task assignees, Office note access), so a group never grants more than
 * adding each person by hand would.
 */
export function useSpaceGroups(spaceId) {
  const current = useCurrentSpace();
  const sp = spaceId || current;
  const { data } = useQuery({ queryKey: ['space-groups', sp], enabled: !!sp, staleTime: 60000, queryFn: () => api.get(`/workspaces/spaces/${sp}/groups`).then((r) => r.data.groups || []).catch(() => []) });
  return data || [];
}

/** Pills, one per group, for the task assignee picker. `onPick(userIds)`. */
export function GroupPills({ spaceId, onPick, max = 10 }) {
  const groups = useSpaceGroups(spaceId);
  if (!groups.length) return null;
  return (
    <>
      {groups.map((g) => (
        <button key={g.id} type="button" data-testid="assign-group" title={`${g.members.map((m) => m.name).join(', ')}${g.members.length > max ? ` (the first ${max})` : ''}`} onClick={() => onPick(g.members.map((m) => m.userId).slice(0, max))}>
          {g.name} ({g.members.length})
        </button>
      ))}
    </>
  );
}

/** A select of groups for the Office note access dialog. `allowed` limits to people who may be added. `onPick(userIds)`. */
export function GroupSelect({ spaceId, allowed, onPick }) {
  const groups = useSpaceGroups(spaceId).map((g) => ({ ...g, ids: g.members.map((m) => m.userId).filter((u) => !allowed || allowed.includes(u)) })).filter((g) => g.ids.length > 0);
  if (!groups.length) return null;
  return (
    <label className="oa-add">Add a group
      <select value="" data-testid="access-add-group" onChange={(e) => { const g = groups.find((x) => x.id === e.target.value); if (g) onPick(g.ids); }}>
        <option value="">Choose a group</option>
        {groups.map((g) => <option key={g.id} value={g.id}>{g.name} ({g.ids.length})</option>)}
      </select>
    </label>
  );
}

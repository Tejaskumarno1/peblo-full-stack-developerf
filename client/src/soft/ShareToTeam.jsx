import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Eye, Pencil, Plus, Users, X } from 'lucide-react';
import { notesAPI, workspacesAPI } from '../api';
import { Backdrop, iconOf, toneOf, useWorkspaces } from './spaces';
import './teamshare.css';

/** The teams (not Offices) this person can add notes to. */
export function useShareTargets() {
  const { data } = useWorkspaces();
  return (data?.orgs || []).flatMap((o) => o.spaces.filter((s) => s.kind === 'team' && s.role !== 'viewer').map((s) => ({ ...s, orgId: o.id, orgName: o.name })));
}

/** Share a Personal note into a team (mockups T01, T02): who sees it, view or edit, and an optional to-do list that goes with it. */
export default function ShareToTeam({ noteId, title, onClose, onDone }) {
  const targets = useShareTargets();
  const qc = useQueryClient();
  const [teamId, setTeamId] = useState(targets[0]?.id || null);
  const [level, setLevel] = useState('edit');
  const [withTasks, setWithTasks] = useState(false);
  const [tasks, setTasks] = useState(['']);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const team = targets.find((t) => t.id === teamId) || targets[0];
  const { data: m } = useQuery({ queryKey: ['org-members', team?.orgId], enabled: !!team, staleTime: 60000, queryFn: () => workspacesAPI.members(team.orgId).then((r) => r.data) });
  const people = (m?.members || []).filter((x) => x.status === 'active' && team && x.spaces.some((s) => s.id === team.id));
  const list = tasks.map((t) => t.trim()).filter(Boolean);

  const go = async () => {
    if (!team || busy) return;
    setBusy(true); setErr('');
    try {
      const r = await notesAPI.teamShare(noteId, { spaceId: team.id, level, tasks: withTasks ? list : [] });
      await qc.invalidateQueries({ queryKey: ['shared-folders'] });
      onDone?.({ team, tasks: r.data.tasks, noteId: r.data.note?.id });
      onClose();
    } catch (e) { setErr(e.response?.data?.error || 'That did not work. Nothing was shared.'); setBusy(false); }
  };

  return (
    <Backdrop onClose={onClose} label="Share with team">
      <div className="s-share-head"><div><b>Share with team</b><small>{title || 'Untitled'}</small></div><button type="button" className="s-capture-close" aria-label="Close" onClick={onClose}><X size={16} strokeWidth={2.4} /></button></div>
      {targets.length === 0 && <p className="s-share-msg">You are not in a team you can add notes to yet.</p>}
      {targets.length > 0 && (
        <>
          <div className="ts-cap">Share into</div>
          <div className="s-move-list" data-testid="ts-teams">
            {targets.map((t) => { const R = iconOf(t.kind); return (
              <button key={t.id} type="button" className={`s-space-row${team?.id === t.id ? ' on' : ''}`} onClick={() => setTeamId(t.id)}>
                <i style={{ background: `var(--s-${toneOf(t.kind)})` }}><R size={16} /></i><span><b>{t.name}</b><small>{t.members} member{t.members === 1 ? '' : 's'}</small></span>{team?.id === t.id && <Check size={15} />}
              </button>); })}
          </div>
          <div className="ts-cap">What they can do</div>
          <div className="s-move-modes" role="radiogroup" aria-label="Access">
            <button type="button" role="radio" aria-checked={level === 'view'} data-testid="ts-view" className={level === 'view' ? 'on' : ''} onClick={() => setLevel('view')}><Eye size={13} /> Can view</button>
            <button type="button" role="radio" aria-checked={level === 'edit'} data-testid="ts-edit" className={level === 'edit' ? 'on' : ''} onClick={() => setLevel('edit')}><Pencil size={13} /> Can edit</button>
          </div>
          {people.length > 0 && (
            <div className="ts-people" data-testid="ts-people"><Users size={13} /><span>{people.length} {people.length === 1 ? 'person' : 'people'} will see it: {people.slice(0, 4).map((p) => p.name).join(', ')}{people.length > 4 ? ` and ${people.length - 4} more` : ''}</span></div>
          )}
          <label className="ts-toggle"><input type="checkbox" data-testid="ts-tasks-toggle" checked={withTasks} onChange={(e) => setWithTasks(e.target.checked)} /><span><b>Add a to-do list with this note</b><small>When every task is done, the note gets a Done tag.</small></span></label>
          {withTasks && (
            <div className="ts-tasks" data-testid="ts-tasks">
              {tasks.map((t, i) => (
                <div key={i} className="ts-task"><i /><input value={t} placeholder="A task for this note" maxLength={200} aria-label={`Task ${i + 1}`} onChange={(e) => setTasks((a) => a.map((x, j) => (j === i ? e.target.value : x)))} onKeyDown={(e) => { if (e.key === 'Enter' && t.trim()) { e.preventDefault(); setTasks((a) => (a.length < 20 ? [...a, ''] : a)); } }} />
                  {tasks.length > 1 && <button type="button" aria-label="Remove task" onClick={() => setTasks((a) => a.filter((_, j) => j !== i))}><X size={13} /></button>}</div>
              ))}
              <button type="button" className="ts-add" onClick={() => setTasks((a) => (a.length < 20 ? [...a, ''] : a))}><Plus size={13} /> Add a task</button>
            </div>
          )}
          <p className="s-share-msg">A copy goes into <b>{team?.name}</b>. Your original stays in Personal and the two are not kept in sync.</p>
        </>
      )}
      {err && <p className="s-space-err" role="alert">{err}</p>}
      <div className="s-space-btns"><button type="button" className="s-share-go" data-testid="ts-confirm" disabled={!team || busy} onClick={go}>{busy ? 'Sharing...' : 'Share note'}</button><button type="button" className="s-space-ghost" onClick={onClose}>Cancel</button></div>
    </Backdrop>
  );
}

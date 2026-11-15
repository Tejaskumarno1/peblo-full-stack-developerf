// Hand over work (mockup K12): a lead moves someone's open tasks to someone else.
import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { workspacesAPI } from '../api';
import { Backdrop, useCurrentSpace, useSpaceMembers, useWorkspaces } from './spaces';
import './teamshare.css';

export default function HandoverDialog({ onClose, onDone, initialFrom = '' }) {
  const space = useCurrentSpace();
  const qc = useQueryClient();
  const team = useSpaceMembers();
  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState('');
  const [tasks, setTasks] = useState(null);
  const [chosen, setChosen] = useState(new Set());
  const [note, setNote] = useState('');
  const [notes, setNotes] = useState(null); // what they wrote in this space (only owners and admins can see it)
  const [withNotes, setWithNotes] = useState(false);
  const { data: ws } = useWorkspaces();
  const orgId = (ws?.orgs || []).find((o) => o.spaces.some((x) => x.id === space))?.id;
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!from) { setTasks(null); return; }
    let live = true;
    workspacesAPI.openTasks(space, from).then((r) => { if (live) { setTasks(r.data.tasks); setChosen(new Set(r.data.tasks.map((t) => t.id))); } }).catch(() => { if (live) setErr('Could not load their open tasks.'); });
    return () => { live = false; };
  }, [from, space]);

  useEffect(() => {
    setNotes(null); setWithNotes(false);
    if (!from || !orgId) return undefined;
    let live = true;
    workspacesAPI.notesSummary(orgId, from).then((r) => { if (live) { const here = r.data.spaces.find((x) => x.id === space); setNotes(here || { notes: 0, private: 0 }); } }).catch(() => { /* not an owner or admin: tasks only */ });
    return () => { live = false; };
  }, [from, orgId, space]);

  const toggle = (id) => setChosen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const nm = (id) => team.people.find((p) => p.id === id)?.name || 'them';
  const go = async () => {
    if (!from || !to || from === to || (!chosen.size && !withNotes) || busy) return;
    setBusy(true); setErr('');
    try {
      const r = chosen.size ? await workspacesAPI.handover(space, { from, to, ids: [...chosen], note: note.trim() || undefined }) : { data: { moved: 0 } };
      let movedNotes = 0;
      if (withNotes) {
        const n = await workspacesAPI.handoverNotes(orgId, from, { toUserId: to, spaceIds: [space] });
        movedNotes = n.data.moved || 0;
        qc.invalidateQueries({ queryKey: ['notes'] });
      }
      qc.invalidateQueries({ queryKey: ['todos'] });
      qc.invalidateQueries({ queryKey: ['workload', space] });
      onDone?.(r.data.moved, nm(to), movedNotes);
      onClose();
    } catch (x) { setErr(x.response?.data?.error || 'Could not hand the work over.'); setBusy(false); }
  };

  return (
    <Backdrop onClose={onClose} label="Hand over work">
      <div className="s-share-head"><div><b>Hand over work</b><small>Move open tasks, and notes, from one person to another</small></div><button type="button" className="s-capture-close" aria-label="Close" onClick={onClose}><X size={16} strokeWidth={2.4} /></button></div>
      <div className="tp-body" data-testid="handover">
        <label>From<select aria-label="Hand over from" value={from} onChange={(e) => setFrom(e.target.value)}><option value="">Choose a person</option>{team.people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <label>To<select aria-label="Hand over to" value={to} onChange={(e) => setTo(e.target.value)}><option value="">Choose a person</option>{team.people.filter((p) => p.id !== from).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        {tasks && (tasks.length === 0 ? <p className="s-share-msg">{nm(from)} has no open tasks.</p> : (
          <ul className="tp-items" aria-label="Open tasks">
            {tasks.map((t) => <li key={t.id}><label className="tp-check"><input type="checkbox" data-testid="handover-task" checked={chosen.has(t.id)} onChange={() => toggle(t.id)} /> <span>{t.text}</span></label>{t.deadline && <small>{new Date(t.deadline).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</small>}</li>)}
          </ul>
        ))}
        {notes && notes.notes > 0 && (
          <label className="tp-check"><input type="checkbox" data-testid="handover-notes" checked={withNotes} onChange={(e) => setWithNotes(e.target.checked)} /> <span>Also hand over their {notes.notes} note{notes.notes === 1 ? '' : 's'} in this space{notes.private > 0 ? ` (${notes.private} private)` : ''}. {to ? `${nm(to)} becomes the author.` : 'The person you choose becomes the author.'}</span></label>
        )}
        <label>Note for them (optional)<input aria-label="Handover note" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} /></label>
        {err && <p className="s-space-err" role="alert">{err}</p>}
        <div className="s-space-btns"><button type="button" className="s-share-go" data-testid="handover-go" disabled={busy || !to || !from || (!chosen.size && !withNotes)} onClick={go}>Hand over {[chosen.size ? `${chosen.size} task${chosen.size === 1 ? '' : 's'}` : '', withNotes ? `${notes?.notes || ''} note${notes?.notes === 1 ? '' : 's'}` : ''].filter(Boolean).join(' and ')}</button><button type="button" className="s-space-ghost" onClick={onClose}>Cancel</button></div>
      </div>
    </Backdrop>
  );
}

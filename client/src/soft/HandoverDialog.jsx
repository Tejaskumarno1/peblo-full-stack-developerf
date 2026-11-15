// Hand over work (mockup K12): a lead moves someone's open tasks to someone else.
import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { workspacesAPI } from '../api';
import { Backdrop, useCurrentSpace, useSpaceMembers } from './spaces';
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
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!from) { setTasks(null); return; }
    let live = true;
    workspacesAPI.openTasks(space, from).then((r) => { if (live) { setTasks(r.data.tasks); setChosen(new Set(r.data.tasks.map((t) => t.id))); } }).catch(() => { if (live) setErr('Could not load their open tasks.'); });
    return () => { live = false; };
  }, [from, space]);

  const toggle = (id) => setChosen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const nm = (id) => team.people.find((p) => p.id === id)?.name || 'them';
  const go = async () => {
    if (!from || !to || from === to || !chosen.size || busy) return;
    setBusy(true); setErr('');
    try {
      const r = await workspacesAPI.handover(space, { from, to, ids: [...chosen], note: note.trim() || undefined });
      qc.invalidateQueries({ queryKey: ['todos'] });
      qc.invalidateQueries({ queryKey: ['workload', space] });
      onDone?.(r.data.moved, nm(to));
      onClose();
    } catch (x) { setErr(x.response?.data?.error || 'Could not hand the work over.'); setBusy(false); }
  };

  return (
    <Backdrop onClose={onClose} label="Hand over work">
      <div className="s-share-head"><div><b>Hand over work</b><small>Move open tasks from one person to another</small></div><button type="button" className="s-capture-close" aria-label="Close" onClick={onClose}><X size={16} strokeWidth={2.4} /></button></div>
      <div className="tp-body" data-testid="handover">
        <label>From<select aria-label="Hand over from" value={from} onChange={(e) => setFrom(e.target.value)}><option value="">Choose a person</option>{team.people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <label>To<select aria-label="Hand over to" value={to} onChange={(e) => setTo(e.target.value)}><option value="">Choose a person</option>{team.people.filter((p) => p.id !== from).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        {tasks && (tasks.length === 0 ? <p className="s-share-msg">{nm(from)} has no open tasks.</p> : (
          <ul className="tp-items" aria-label="Open tasks">
            {tasks.map((t) => <li key={t.id}><label className="tp-check"><input type="checkbox" data-testid="handover-task" checked={chosen.has(t.id)} onChange={() => toggle(t.id)} /> <span>{t.text}</span></label>{t.deadline && <small>{new Date(t.deadline).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</small>}</li>)}
          </ul>
        ))}
        <label>Note for them (optional)<input aria-label="Handover note" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} /></label>
        {err && <p className="s-space-err" role="alert">{err}</p>}
        <div className="s-space-btns"><button type="button" className="s-share-go" data-testid="handover-go" disabled={busy || !to || !from || !chosen.size} onClick={go}>Hand over {chosen.size || ''} task{chosen.size === 1 ? '' : 's'}</button><button type="button" className="s-space-ghost" onClick={onClose}>Cancel</button></div>
      </div>
    </Backdrop>
  );
}

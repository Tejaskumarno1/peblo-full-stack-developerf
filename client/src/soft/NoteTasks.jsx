// Tasks from a note (mockup K07): the unchecked items of a note become tasks with an owner and a day, linked back to the note.
import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Zap, X } from 'lucide-react';
import api from '../api/client';
import { todosAPI } from '../api';
import { useSpaceMembers } from './spaces';
import './teamshare.css';

const itemsOf = (md) => [...new Set(String(md || '').split('\n').map((l) => /^\s*[-*]\s\[ \]\s+(.+?)\s*$/.exec(l)?.[1]).filter(Boolean))];
const iso = (d) => { const x = new Date(`${d}T09:00`); return Number.isFinite(+x) ? x.toISOString() : null; };

export default function NoteTasks({ doc }) {
  const team = useSpaceMembers();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [owners, setOwners] = useState({});
  const [day, setDay] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const { data: linked = [] } = useQuery({ queryKey: ['note-tasks', doc?.id], enabled: !!doc?.id && team.canAssign, queryFn: () => api.get('/todos', { params: { noteId: doc.id } }).then((r) => r.data.todos || []) });
  const items = useMemo(() => itemsOf(doc?.content).filter((t) => !linked.some((x) => x.text === t)), [doc?.content, linked]);
  if (!team.canAssign || !doc?.id || doc.isDraft || (items.length === 0 && !msg)) return null;

  const create = async () => {
    setBusy(true); setMsg('');
    try {
      for (const text of items) await todosAPI.create({ text, noteId: doc.id, ...(day ? { deadline: iso(day) } : {}), ...(owners[text] ? { assignees: [owners[text]] } : {}) });
      qc.invalidateQueries({ queryKey: ['todos'] }); qc.invalidateQueries({ queryKey: ['note-tasks', doc.id] }); qc.invalidateQueries({ queryKey: ['team-note-tasks', doc.id] });
      setMsg(`Created ${items.length} task${items.length === 1 ? '' : 's'}. They are linked to this note.`);
      setOpen(false);
    } catch (e) { setMsg(e.response?.data?.error || 'Could not create the tasks.'); }
    setBusy(false);
  };

  return (
    <div className="nt" data-testid="note-tasks">
      {items.length > 0 && <button type="button" className="nt-btn" data-testid="nt-open" aria-expanded={open} onClick={() => setOpen(!open)}><Zap size={15} /> Turn {items.length} unchecked item{items.length === 1 ? '' : 's'} into tasks</button>}
      {msg && <span className="nt-msg" role="status" data-testid="nt-msg">{msg}</span>}
      {open && (
        <div className="nt-pop" role="dialog" aria-label="Make tasks from this note">
          <button type="button" className="nt-x" aria-label="Close" onClick={() => setOpen(false)}><X size={14} /></button>
          <ul>
            {items.map((t) => (
              <li key={t}>
                <span>{t}</span>
                <select aria-label={`Who does "${t}"`} value={owners[t] || ''} onChange={(e) => setOwners({ ...owners, [t]: e.target.value })} data-testid="nt-owner">
                  <option value="">Anyone</option>
                  {team.people.map((p) => <option key={p.id} value={p.id}>{p.id === team.me ? 'Me' : p.name.split(' ')[0]}</option>)}
                </select>
              </li>
            ))}
          </ul>
          <label className="nt-day">Due <input type="date" value={day} onChange={(e) => setDay(e.target.value)} data-testid="nt-day" /></label>
          <button type="button" className="nt-go" data-testid="nt-create" disabled={busy} onClick={create}>Create {items.length} task{items.length === 1 ? '' : 's'}</button>
        </div>
      )}
    </div>
  );
}

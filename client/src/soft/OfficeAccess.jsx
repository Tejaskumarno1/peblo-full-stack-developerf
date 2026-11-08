import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Eye, Lock, Pencil, Users, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { notesAccessAPI } from '../api';
import { Backdrop } from './spaces';
import './spaces.css';
import './officeaccess.css';

const LEVELS = [['view', 'Can view'], ['edit', 'Can edit']];

/** Office notes are private to the author until shared (mockups E01, E05). The small chip beside the title. */
export function AccessChip({ note }) {
  const [open, setOpen] = useState(false);
  if (!note?.access) return null;
  const mine = note.access === 'owner';
  const label = mine ? (note.sharedCount > 0 || note.everyone ? `Shared with ${note.everyone ? 'everyone' : note.sharedCount}` : 'Only you') : note.access === 'edit' ? `Shared by ${note.owner?.name || 'the author'} - can edit` : `Shared by ${note.owner?.name || 'the author'} - view only`;
  const Ic = mine ? (note.sharedCount > 0 || note.everyone ? Users : Lock) : note.access === 'edit' ? Pencil : Eye;
  return (
    <>
      <button type="button" className="oa-chip" data-testid="access-chip" onClick={() => mine && setOpen(true)} disabled={!mine} title={mine ? 'Who can open this note' : label}>
        <Ic size={13} />{label}
      </button>
      {open && <AccessDialog note={note} onClose={() => setOpen(false)} />}
    </>
  );
}

/** Who can open one of my notes: everyone in the office, or chosen people, each as viewer or editor (E05). */
export function AccessDialog({ note, onClose }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['note-access', note.id], queryFn: () => notesAccessAPI.get(note.id).then((r) => r.data) });
  const [err, setErr] = useState('');
  const [adding, setAdding] = useState('');
  const refresh = () => { qc.invalidateQueries({ queryKey: ['note-access', note.id] }); qc.invalidateQueries({ queryKey: ['notes'] }); };
  const save = async (body) => {
    setErr('');
    try { const r = await notesAccessAPI.set(note.id, body); qc.setQueryData(['note-access', note.id], r.data); refresh(); }
    catch (e) { setErr(e.response?.data?.error || 'Could not change access. Nothing was changed.'); }
  };
  const people = data?.people || [];
  const cands = (data?.candidates || []).filter((c) => !people.some((p) => p.userId === c.userId));
  const setLevel = (userId, level) => save({ people: people.map((p) => ({ userId: p.userId, level: p.userId === userId ? level : p.level })) });
  const add = (userId) => { if (!userId) return; setAdding(''); save({ people: [...people.map((p) => ({ userId: p.userId, level: p.level })), { userId, level: 'view' }] }); };
  const drop = (userId) => save({ people: people.filter((p) => p.userId !== userId).map((p) => ({ userId: p.userId, level: p.level })) });
  return (
    <Backdrop onClose={onClose} label="Who can open this note">
      <div className="s-share-head"><div><b>Who can open this note</b><small>Only you can change this</small></div><button type="button" className="s-capture-close" aria-label="Close" onClick={onClose}><X size={16} strokeWidth={2.4} /></button></div>
      <div className="oa-body" data-testid="access-dialog">
        {isLoading && <small className="oa-note">Loading...</small>}
        <div className="oa-row">
          <span className="oa-ic"><Users size={16} /></span>
          <span className="oa-who"><b>Everyone in this office</b><small>{data?.everyone ? 'Anyone in the office can open it' : 'Off, only the people below'}</small></span>
          <select aria-label="Access for everyone" value={data?.everyone || ''} onChange={(e) => save({ everyone: e.target.value || null })} data-testid="access-everyone">
            <option value="">No one</option>
            {LEVELS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        {people.map((p) => (
          <div key={p.userId} className="oa-row" data-testid="access-person">
            <span className="oa-av" aria-hidden="true">{(p.name || '?').charAt(0).toUpperCase()}</span>
            <span className="oa-who"><b>{p.name}</b><small>{p.email}</small></span>
            <select aria-label={`Access for ${p.name}`} value={p.level} onChange={(e) => setLevel(p.userId, e.target.value)}>
              {LEVELS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <button type="button" className="oa-x" aria-label={`Remove ${p.name}`} onClick={() => drop(p.userId)}><X size={14} /></button>
          </div>
        ))}
        {cands.length > 0 && (
          <label className="oa-add">Add a person
            <select value={adding} onChange={(e) => add(e.target.value)} data-testid="access-add">
              <option value="">Choose someone from the office</option>
              {cands.map((c) => <option key={c.userId} value={c.userId}>{c.name}</option>)}
            </select>
          </label>
        )}
        {err && <p className="s-space-err" role="alert">{err}</p>}
        <small className="oa-note">People you add are told. Take them off again at any time.</small>
      </div>
    </Backdrop>
  );
}

/** What someone sees when they open a link to an Office note that was not shared with them (E06). */
export function NoAccess({ owner }) {
  return (
    <div className="oa-none" data-testid="no-access">
      <span className="oa-none-ic"><Lock size={26} /></span>
      <h2>This note is private</h2>
      <p>{owner?.name ? `${owner.name} has not shared it with you.` : 'Its author has not shared it with you.'} Ask them for access, and it will appear in Shared with me.</p>
      <Link className="s-share-go" to="/notes">Back to my notes</Link>
    </div>
  );
}

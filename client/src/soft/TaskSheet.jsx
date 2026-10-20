import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { X, FileText, Trash2, Search, Check } from 'lucide-react';
import { notesAPI, todosAPI } from '../api';
import { tagsOf, addDays, startOfDay } from './softUtils';

const pad = (n) => String(n).padStart(2, '0');
const dateVal = (d) => (d ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` : '');
const timeVal = (d) => (d ? `${pad(d.getHours())}:${pad(d.getMinutes())}` : '');

/**
 * One place to set up a task: title, due date and time, priority, tags and the note it belongs to.
 * Opens as a pop-up (edit a task, or "task added, set it up") or inline inside the quick-capture window.
 */
export default function TaskSheet({ task, isNew = false, inline = false, onClose, onChanged }) {
  const queryClient = useQueryClient();
  const due = task.deadline ? new Date(task.deadline) : null;
  const [text, setText] = useState(task.text || '');
  const [date, setDate] = useState(dateVal(due));
  const [time, setTime] = useState(timeVal(due));
  const [priority, setPriority] = useState(task.priority || 'medium');
  const [tags, setTags] = useState(tagsOf(task));
  const [tagDraft, setTagDraft] = useState('');
  const [note, setNote] = useState(task.note || null);
  const [picking, setPicking] = useState(false);
  const [q, setQ] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const { data: notes = [] } = useQuery({
    queryKey: ['notes', 'sidebar'],
    queryFn: () => notesAPI.getAll({ sort: 'updated' }).then((r) => r.data.notes || []),
    staleTime: 30000,
  });
  const found = useMemo(() => {
    const s = q.trim().toLowerCase();
    return notes.filter((n) => !s || (n.title || '').toLowerCase().includes(s)).slice(0, 6);
  }, [notes, q]);
  const knownTags = useMemo(() => {
    const m = new Set();
    for (const n of notes) for (const t of n.tags || []) if (t !== 'inbox' && t !== 'private') m.add(t);
    return [...m].filter((t) => !tags.includes(t)).slice(0, 5);
  }, [notes, tags]);

  const quick = (offset) => { setDate(offset === null ? '' : dateVal(addDays(startOfDay(), offset))); if (offset === null) setTime(''); };
  const addTag = (raw) => {
    const t = raw.trim().replace(/^#/, '').toLowerCase();
    if (t && !tags.includes(t)) setTags([...tags, t]);
    setTagDraft('');
  };

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['todos'] });
    queryClient.invalidateQueries({ queryKey: ['dashboard'] });
  };
  const save = async () => {
    if (!text.trim() || saving) return;
    setSaving(true);
    setError('');
    try {
      const deadline = date ? new Date(`${date}T${time || '09:00'}`).toISOString() : null;
      await todosAPI.update(task.id, { text: text.trim(), priority, tags: tagDraft.trim() ? [...tags, tagDraft.trim().replace(/^#/, '').toLowerCase()] : tags, deadline, noteId: note?.id || null });
      refresh();
      onChanged?.();
      onClose();
    } catch (e) {
      setError(e.response?.data?.error || 'Could not save this task.');
    } finally {
      setSaving(false);
    }
  };
  const remove = async () => {
    await todosAPI.delete(task.id, 'this');
    refresh();
    onClose();
  };

  const body = (
    <div className={`s-sheet${inline ? ' inline' : ''}`} role={inline ? undefined : 'dialog'} aria-label={isNew ? 'Set up your new task' : 'Edit task'} onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }}>
      <div className="s-sheet-top">
        <span className="s-sheet-kicker">{isNew ? <><Check size={14} strokeWidth={2.8} /> Task added · set it up</> : 'Task'}</span>
        <span className="grow" />
        <button type="button" className="s-capture-close" aria-label="Close" onClick={onClose}><X size={16} strokeWidth={2.4} /></button>
      </div>

      <label className="s-sr" htmlFor="s-sheet-title">Task</label>
      <input id="s-sheet-title" className="s-sheet-title" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } }} autoFocus={!inline} />

      <div className="s-sheet-row">
        <span className="s-sheet-label">Due</span>
        <div className="s-sheet-grow">
          <div className="s-sheet-quick">
            <button type="button" onClick={() => quick(0)} className={date === dateVal(startOfDay()) ? 'on' : ''}>Today</button>
            <button type="button" onClick={() => quick(1)} className={date === dateVal(addDays(startOfDay(), 1)) ? 'on' : ''}>Tomorrow</button>
            <button type="button" onClick={() => quick(7)}>Next week</button>
            <button type="button" onClick={() => quick(null)} className={!date ? 'on' : ''}>No date</button>
          </div>
          <div className="s-sheet-when">
            <input type="date" aria-label="Due date" value={date} onChange={(e) => setDate(e.target.value)} />
            <input type="time" aria-label="Due time" value={time} onChange={(e) => setTime(e.target.value)} disabled={!date} />
          </div>
        </div>
      </div>

      <div className="s-sheet-row">
        <span className="s-sheet-label">Priority</span>
        <div className="s-sheet-quick" role="radiogroup" aria-label="Priority">
          {['high', 'medium', 'low'].map((p) => (
            <button key={p} type="button" role="radio" aria-checked={priority === p} className={priority === p ? 'on' : ''} onClick={() => setPriority(p)}>{p === 'medium' ? 'Normal' : p[0].toUpperCase() + p.slice(1)}</button>
          ))}
        </div>
      </div>

      <div className="s-sheet-row">
        <span className="s-sheet-label">Tags</span>
        <div className="s-sheet-grow">
          <div className="s-sheet-tags">
            {tags.map((t) => (
              <span key={t} className="s-tag" style={{ background: 'var(--s-butter)' }}>#{t}<button type="button" aria-label={`Remove tag ${t}`} onClick={() => setTags(tags.filter((x) => x !== t))}><X size={11} strokeWidth={2.8} /></button></span>
            ))}
            <input aria-label="Add a tag" className="s-sheet-taginput" value={tagDraft} placeholder="+ tag" onChange={(e) => setTagDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); e.stopPropagation(); addTag(tagDraft); } }} />
          </div>
          {knownTags.length > 0 && !tagDraft && (
            <div className="s-sheet-suggest">{knownTags.map((t) => <button key={t} type="button" onClick={() => addTag(t)}>#{t}</button>)}</div>
          )}
        </div>
      </div>

      <div className="s-sheet-row">
        <span className="s-sheet-label">Note</span>
        <div className="s-sheet-grow">
          {note && !picking ? (
            <div className="s-sheet-note">
              <FileText size={15} />
              <Link to={`/notes/${note.id}`} onClick={onClose} className="grow">{note.title || 'Untitled'}</Link>
              <button type="button" onClick={() => setPicking(true)}>Change</button>
              <button type="button" aria-label="Unlink note" onClick={() => setNote(null)}><X size={13} /></button>
            </div>
          ) : picking ? (
            <div className="s-sheet-pick">
              <label className="s-sheet-search"><Search size={14} /><input autoFocus aria-label="Search notes" placeholder="Search your notes" value={q} onChange={(e) => setQ(e.target.value)} /></label>
              {found.length === 0 && <p className="s-empty small">No note matches.</p>}
              {found.map((n) => (
                <button key={n.id} type="button" className="s-sheet-opt" onClick={() => { setNote({ id: n.id, title: n.title }); setPicking(false); setQ(''); }}>{n.title || 'Untitled'}</button>
              ))}
              <button type="button" className="s-sheet-cancel" onClick={() => { setPicking(false); setQ(''); }}>Cancel</button>
            </div>
          ) : (
            <button type="button" className="s-dashed s-sheet-linkbtn" onClick={() => setPicking(true)}>+ Link a note</button>
          )}
        </div>
      </div>

      {error && <p className="s-sheet-error" role="alert">{error}</p>}
      <div className="s-sheet-foot">
        {!isNew && <button type="button" className="s-sheet-del" onClick={remove}><Trash2 size={14} /> Delete</button>}
        <span className="grow" />
        {isNew && <button type="button" className="s-sheet-skip" onClick={onClose}>Skip</button>}
        <button type="button" className="s-capture-add" disabled={!text.trim() || saving} onClick={save}>{saving ? 'Saving…' : isNew ? 'Done' : 'Save'}</button>
      </div>
    </div>
  );

  if (inline) return body;
  return (
    <div className="s-sheet-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      {body}
    </div>
  );
}

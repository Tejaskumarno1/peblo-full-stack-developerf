import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { X, FileText, Check, ChevronLeft, ChevronRight } from 'lucide-react';
import { notesAPI, todosAPI } from '../api';
import TaskSteps from '../components/TaskSteps';
import ShareDialog from './ShareDialog';
import { tagsOf, addDays, startOfDay, snippetOf } from './softUtils';

const pad = (n) => String(n).padStart(2, '0');
const dateVal = (d) => (d ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` : '');
const timeVal = (d) => (d ? `${pad(d.getHours())}:${pad(d.getMinutes())}` : '');
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const PRESETS = [['09:00', 'Morning · 9:00 AM'], ['14:00', 'Afternoon · 2:00 PM'], ['18:30', 'Evening · 6:30 PM']];
const label12 = (t) => { const [h, m] = t.split(':').map(Number); return `${h % 12 || 12}:${pad(m)} ${h < 12 ? 'AM' : 'PM'}`; };
const TAG_TONES = ['butter', 'mint', 'lilac', 'peach', 'sky'];

function MiniCalendar({ value, onPick }) {
  const sel = value ? new Date(`${value}T00:00`) : null;
  const [month, setMonth] = useState(() => { const d = sel || new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const today = dateVal(new Date());
  const lead = (month.getDay() + 6) % 7; // Monday first
  const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const cells = [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => new Date(month.getFullYear(), month.getMonth(), i + 1))];
  return (
    <div className="s-mcal" role="group" aria-label="Pick a date">
      <div className="s-mcal-head">
        <b>{MONTHS[month.getMonth()]} {month.getFullYear()}</b>
        <button type="button" aria-label="Previous month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}><ChevronLeft size={15} /></button>
        <button type="button" aria-label="Next month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}><ChevronRight size={15} /></button>
      </div>
      <div className="s-mcal-grid dow">{['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => <span key={i}>{d}</span>)}</div>
      <div className="s-mcal-grid">
        {cells.map((d, i) => (d
          ? <button key={i} type="button" className={`s-mcal-day${dateVal(d) === value ? ' on' : ''}${dateVal(d) === today ? ' today' : ''}`} aria-label={d.toDateString()} aria-pressed={dateVal(d) === value} onClick={() => onPick(dateVal(d))}>{d.getDate()}</button>
          : <span key={i} />))}
      </div>
    </div>
  );
}

/**
 * One place to set up a task: title, due date and time, priority, tags and the note it belongs to.
 * Opens as a pop-up (edit a task, or "task added, set it up") or inline inside the quick-capture window.
 */
export default function TaskSheet({ task, isNew = false, inline = false, onClose, onChanged }) {
  const queryClient = useQueryClient();
  const due = task.deadline ? new Date(task.deadline) : null;
  const [text, setText] = useState(task.text || '');
  const [shareOpen, setShareOpen] = useState(false);
  const [date, setDate] = useState(dateVal(due));
  const [time, setTime] = useState(timeVal(due));
  const [cal, setCal] = useState(false);
  const [customTime, setCustomTime] = useState(false);
  const [priority, setPriority] = useState(task.priority || 'medium');
  const [tags, setTags] = useState(tagsOf(task));
  const [tagMenu, setTagMenu] = useState(false);
  const [tagDraft, setTagDraft] = useState('');
  const [note, setNote] = useState(task.note || null);
  const [picking, setPicking] = useState(false);
  const [q, setQ] = useState('');
  const [saving, setSaving] = useState(false);
  const [link, setLink] = useState(task.meta?.link || '');
  const [steps, setSteps] = useState(task.meta?.subtasks || []);
  const [error, setError] = useState('');

  const { data: notes = [] } = useQuery({
    queryKey: ['notes', 'sidebar'],
    queryFn: () => notesAPI.getAll({ sort: 'updated' }).then((r) => r.data.notes || []),
    staleTime: 30000,
  });
  const found = useMemo(() => {
    const s = q.trim().toLowerCase();
    return notes.filter((n) => !s || (n.title || '').toLowerCase().includes(s)).slice(0, 5);
  }, [notes, q]);
  const noteFull = note ? notes.find((n) => n.id === note.id) || note : null;
  const knownTags = useMemo(() => {
    const m = new Map();
    for (const n of notes) for (const t of n.tags || []) if (t !== 'inbox' && t !== 'private') m.set(t, (m.get(t) || 0) + 1);
    for (const t of tagsOf(task)) m.set(t, (m.get(t) || 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t);
  }, [notes, task]);
  const tagChoices = knownTags.filter((t) => !tags.includes(t) && t.includes(tagDraft.trim().replace(/^#/, '').toLowerCase())).slice(0, 6);

  const today = startOfDay();
  const weekend = (() => { const d = addDays(today, (6 - today.getDay() + 7) % 7 || 7); return d; })();
  const quick = [
    ['Today', dateVal(today)], ['Tomorrow', dateVal(addDays(today, 1))], ['This weekend', dateVal(weekend)], ['Next week', dateVal(addDays(today, 7))],
  ];
  const setDay = (v) => { setDate(v); setCal(false); if (!time) setTime('09:00'); };
  const noDate = () => { setDate(''); setTime(''); setCal(false); };
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
      const t = tagDraft.trim().replace(/^#/, '').toLowerCase();
      await todosAPI.update(task.id, { text: text.trim(), priority, tags: t && !tags.includes(t) ? [...tags, t] : tags, deadline, noteId: note?.id || null, meta: { link: link.trim() || null, subtasks: steps } });
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

  const dueLabel = date ? new Date(`${date}T00:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }) : null;

  const body = (
    <div className={`s-sheet${inline ? ' inline' : ''}`} role={inline ? undefined : 'dialog'} aria-label={isNew ? 'Set up your new task' : 'Edit task'} onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }}>
      <div className="s-sheet-top">
        <span className={`s-sheet-kicker${isNew ? ' new' : ''}`}>{isNew ? <><Check size={13} strokeWidth={3} /> Task added</> : 'Task'}</span>
        <span className="grow" />
        <button type="button" className="s-capture-close" aria-label="Close" onClick={onClose}><X size={16} strokeWidth={2.4} /></button>
      </div>

      <label className="s-sr" htmlFor="s-sheet-title">Task</label>
      <input id="s-sheet-title" className="s-sheet-title" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } }} autoFocus={!inline} />

      <section className="s-sheet-sec" aria-label="Due">
        <span className="s-sheet-lab">Due{dueLabel ? ` · ${dueLabel}${time ? `, ${label12(time)}` : ''}` : ''}</span>
        <div className="s-sheet-pills">
          {quick.map(([name, v]) => <button key={name} type="button" className={date === v ? 'on' : ''} onClick={() => setDay(v)}>{name}</button>)}
          <button type="button" className={cal ? 'on' : ''} onClick={() => setCal((c) => !c)} aria-expanded={cal}>Pick a date</button>
          <button type="button" className={`ghost${!date ? ' on' : ''}`} onClick={noDate}>No date</button>
        </div>
        {cal && <MiniCalendar value={date} onPick={setDay} />}
        {date && (
          <div className="s-sheet-pills time" role="group" aria-label="Time">
            {PRESETS.map(([v, name]) => <button key={v} type="button" className={!customTime && time === v ? 'on' : ''} onClick={() => { setTime(v); setCustomTime(false); }}>{name}</button>)}
            <button type="button" className={`ghost${customTime || (time && !PRESETS.some(([v]) => v === time)) ? ' on' : ''}`} onClick={() => setCustomTime(true)}>Custom…</button>
            {(customTime || (time && !PRESETS.some(([v]) => v === time))) && <input type="time" aria-label="Due time" className="s-sheet-time" value={time} onChange={(e) => setTime(e.target.value)} />}
          </div>
        )}
      </section>

      <section className="s-sheet-sec" aria-label="Priority">
        <span className="s-sheet-lab">Priority</span>
        <div className="s-sheet-pills" role="radiogroup" aria-label="Priority">
          {[['high', 'High', 'var(--s-accent)'], ['medium', 'Normal', 'var(--s-sky)'], ['low', 'Low', 'var(--s-mint)']].map(([p, name, dot]) => (
            <button key={p} type="button" role="radio" aria-checked={priority === p} className={priority === p ? 'on' : ''} onClick={() => setPriority(p)}><i style={{ background: dot }} />{name}</button>
          ))}
        </div>
      </section>

      <section className="s-sheet-sec" aria-label="Steps"><TaskSteps steps={steps} onChange={setSteps} /></section>

      <section className="s-sheet-sec" aria-label="Link">
        <span className="s-sheet-lab">Link</span>
        <div className="s-sheet-row" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input type="url" value={link} onChange={(e) => setLink(e.target.value)} placeholder="Meeting or page link (https://…)" aria-label="Meeting or page link" maxLength={500} style={{ flex: 1, minWidth: 0 }} />
          {/^https:\/\//i.test(link.trim()) && <a className="s-outline s-set-btn" href={link.trim()} target="_blank" rel="noopener noreferrer">Open</a>}
        </div>
      </section>

      <section className="s-sheet-sec" aria-label="Tags">
        <span className="s-sheet-lab">Tags</span>
        <div className="s-sheet-pills">
          {tags.map((t, i) => (
            <span key={t} className="s-tag s-sheet-tag" style={{ background: `var(--s-${TAG_TONES[i % TAG_TONES.length]})` }}>#{t}<button type="button" aria-label={`Remove tag ${t}`} onClick={() => setTags(tags.filter((x) => x !== t))}><X size={11} strokeWidth={2.8} /></button></span>
          ))}
          <button type="button" className="ghost" aria-expanded={tagMenu} onClick={() => setTagMenu((v) => !v)}>+ Add tag</button>
        </div>
        {tagMenu && (
          <div className="s-sheet-menu">
            <input aria-label="Add a tag" autoFocus placeholder="Type a tag, press Enter" value={tagDraft} onChange={(e) => setTagDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); e.stopPropagation(); addTag(tagDraft); } }} />
            <div className="s-sheet-menu-list">
              {tagChoices.map((t) => <button key={t} type="button" onClick={() => addTag(t)}>#{t}</button>)}
              {tagChoices.length === 0 && !tagDraft && <span className="s-empty small">No other tags yet.</span>}
            </div>
          </div>
        )}
      </section>

      <section className="s-sheet-sec" aria-label="Connected note">
        <span className="s-sheet-lab">Connected note</span>
        {noteFull && !picking ? (
          <div className="s-sheet-notecard">
            <span className="ico"><FileText size={17} /></span>
            <span className="txt"><b>{noteFull.title || 'Untitled'}</b><small>{snippetOf(noteFull.content, 60) || 'Empty note'}</small></span>
            <Link to={`/notes/${noteFull.id}`} onClick={onClose}>Open</Link>
            <button type="button" onClick={() => setPicking(true)}>Change</button>
            <button type="button" aria-label="Unlink note" onClick={() => setNote(null)}><X size={13} /></button>
          </div>
        ) : picking ? (
          <div className="s-sheet-menu">
            <input aria-label="Search notes" autoFocus placeholder="Search your notes" value={q} onChange={(e) => setQ(e.target.value)} />
            <div className="s-sheet-menu-list col">
              {found.length === 0 && <span className="s-empty small">No note matches.</span>}
              {found.map((n) => <button key={n.id} type="button" onClick={() => { setNote({ id: n.id, title: n.title }); setPicking(false); setQ(''); }}>{n.title || 'Untitled'}</button>)}
              <button type="button" className="muted" onClick={() => { setPicking(false); setQ(''); }}>Cancel</button>
            </div>
          </div>
        ) : (
          <button type="button" className="s-sheet-linkbtn" onClick={() => setPicking(true)}>+ Link a note</button>
        )}
      </section>

      {shareOpen && <ShareDialog kind="todo" id={task.id} title={text} onClose={() => setShareOpen(false)} />}
      {error && <p className="s-sheet-error" role="alert">{error}</p>}
      <div className="s-sheet-foot">
        {!isNew && <button type="button" className="s-sheet-del" style={{ marginRight: 8 }} onClick={() => setShareOpen(true)}>Share</button>}
          {!isNew && <button type="button" className="s-sheet-del" onClick={remove}>Delete</button>}
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

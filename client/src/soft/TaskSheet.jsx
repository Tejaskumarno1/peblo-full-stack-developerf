import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { X, FileText, Check, ChevronLeft, ChevronRight, Copy, Repeat } from 'lucide-react';
import { notesAPI, todosAPI } from '../api';
import TaskSteps from '../components/TaskSteps';
import ShareDialog from './ShareDialog';
import TaskThread from './TaskThread';
import { askScope } from '../utils/askScope';
import { useSpaceMembers } from './spaces';
import './tasks2.css';
import { tagsOf, addDays, startOfDay, snippetOf } from './softUtils';

const pad = (n) => String(n).padStart(2, '0');
const dateVal = (d) => (d ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` : '');
const timeVal = (d) => (d ? `${pad(d.getHours())}:${pad(d.getMinutes())}` : '');
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const PRESETS = [['09:00', 'Morning · 9:00 AM'], ['14:00', 'Afternoon · 2:00 PM'], ['18:30', 'Evening · 6:30 PM']];
const label12 = (t) => { const [h, m] = t.split(':').map(Number); return `${h % 12 || 12}:${pad(m)} ${h < 12 ? 'AM' : 'PM'}`; };
const REPEATS = [['none', 'None'], ['daily', 'Daily'], ['weekdays', 'Weekdays'], ['weekly', 'Weekly'], ['monthly', 'Monthly'], ['yearly', 'Yearly'], ['custom', 'Custom']];
const UNITS = [['day', 'days'], ['week', 'weeks'], ['month', 'months'], ['year', 'years']];
const customOf = (r) => { const m = /^every:(\d+):(day|week|month|year)$/.exec(r || ''); return m ? { n: Number(m[1]), unit: m[2] } : null; };
const REMINDS = [[0, 'At the time'], [10, '10 min before'], [60, '1 hour before'], [1440, '1 day before']];
const MORE_REMINDS = [[5, '5 min before'], [30, '30 min before'], [120, '2 hours before']];
const TRAVEL = [10, 15, 25, 30, 45, 60];
const ESTIMATES = [[15, '15 min'], [30, '30 min'], [60, '1 hour']];
const ordinal = (n) => { const v = n % 100; return n + (['th', 'st', 'nd', 'rd'][(v - 20) % 10] || ['th', 'st', 'nd', 'rd'][v] || 'th'); };
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
  const team = useSpaceMembers();
  const startAssignees = useMemo(() => (Array.isArray(task.meta?.assignees) && task.meta.assignees.length ? task.meta.assignees : task.assigneeId ? [task.assigneeId] : []), [task]);
  const [assignees, setAssignees] = useState(startAssignees);
  const [addingPerson, setAddingPerson] = useState(false);
  const [visibility, setVisibility] = useState(task.meta?.visibility === 'me' || task.meta?.visibility === 'people' ? task.meta.visibility : 'team');
  const [viewers, setViewers] = useState(Array.isArray(task.meta?.viewers) ? task.meta.viewers : []);
  const startStatus = task.completed ? 'done' : task.meta?.status === 'doing' || task.meta?.status === 'review' ? task.meta.status : 'todo';
  const [status, setStatus] = useState(startStatus);
  const startWatching = Array.isArray(task.meta?.watchers) && task.meta.watchers.includes(team.me);
  const [watching, setWatching] = useState(startWatching);
  const toggleIn = (list, set, id) => set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
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
  const [recurrence, setRecurrence] = useState(task.recurrence || 'none');
  const [fromDone, setFromDone] = useState(!!task.meta?.repeatFromDone);
  const [reminders, setReminders] = useState(() => (Array.isArray(task.meta?.reminders) ? task.meta.reminders : typeof task.meta?.remindMin === 'number' ? [task.meta.remindMin] : []));
  const remind = reminders.length ? Math.min(...reminders) : null; // the single field older code reads
  const [travel, setTravel] = useState(task.meta?.travelMin ?? null);
  const toggleRemind = (m) => setReminders((r) => (r.includes(m) ? r.filter((x) => x !== m) : [...r, m].sort((a, b) => a - b)));
  const [estimate, setEstimate] = useState(task.meta?.estimateMin ?? null);
  const [confirmEsc, setConfirmEsc] = useState(false);
  const snap0 = useRef(null);
  const snapNow = JSON.stringify({ assignees, visibility, viewers, status, watching, text, date, time, priority, tags, note: note?.id || null, link, steps, recurrence, fromDone, reminders, travel, estimate });
  if (snap0.current === null) snap0.current = snapNow;
  const dirty = snapNow !== snap0.current || !!tagDraft.trim();
  const requestClose = () => { if (dirty && !saving) setConfirmEsc(true); else onClose(); };

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
    ['Today', dateVal(today)], ['Tomorrow', dateVal(addDays(today, 1))], ...(dateVal(weekend) === dateVal(addDays(today, 1)) ? [] : [['This weekend', dateVal(weekend)]]), ['Next week', dateVal(addDays(today, 7))],
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
      const ruleChanged = recurrence !== (task.recurrence || 'none');
      let scope = 'this';
      if (task.seriesId && !isNew && !ruleChanged) {
        scope = await askScope(task, 'edit');
        if (!scope) { setSaving(false); return; }
      }
      await todosAPI.update(task.id, {
        text: text.trim(), priority, tags: t && !tags.includes(t) ? [...tags, t] : tags, deadline, noteId: note?.id || null, scope,
        ...(ruleChanged ? { recurrence } : {}),
        ...(team.canAssign && JSON.stringify(assignees) !== JSON.stringify(startAssignees) ? { assignees } : {}),
        ...(team.canAssign && status !== startStatus && status !== 'done' ? { column: status } : {}),
        meta: {
          ...(team.canAssign ? {
            visibility: visibility === 'team' ? null : visibility,
            viewers: visibility === 'people' && viewers.length ? viewers : null,
            ...(watching === startWatching ? {} : { watchers: (() => { const w = (Array.isArray(task.meta?.watchers) ? task.meta.watchers : []).filter((x) => x !== team.me); if (watching) w.push(team.me); return w.length ? w : null; })() }),
          } : {}),
          link: link.trim() || null, subtasks: steps, remindMin: remind, reminders: reminders.length ? reminders : null, travelMin: travel || null, estimateMin: estimate, repeatFromDone: fromDone && recurrence !== 'none' ? true : null },
      });
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

  const skipThis = async () => {
    await todosAPI.delete(task.id, 'this');
    refresh();
    onChanged?.();
    onClose();
  };
  const duplicate = async () => {
    try {
      await todosAPI.create({
        text: text.trim() || task.text, priority, tags, noteId: note?.id || null,
        deadline: date ? new Date(`${date}T${time || '09:00'}`).toISOString() : null,
        meta: { link: link.trim() || null, subtasks: steps.map((x) => ({ ...x, done: false })), remindMin: remind, reminders: reminders.length ? reminders : null, travelMin: travel || null, estimateMin: estimate },
      });
      refresh();
      onChanged?.();
      onClose();
    } catch (e) { setError(e.response?.data?.error || 'Could not duplicate this task.'); }
  };
  const repeatNote = (() => {
    if (recurrence === 'none' || !date) return '';
    const d = new Date(`${date}T00:00`);
    const c = customOf(recurrence);
    if (c) return `Every ${c.n === 1 ? '' : c.n + ' '}${UNITS.find((u) => u[0] === c.unit)[1].replace(/s$/, c.n === 1 ? '' : 's')}`;
    return ({ daily: 'Every day', weekdays: 'Every weekday', weekly: `Every week on ${d.toLocaleDateString(undefined, { weekday: 'long' })}`, monthly: `Every month on the ${ordinal(d.getDate())}`, yearly: `Every year on ${d.toLocaleDateString(undefined, { day: 'numeric', month: 'long' })}` })[recurrence] || '';
  })();
  const source = task.meta?.source || null;
  const dueLabel = date ? new Date(`${date}T00:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }) : null;

  const body = (
    <div className={`s-sheet${inline ? ' inline' : ' wide'}`} role={inline ? undefined : 'dialog'} aria-label={isNew ? 'Set up your new task' : 'Edit task'} onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && text.trim() && !saving) { e.preventDefault(); save(); return; } if (e.key === 'Escape') { e.stopPropagation(); if (confirmEsc) setConfirmEsc(false); else requestClose(); } }}>
      <div className="s-sheet-top">
        <span className={`s-sheet-kicker${isNew ? ' new' : ''}`}>{isNew ? <><Check size={13} strokeWidth={3} /> Task added</> : 'Task'}</span>
        <span className="grow" />
        <button type="button" className="s-capture-close" aria-label="Close" onClick={requestClose}><X size={16} strokeWidth={2.4} /></button>
      </div>

      {recurrence !== 'none' && date && <p className="s-sheet-sub">Part of a repeating series</p>}
      <label className="s-sr" htmlFor="s-sheet-title">Task</label>
      <input id="s-sheet-title" className="s-sheet-title" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } }} autoFocus={!inline} />

      <div className="s-sheet-cols">
        <div className="s-sheet-col">
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

      {date && (
        <section className="s-sheet-sec" aria-label="Repeat">
          <span className="s-sheet-lab">Repeat</span>
          <div className="s-sheet-pills" role="radiogroup" aria-label="Repeat">
            {REPEATS.map(([k, name]) => <button key={k} type="button" role="radio" aria-checked={k === 'custom' ? !!customOf(recurrence) : recurrence === k} className={(k === 'custom' ? !!customOf(recurrence) : recurrence === k) ? 'on' : ''} onClick={() => setRecurrence(k === 'custom' ? (customOf(recurrence) ? recurrence : 'every:2:week') : k)}>{name}</button>)}
          </div>
          {customOf(recurrence) && (
            <div className="s-sheet-custom" role="group" aria-label="Custom repeat">
              <span>Every</span>
              <input type="number" min="1" max="999" aria-label="Repeat every" value={customOf(recurrence).n} onChange={(e) => setRecurrence(`every:${Math.min(999, Math.max(1, parseInt(e.target.value, 10) || 1))}:${customOf(recurrence).unit}`)} />
              <select aria-label="Repeat unit" value={customOf(recurrence).unit} onChange={(e) => setRecurrence(`every:${customOf(recurrence).n}:${e.target.value}`)}>{UNITS.map(([u, name]) => <option key={u} value={u}>{name}</option>)}</select>
            </div>
          )}
          {recurrence !== 'none' && (
            <>
              <p className="s-sheet-note"><Repeat size={13} /> {repeatNote}</p>
              <label className="s-sheet-check"><input type="checkbox" checked={fromDone} onChange={(e) => setFromDone(e.target.checked)} /> Repeat from the date I finish it</label>
              {task.seriesId && !isNew && <button type="button" className="s-sheet-skipone" onClick={skipThis}>Skip this one</button>}
              <p className="s-sheet-hint">Saving a change asks: just this one, this and following, or all in the series.</p>
            </>
          )}
        </section>
      )}

      <section className="s-sheet-sec" aria-label="Remind me">
        <span className="s-sheet-lab">Remind me</span>
        <div className="s-sheet-pills" role="group" aria-label="Remind me">
          {[...REMINDS, ...MORE_REMINDS].sort((x, y) => x[0] - y[0]).map(([m, name]) => <button key={m} type="button" aria-pressed={reminders.includes(m)} className={reminders.includes(m) ? 'on' : ''} onClick={() => toggleRemind(m)}>{name}</button>)}
          <button type="button" className={`ghost${reminders.length === 0 ? ' on' : ''}`} onClick={() => setReminders([])}>No reminder</button>
        </div>
        <p className="s-sheet-hint">Pick as many as you like. When one rings you can snooze it: 10 min, 1 hour, tonight, tomorrow morning or after your next meeting.</p>
      </section>

      {time && (
        <section className="s-sheet-sec" aria-label="Travel time">
          <span className="s-sheet-lab">Travel time</span>
          <div className="s-sheet-pills" role="group" aria-label="Travel time">
            {TRAVEL.map((m) => <button key={m} type="button" aria-pressed={travel === m} className={travel === m ? 'on' : ''} onClick={() => setTravel(travel === m ? null : m)}>{m} min</button>)}
            <button type="button" className={`ghost${!travel ? ' on' : ''}`} onClick={() => setTravel(null)}>None</button>
          </div>
          <p className="s-sheet-hint">{travel ? `Peblo tells you when to leave, ${travel} min before it starts, and the calendar shows a lighter block for the trip.` : 'Add the time it takes to get there and Peblo will tell you when to leave.'}</p>
        </section>
      )}

      {source && (
        <section className="s-sheet-sec" aria-label="Where it came from">
          <span className="s-sheet-lab">Where it came from</span>
          <div className="s-sheet-source">
            <blockquote>&ldquo;{source.quote}&rdquo;</blockquote>
            <div className="row">
              <span>{noteFull?.title || task.note?.title || 'Note'}{source.line ? ` \u00b7 line ${source.line}` : ''}</span>
              {(source.noteId || task.noteId) && <Link className="chip" to={`/notes/${source.noteId || task.noteId}${source.line ? `?line=${source.line}` : ''}`} onClick={onClose}>Jump to the line</Link>}
              {!isNew && <Link className="chip" to={`/tasks/focus/${task.id}`} onClick={onClose}>Open note beside</Link>}
            </div>
          </div>
        </section>
      )}

      <section className="s-sheet-sec" aria-label="Link">
        <span className="s-sheet-lab">Link</span>
        <div className="s-sheet-row" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input type="url" value={link} onChange={(e) => setLink(e.target.value)} placeholder="Meeting or page link (https://…)" aria-label="Meeting or page link" maxLength={500} style={{ flex: 1, minWidth: 0 }} />
          {/^https:\/\//i.test(link.trim()) && <a className="s-outline s-set-btn" href={link.trim()} target="_blank" rel="noopener noreferrer">Open</a>}
        </div>
      </section>

        </div>
        <div className="s-sheet-col">
      <section className="s-sheet-sec" aria-label="Priority">
        <span className="s-sheet-lab">Priority</span>
        <div className="s-sheet-pills" role="radiogroup" aria-label="Priority">
          {[['high', 'High', 'var(--s-accent)'], ['medium', 'Normal', 'var(--s-sky)'], ['low', 'Low', 'var(--s-mint)']].map(([p, name, dot]) => (
            <button key={p} type="button" role="radio" aria-checked={priority === p} className={priority === p ? 'on' : ''} onClick={() => setPriority(p)}><i style={{ background: dot }} />{name}</button>
          ))}
        </div>
      </section>

      {team.canAssign && (
        <section className="s-sheet-sec" aria-label="Assigned to">
          <span className="s-sheet-lab">Assigned to</span>
          <div className="s-sheet-pills" aria-label="Assigned to" data-testid="assignee-chips">
            {assignees.length === 0 && <span className="tk-anyone">Anyone on the team</span>}
            {assignees.map((id) => {
              const p = team.people.find((x) => x.id === id);
              return <button key={id} type="button" className="on tk-chip" data-testid="sheet-assignee" title="Remove" onClick={() => setAssignees(assignees.filter((x) => x !== id))}>{id === team.me ? 'Me' : (p?.name || 'Member').split(' ')[0]} <span aria-hidden>×</span></button>;
            })}
            <button type="button" className="tk-add" data-testid="assignee-add" aria-expanded={addingPerson} onClick={() => setAddingPerson(!addingPerson)}>+ Add person</button>
          </div>
          {addingPerson && (
            <div className="s-sheet-pills tk-people" role="group" aria-label="Pick people">
              {team.people.filter((p) => !assignees.includes(p.id)).map((p) => <button key={p.id} type="button" data-testid="assign-pill" onClick={() => { setAssignees([...assignees, p.id]); setAddingPerson(false); }}>{p.id === team.me ? 'Me' : p.name.split(' ')[0]}</button>)}
              {team.people.every((p) => assignees.includes(p.id)) && <span className="tk-anyone">Everyone is already on it</span>}
            </div>
          )}
        </section>
      )}

      {team.canAssign && (
        <section className="s-sheet-sec" aria-label="Who can see this">
          <span className="s-sheet-lab">Who can see this</span>
          <div className="s-sheet-pills" role="radiogroup" aria-label="Who can see this">
            {[['team', 'Whole team'], ['people', 'Picked people'], ['me', 'Just me']].map(([v, name]) => (
              <button key={v} type="button" role="radio" aria-checked={visibility === v} className={visibility === v ? 'on' : ''} data-testid={`vis-${v}`} onClick={() => setVisibility(v)}>{name}</button>
            ))}
          </div>
          {visibility === 'people' && (
            <div className="s-sheet-pills tk-people" role="group" aria-label="People who can see it">
              {team.people.filter((p) => p.id !== team.me).map((p) => <button key={p.id} type="button" aria-pressed={viewers.includes(p.id)} className={viewers.includes(p.id) ? 'on' : ''} data-testid="viewer-pill" onClick={() => toggleIn(viewers, setViewers, p.id)}>{p.name.split(' ')[0]}</button>)}
            </div>
          )}
          <span className="tk-hint">{visibility === 'team' ? 'Everyone in this team sees it on the board and in lists.' : visibility === 'me' ? 'Only you and the people assigned to it.' : 'You, the people assigned, and the people picked here.'}</span>
        </section>
      )}

      {team.canAssign && startStatus !== 'done' && (
        <section className="s-sheet-sec" aria-label="Status">
          <span className="s-sheet-lab">Status</span>
          <div className="s-sheet-pills" role="radiogroup" aria-label="Status">
            {[['todo', 'To do'], ['doing', 'In progress'], ['review', 'In review']].map(([v, name]) => (
              <button key={v} type="button" role="radio" aria-checked={status === v} className={status === v ? 'on' : ''} data-testid={`status-${v}`} onClick={() => setStatus(v)}>{name}</button>
            ))}
            <button type="button" aria-pressed={watching} className={`tk-watch ${watching ? 'on' : ''}`} data-testid="task-watch" onClick={() => setWatching(!watching)}>{watching ? 'Watching' : 'Watch this task'}</button>
          </div>
        </section>
      )}

      {team.canAssign && !isNew && task.id && <TaskThread taskId={task.id} team={team} />}

      <section className="s-sheet-sec" aria-label="Estimate">
        <span className="s-sheet-lab">Estimate</span>
        <div className="s-sheet-pills" role="radiogroup" aria-label="Estimate">
          {ESTIMATES.map(([m, name]) => <button key={m} type="button" role="radio" aria-checked={estimate === m} className={estimate === m ? 'on' : ''} onClick={() => setEstimate(estimate === m ? null : m)}>{name}</button>)}
          <input type="number" min="1" max="1440" aria-label="Estimate in minutes" className="s-sheet-time" style={{ width: 96 }} placeholder="minutes" value={estimate && !ESTIMATES.some(([m]) => m === estimate) ? estimate : ''} onChange={(e) => setEstimate(e.target.value ? Number(e.target.value) : null)} />
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

      <section className="s-sheet-sec" aria-label="Steps"><TaskSteps steps={steps} onChange={setSteps} taskText={text} taskDetails={task.meta?.details || ''} /></section>

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
          <span className="s-sheet-pills">
            <button type="button" className="s-sheet-linkbtn" onClick={() => setPicking(true)}>+ Link a note</button>
            <button type="button" className="s-sheet-linkbtn" data-testid="note-from-task" disabled={!text.trim()} onClick={async () => {
              try {
                const r = await notesAPI.create({ title: text.trim(), content: '' });
                const n = r.data?.note || r.data;
                if (n?.id) { setNote({ id: n.id, title: n.title || text.trim() }); queryClient.invalidateQueries({ queryKey: ['notes'] }); }
              } catch (e) { setError(e.response?.data?.error || 'Could not create the note.'); }
            }}>+ Make a note for this task</button>
          </span>
        )}
      </section>


        </div>
      </div>

      {shareOpen && <ShareDialog kind="todo" id={task.id} title={text} onClose={() => setShareOpen(false)} />}
      {error && <p className="s-sheet-error" role="alert">{error}</p>}
      {confirmEsc && (
        <div className="s-sheet-confirm" role="alertdialog" aria-label="Unsaved changes">
          <b>You have unsaved changes.</b>
          <span className="grow" />
          <button type="button" autoFocus onClick={() => { document.getElementById('s-sheet-title')?.focus(); setConfirmEsc(false); }}>Keep editing</button>
          <button type="button" className="warn" onClick={onClose}>Discard</button>
        </div>
      )}
      <div className="s-sheet-foot">
        {!isNew && <button type="button" className="s-sheet-del" style={{ marginRight: 8 }} onClick={duplicate}><Copy size={13} /> Duplicate</button>}
        {!isNew && <button type="button" className="s-sheet-del" style={{ marginRight: 8 }} onClick={() => setShareOpen(true)}>Share</button>}
          {!isNew && <button type="button" className="s-sheet-del" onClick={remove}>Delete</button>}
        <span className="grow" />
        {!inline && <span className="s-sheet-keys"><kbd>Ctrl</kbd> <kbd>Enter</kbd> to save</span>}
        {isNew && <button type="button" className="s-sheet-skip" onClick={onClose}>Skip</button>}
        <button type="button" className="s-capture-add" disabled={!text.trim() || saving} onClick={save}>{saving ? 'Saving…' : isNew ? 'Done' : 'Save'}</button>
      </div>
    </div>
  );

  if (inline) return body;
  return (
    <div className="s-sheet-back" onMouseDown={(e) => { if (e.target === e.currentTarget) requestClose(); }}>
      {body}
    </div>
  );
}

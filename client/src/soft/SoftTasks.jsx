import { useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { X, Repeat, Target } from 'lucide-react';
import { todosAPI } from '../api';
import { parseTask } from '../utils/parseTask';
import { askScope } from '../utils/askScope';
import { useUndoToast, useDeferredDelete } from '../utils/useUndoToast';
import UndoToast from '../components/UndoToast';
import TaskSheet from './TaskSheet';
import { filterTasks, sortTasks, groupTasks, isOverdue, PRIORITY_LABEL, GROUP_OPTIONS, SORT_OPTIONS } from '../utils/taskView';
import './tasks2.css';
import { timeOf, dayChip, daysFromToday, weekdayLong, startOfDay, addDays, tagsOf } from './softUtils';

/** Soft Studio · Tasks (mockup: SoftTasks). A board of Today, Tomorrow, This week and Done. */
const SOFT_H = { whenOf: (t) => (t.deadline ? new Date(t.deadline) : null), tagsOf: (t) => tagsOf(t).map(String), isMeeting: () => false };

const ordinal = (n) => { const v = n % 100; return n + (['th', 'st', 'nd', 'rd'][(v - 20) % 10] || ['th', 'st', 'nd', 'rd'][v] || 'th'); };
/** "Every 1st", "Every weekday", "Every Friday" - what a repeating task says about itself. */
export function repeatLabel(t) {
  const r = t.recurrence;
  if (!r || r === 'none') return '';
  const d = t._ref || t.deadline ? new Date(t._ref || t.deadline) : null; // _ref: a later occurrence, so moving one date does not rename the rule
  if (r === 'daily') return 'Every day';
  if (r === 'weekdays') return 'Every weekday';
  if (r === 'weekly') return d ? `Every ${weekdayLong(d)}` : 'Every week';
  if (r === 'monthly') return d ? `Every ${ordinal(d.getDate())}` : 'Every month';
  if (r === 'yearly') return d ? `Every ${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}` : 'Every year';
  return '';
}
const SMART = [['all', 'All'], ['inbox', 'Inbox'], ['today', 'Today'], ['upcoming', 'Upcoming'], ['waiting', 'Waiting'], ['someday', 'Someday'], ['overdue', 'Overdue'], ['high', 'High priority']];
const VIEWS = [['board', 'Board'], ['list', 'List'], ['table', 'Table'], ['timeline', 'Timeline']];
const stepsOf = (t) => (Array.isArray(t.meta?.subtasks) ? t.meta.subtasks : []);

function StepsBar({ steps }) {
  const done = steps.filter((x) => x.done).length;
  return (
    <span className="s-steps" title={`${done} of ${steps.length} steps`}>
      <span className="bar"><i style={{ width: `${Math.round((done / steps.length) * 100)}%` }} /></span>
      <span className="n">{done} of {steps.length} steps</span>
    </span>
  );
}

function TaskTable({ rows, toggle, open }) {
  return (
    <div className="s-table-wrap">
      <table className="s-table" data-testid="task-table">
        <thead><tr><th scope="col"><span className="s-sr">Done</span></th><th scope="col">Task</th><th scope="col">Due</th><th scope="col">Repeat</th><th scope="col">Priority</th><th scope="col">Steps</th><th scope="col">Tags</th></tr></thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={7} className="s-empty small">Nothing here.</td></tr>}
          {rows.map((t) => (
            <tr key={t.id}>
              <td><input type="checkbox" className="s-check small" checked={!!t.completed} onChange={() => toggle(t)} aria-label={`Mark "${t.text}" done`} /></td>
              <td><button type="button" className="s-card-open t" onClick={() => open(t)}>{t.text}</button></td>
              <td>{t.deadline ? `${dayChip(t.deadline)}${timeOf(t) ? ` ${timeOf(t)}` : ''}` : '\u2014'}</td>
              <td>{repeatLabel(t) || '\u2014'}{t._later > 0 && <span className="s-mini later">+{t._later} later</span>}</td>
              <td>{t.priority === 'high' ? 'High' : t.priority === 'low' ? 'Low' : 'Normal'}</td>
              <td>{stepsOf(t).length ? `${stepsOf(t).filter((x) => x.done).length}/${stepsOf(t).length}` : '\u2014'}</td>
              <td>{tagsOf(t).map((g) => `#${g}`).join(' ') || '\u2014'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TaskTimeline({ groups, open }) {
  const days = Array.from({ length: 14 }, (_, i) => addDays(startOfDay(), i));
  const all = [...groups.overdue, ...groups.today, ...groups.tomorrow, ...groups.week, ...groups.later].filter((t) => t.deadline);
  return (
    <div className="s-timeline" data-testid="task-timeline">
      {days.map((d, i) => {
        const items = all.filter((t) => (i === 0 ? daysFromToday(t.deadline) <= 0 : daysFromToday(t.deadline) === i));
        return (
          <section key={i} className={`s-tl-day${i === 0 ? ' today' : ''}`}>
            <h2>{i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : weekdayLong(d)}<small>{d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</small></h2>
            {items.length === 0 && <p className="s-empty small">Free</p>}
            {items.map((t) => <button key={t.id} type="button" className="s-tl-item" onClick={() => open(t)}><b>{timeOf(t) || 'All day'}</b>{t.text}{repeatLabel(t) && <Repeat size={11} />}</button>)}
          </section>
        );
      })}
    </div>
  );
}

export default function SoftTasks() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [view, setView] = useState('board');
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const inputRef = useRef(null);
  const [sheet, setSheet] = useState(null); // { task, isNew }
  const [justAdded, setJustAdded] = useState(null); // the task just added with Enter, so the cursor can stay in the box
  const [dragId, setDragId] = useState(null);
  const [overCol, setOverCol] = useState(null);

  const { data: todos = [] } = useQuery({ queryKey: ['todos', 'all'], queryFn: () => todosAPI.getAll().then((r) => r.data.todos || []) });

  const { toast, say, dismiss } = useUndoToast();
  const { gone, schedule } = useDeferredDelete(async (id) => { await todosAPI.delete(id, 'this'); refresh(); });
  const [q, setQ] = useState('');
  const [pill, setPill] = useState('all');
  const [lg, setLg] = useState('when');
  const [ls, setLs] = useState('due');
  // A repeating task shows once (its next open date) with "+N later", not as 60 copies.
  const collapsed = useMemo(() => {
    const open = new Map();
    for (const t of todos) if (t.seriesId && !t.completed) { const a = open.get(t.seriesId) || []; a.push(t); open.set(t.seriesId, a); }
    const first = new Map();
    for (const [id, a] of open) { a.sort((x, y) => new Date(x.deadline || 8.64e15) - new Date(y.deadline || 8.64e15)); first.set(id, a[0].id); }
    return todos.filter((t) => t.completed || !t.seriesId || first.get(t.seriesId) === t.id).map((t) => (t.seriesId && !t.completed ? { ...t, _later: open.get(t.seriesId).length - 1, _ref: open.get(t.seriesId).at(-1).deadline } : t));
  }, [todos]);
  const inView = (t, key) => {
    const tg = tagsOf(t).map(String);
    const d = t.deadline ? daysFromToday(t.deadline) : null;
    if (key === 'high') return t.priority === 'high';
    if (key === 'overdue') return isOverdue(t, SOFT_H);
    if (key === 'inbox') return d === null && !tg.includes('someday') && !tg.includes('waiting');
    if (key === 'today') return d !== null && d <= 0;
    if (key === 'upcoming') return d !== null && d >= 1;
    if (key === 'waiting') return tg.includes('waiting');
    if (key === 'someday') return tg.includes('someday');
    return true;
  };
  const smartCounts = useMemo(() => Object.fromEntries(SMART.map(([k]) => [k, collapsed.filter((t) => !t.completed && inView(t, k)).length])), [collapsed]);
  const base = useMemo(() => {
    const found = filterTasks(collapsed, { show: 'all', q }, SOFT_H);
    return found.filter((t) => t.completed || inView(t, pill));
  }, [collapsed, q, pill]);
  const groups = useMemo(() => {
  const open = base.filter((t) => !t.completed && !gone.includes(t.id));
    const rank = { high: 0, medium: 1, low: 2 };
    // Important first, then by time (the mockup lists the !high task before earlier ones)
    const byDue = (a, b) => (rank[a.priority] ?? 1) - (rank[b.priority] ?? 1) || new Date(a.deadline || 8.64e15) - new Date(b.deadline || 8.64e15);
    const overdue = open.filter((t) => t.deadline && daysFromToday(t.deadline) < 0).sort((a, b) => new Date(a.deadline) - new Date(b.deadline));
    const today = open.filter((t) => t.deadline && daysFromToday(t.deadline) === 0).sort(byDue);
    const tomorrow = open.filter((t) => t.deadline && daysFromToday(t.deadline) === 1).sort(byDue);
    const week = open.filter((t) => t.deadline && daysFromToday(t.deadline) >= 2 && daysFromToday(t.deadline) <= 6).sort((a, b) => new Date(a.deadline) - new Date(b.deadline));
    const later = open.filter((t) => !t.deadline || daysFromToday(t.deadline) > 6).sort((a, b) => new Date(a.deadline || 8.64e15) - new Date(b.deadline || 8.64e15));
    const weekAgo = addDays(startOfDay(), -6);
    const done = base.filter((t) => t.completed && !gone.includes(t.id) && new Date(t.updatedAt) >= weekAgo).sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    return { overdue, today, tomorrow, week, later, done, open };
  }, [base, gone]);
  const otherGroups = useMemo(() => (lg === 'when' ? [] : groupTasks(sortTasks(groups.open, ls, SOFT_H), lg, SOFT_H)), [groups.open, lg, ls]);

  const subtitle = [
    `${groups.open.length} to do`,
    `${groups.done.length} done this week`,
    groups.overdue.length === 1
      ? `one from ${daysFromToday(groups.overdue[0].deadline) === -1 ? 'yesterday' : weekdayLong(groups.overdue[0].deadline)} still waiting`
      : groups.overdue.length > 1 ? `${groups.overdue.length} from earlier still waiting` : null,
  ].filter(Boolean).join(' · ');

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['todos'] });
    queryClient.invalidateQueries({ queryKey: ['dashboard'] });
  };
  const setDone = async (t, completed) => {
    setErr('');
    queryClient.setQueryData(['todos', 'all'], (old) => (old || []).map((x) => (x.id === t.id ? { ...x, completed, updatedAt: new Date().toISOString() } : x)));
    try {
      await todosAPI.update(t.id, { completed });
    } catch {
      queryClient.setQueryData(['todos', 'all'], (old) => (old || []).map((x) => (x.id === t.id ? { ...x, completed: !completed } : x)));
      setErr('Could not update that task. Please try again.');
      return false;
    }
    refresh();
    return true;
  };
  const toggle = async (t) => {
    const next = !t.completed;
    if (!(await setDone(t, next))) return;
    say(next ? 'Marked done' : 'Marked not done', () => setDone(t, !next));
  };
  const remove = async (t) => {
    if (t.seriesId) { // a repeating task asks which ones, so that stays a direct question
      const scope = await askScope(t, 'delete');
      if (!scope) return;
      try { await todosAPI.delete(t.id, scope); } catch { setErr('Could not delete that task. Please try again.'); return; }
      refresh();
      return;
    }
    schedule(t.id, t.text, say); // goes away at once, really deleted after the undo time
  };

  const parsed = draft.trim() ? parseTask(draft) : null;
  const add = async (e) => {
    e.preventDefault();
    if (!parsed || saving) return;
    setSaving(true);
    setErr('');
    try {
      let when = parsed.deadline;
      if (!when && parsed.recurrence !== 'none') { when = new Date(); when.setHours(9, 0, 0, 0); if (when < new Date()) when.setDate(when.getDate() + 1); }
      const { data } = await todosAPI.create({ text: parsed.text || draft.trim(), priority: parsed.priority, tags: parsed.tags, deadline: when ? when.toISOString() : null, ...(parsed.recurrence !== 'none' ? { recurrence: parsed.recurrence } : {}) });
      setDraft('');
      refresh();
      const made = data.todo || data.todos?.[0] || null;
      setJustAdded(made ? { task: made, label: parsed.text || made.text } : null);
      inputRef.current?.focus();
    } catch {
      setErr('Could not add the task. Your text is kept, please try again.');
    } finally {
      setSaving(false);
    }
  };

  const moveTo = async (id, col) => {
    const t = todos.find((x) => x.id === id);
    if (!t || t.completed) return;
    if (col === 'done') { toggle(t); return; }
    const days = col === 'today' ? 0 : col === 'tomorrow' ? 1 : 2;
    const old = t.deadline;
    const d = addDays(startOfDay(), days);
    const prev = old ? new Date(old) : null;
    d.setHours(prev ? prev.getHours() : 9, prev ? prev.getMinutes() : 0, 0, 0);
    const put = (deadline) => todosAPI.update(id, { deadline, scope: 'this' }).then(refresh);
    queryClient.setQueryData(['todos', 'all'], (o) => (o || []).map((x) => (x.id === id ? { ...x, deadline: d.toISOString() } : x)));
    try { await put(d.toISOString()); } catch { setErr('Could not move that task.'); refresh(); return; }
    say(`Moved to ${col === 'week' ? dayChip(d) : col === 'today' ? 'Today' : 'Tomorrow'}`, () => put(old));
  };
  const dropProps = (key) => ({
    onDragOver: (e) => { if (dragId) { e.preventDefault(); setOverCol(key); } },
    onDragLeave: () => setOverCol((c) => (c === key ? null : c)),
    onDrop: (e) => { e.preventDefault(); const id = e.dataTransfer.getData('text/plain') || dragId; setOverCol(null); setDragId(null); if (id) moveTo(id, key); },
  });

  const chipsFor = (t, column) => {
    const out = [];
    const days = t.deadline ? daysFromToday(t.deadline) : null;
    if (days !== null && days < 0) out.push({ label: `From ${days === -1 ? 'yesterday' : weekdayLong(t.deadline)}`, kind: 'late' });
    else if (t.deadline && (column === 'today' || column === 'tomorrow')) { if (timeOf(t)) out.push({ label: timeOf(t) }); }
    else if (t.deadline && column !== 'done') out.push({ label: `${dayChip(t.deadline)}${timeOf(t) ? ` ${timeOf(t)}` : ''}` });
    else if (column === 'done') out.push({ label: dayChip(t.updatedAt) });
    if (t.priority === 'high' && column !== 'done') out.push({ label: 'High', kind: 'high' });
    const rl = repeatLabel(t);
    if (rl && column !== 'done') out.push({ label: rl, kind: 'repeat' });
    if (t._later > 0 && column !== 'done') out.push({ label: `+${t._later} later`, kind: 'later' });
    for (const tag of tagsOf(t).slice(0, 2)) out.push({ label: `#${tag}` });
    return out;
  };

  const card = (t, column) => (
    <div key={t.id} className={`s-card${t.completed ? ' done' : ''}${dragId === t.id ? ' dragging' : ''}`} data-testid="task-card" draggable onDragStart={(e) => { e.dataTransfer.setData('text/plain', t.id); e.dataTransfer.effectAllowed = 'move'; setDragId(t.id); }} onDragEnd={() => { setDragId(null); setOverCol(null); }}>
      <input type="checkbox" className="s-check small" checked={!!t.completed} onChange={() => toggle(t)} aria-label={`Mark "${t.text}" ${t.completed ? 'not done' : 'done'}`} />
      <div className="s-card-body">
        <button type="button" className="t s-card-open" onClick={() => setSheet({ task: t, isNew: false })}>{t.text}</button>
        <span className="s-card-chips">
          {chipsFor(t, column).map((c) => <span key={c.label} className={`s-mini ${c.kind || ''}`}>{c.kind === 'repeat' && <Repeat size={11} />}{c.label}</span>)}
          {stepsOf(t).length > 0 && <StepsBar steps={stepsOf(t)} />}
          {t.note && <Link to={`/notes/${t.note.id}`} className="s-mini note">{t.note.title || 'Note'}</Link>}
        </span>
      </div>
      {!t.completed && <Link to={`/tasks/focus/${t.id}`} className="s-card-x focus" aria-label={`Focus on "${t.text}"`} title="Focus on this task"><Target size={14} strokeWidth={2.4} /></Link>}
      <button type="button" className="s-card-x" aria-label={`Delete "${t.text}"`} onClick={() => remove(t)}><X size={14} strokeWidth={2.4} /></button>
    </div>
  );

  const columns = [
    { key: 'today', title: 'Today', tone: 'peach', items: [...groups.overdue, ...groups.today] },
    { key: 'tomorrow', title: 'Tomorrow', tone: 'mint', items: groups.tomorrow },
    { key: 'week', title: 'This week', tone: 'lilac', items: groups.week, extra: groups.later },
    { key: 'done', title: 'Done', tone: 'butter', items: groups.done.slice(0, 12) },
  ];

  return (
    <div className="soft-page s-tasks">
      <div className="s-page-head">
        <div className="s-page-title">
          <h1 className="s-h1">Tasks</h1>
          <span className="s-sub">{subtitle}</span>
        </div>
        <span className="grow" />
        <div className="s-seg" role="tablist" aria-label="View">
          {VIEWS.map(([k, name]) => <button key={k} type="button" role="tab" aria-selected={view === k} className={view === k ? 'on' : ''} onClick={() => setView(k)}>{name}</button>)}
        </div>
      </div>

      <form className="s-addbar" onSubmit={add}>
        <label htmlFor="task-add" className="s-sr">Add a task</label>
        <input id="task-add" ref={inputRef} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder='Add a task… try "revise BCNF tomorrow !high #exams"' autoComplete="off" />
        <button type="submit" className="s-accent-btn" disabled={!parsed || saving}>Add</button>
      </form>
      {parsed ? (
        <div className="s-understood" aria-live="polite" data-testid="understood">
          <span className="lead">Understood</span>
          <b className="what">{parsed.text || draft.trim()}</b>
          {parsed.recurrence !== 'none' && <span className="s-mini"><Repeat size={11} /> {repeatLabel({ recurrence: parsed.recurrence, deadline: parsed.deadline })}</span>}
          {parsed.deadline && <span className="s-mini">Next: {dayChip(parsed.deadline)}{parsed.allDay ? '' : ` ${timeOf({ deadline: parsed.deadline })}`}</span>}
          {parsed.priority !== 'medium' && <span className="s-mini high">{parsed.priority === 'high' ? 'High' : 'Low'}</span>}
          {parsed.tags.map((t) => <span key={t} className="s-mini">#{t}</span>)}
          <span className="grow" />
          <kbd>Enter</kbd><span className="hint">adds it and keeps the cursor here</span>
        </div>
      ) : justAdded ? (
        <div className="s-understood added" data-testid="just-added">
          <span className="lead ok">Added</span>
          <b className="what">{justAdded.label}</b>
          <span className="grow" />
          <button type="button" className="s-linkbtn" onClick={() => { setSheet({ task: justAdded.task, isNew: true }); setJustAdded(null); }}>Add details</button>
        </div>
      ) : null}
      {err && <p className="s-empty small" role="alert" style={{ margin: '4px 0' }}>{err}</p>}

      <div className="s-tasktools">
        <label htmlFor="s-task-search" className="s-sr">Search tasks</label>
        <input id="s-task-search" type="search" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setQ('')} placeholder="Search tasks and tags…" />
        <div className="s-filter" role="tablist" aria-label="Filter tasks">
          {SMART.map(([k, name]) => (
            <button key={k} type="button" role="tab" aria-selected={pill === k} className={pill === k ? 'on' : ''} onClick={() => setPill(k)}>{name}{k !== 'all' && <span className="s-pcount">{smartCounts[k]}</span>}</button>
          ))}
        </div>
        {view === 'list' && (
          <>
            <label className="s-tt-sel">Group <select value={lg} onChange={(e) => setLg(e.target.value)} aria-label="Group tasks by">{GROUP_OPTIONS.map(([k, n]) => <option key={k} value={k === 'due' ? 'when' : k}>{n}</option>)}</select></label>
            {lg !== 'when' && <label className="s-tt-sel">Sort <select value={ls} onChange={(e) => setLs(e.target.value)} aria-label="Sort tasks by">{SORT_OPTIONS.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select></label>}
          </>
        )}
      </div>

      {view === 'table' ? <TaskTable rows={[...groups.overdue, ...groups.today, ...groups.tomorrow, ...groups.week, ...groups.later]} toggle={toggle} open={(t) => setSheet({ task: t, isNew: false })} /> : view === 'timeline' ? <TaskTimeline groups={groups} open={(t) => setSheet({ task: t, isNew: false })} /> : view === 'board' ? (
        <div className="s-board">
          {columns.map((c) => (
            <section key={c.key} data-col={c.key} className={`s-col${overCol === c.key ? ' over' : ''}`} style={{ background: `var(--s-${c.tone})` }} aria-labelledby={`s-col-${c.key}`} {...dropProps(c.key)}>
              <div className="s-col-head">
                <h2 id={`s-col-${c.key}`} className="s-col-title">{c.title}</h2>
                <span className="s-col-count">{c.items.length + (c.extra?.length || 0)}</span>
              </div>
              <div className="s-col-cards">
                {c.items.length === 0 && !c.extra?.length && <p className="s-empty small" style={{ padding: '0 4px' }}>{c.key === 'done' ? 'Finished tasks land here.' : 'Nothing here.'}</p>}
                {c.items.map((t) => card(t, c.key))}
                {c.extra?.length > 0 && (
                  <>
                    <span className="s-col-divider">Later</span>
                    {c.extra.map((t) => card(t, 'later'))}
                  </>
                )}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <div className="s-list">
          {lg !== 'when' && otherGroups.map((g) => (
            <section key={g.key} className="s-list-group">
              <h2 className="s-col-title">{g.label} <span className="s-col-count">{g.items.length}</span></h2>
              {g.items.map((t) => card(t, g.key))}
            </section>
          ))}
          {lg === 'when' && columns.filter((c) => c.items.length || c.extra?.length).map((c) => (
            <section key={c.key} className="s-list-group">
              <h2 className="s-col-title"><span className="blob" style={{ background: `var(--s-${c.tone})` }} aria-hidden="true" />{c.title}</h2>
              {c.items.map((t) => card(t, c.key))}
              {c.extra?.map((t) => card(t, 'later'))}
            </section>
          ))}
        </div>
      )}
      {sheet && <TaskSheet task={sheet.task} isNew={sheet.isNew} onClose={() => { setSheet(null); inputRef.current?.focus(); }} />}
      <UndoToast toast={toast} dismiss={dismiss} />
    </div>
  );
}

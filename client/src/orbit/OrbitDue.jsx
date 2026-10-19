import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Network, Trash2, ChevronLeft, ChevronRight, CalendarClock, Pencil, ListChecks } from 'lucide-react';
import { todosAPI } from '../api';
import { parseTask } from '../utils/parseTask';
import { askScope } from '../utils/askScope';
import { useOrbit } from './OrbitShell';
import { useAuth } from '../context/AuthContext';
import { orbitPrefs } from './orbitPrefs';
import { TaskExportMenu } from './OrbitExport';
import OrbitToday, { TimeReport } from './OrbitToday';
import { TaskDetail, Board, Assignments, DoneLog, NextCard } from './OrbitTaskExtras';
import { LABELS, LABEL_HEX, DAY_LIMIT_MIN, metaOf, subProgress, isBlocked, blockersOf, plannedMinutes, minutesLabel, parseDateShortcut } from './taskMeta';
import { topicName, levelOf, levelVar, tagsOfTodo, shortDate } from './orbitUtils';
import { startOfDay, addDays, sameDay, dayWord, clock, isAllDay, momentOf, mondayOf } from '../river/riverUtils';

const UNDO_MS = 6000;
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const RANK = { high: 0, medium: 1, low: 2 };
const pad = (n) => String(n).padStart(2, '0');
const dateValue = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** The same time of day on another day (a task with no date becomes an all-day task). */
const withDay = (t, day) => {
  const d = startOfDay(day);
  const old = t.deadline ? new Date(t.deadline) : null;
  if (old) d.setHours(old.getHours(), old.getMinutes(), 0, 0); else d.setHours(23, 59, 0, 0);
  return d;
};

/** Orbit · Due: tasks as a list (Tasks) or as a week (Calendar), on a sheet over the map. */
export default function OrbitDue({ view: initialView = 'list' }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { todos, mastery, space } = useOrbit();
  const goal = Number(orbitPrefs(useAuth().settings).goal) || 0;
  const [view, setView] = useState(initialView);
  const [text, setText] = useState('');
  const [err, setErr] = useState('');
  const [week, setWeek] = useState(() => mondayOf(new Date()));
  const today = startOfDay();
  const sheet = useRef(null);
  // PEB-122: a ticked task stays where it is (light and struck through) unless "Hide completed" is on
  const [hideDone, setHideDone] = useState(() => { try { return localStorage.getItem('peblo-orbit-hide-done') === '1'; } catch { return false; } });
  const setHide = (v) => { setHideDone(v); try { localStorage.setItem('peblo-orbit-hide-done', v ? '1' : '0'); } catch { /* ignore */ } };
  // PEB-136/137: filters and sort
  const [fTopic, setFTopic] = useState('');
  const [fPrio, setFPrio] = useState('');
  const [onlyOver, setOnlyOver] = useState(false);
  const [sortBy, setSortBy] = useState('time');
  const [overOpen, setOverOpen] = useState(true);
  const [editId, setEditId] = useState(null);
  const [menuId, setMenuId] = useState(null);
  const [draft, setDraft] = useState(null);
  // Round 5: task details, labels, bulk edit, board, assignments, done log, "what next"
  const [openId, setOpenId] = useState(null);
  const [fLabel, setFLabel] = useState('');
  const [selMode, setSelMode] = useState(false);
  const [sel, setSel] = useState([]);
  const [confirmDel, setConfirmDel] = useState(false);
  const [showNext, setShowNext] = useState(false);
  const [showWords, setShowWords] = useState(false);
  const [doneDays, setDoneDaysState] = useState(() => { try { const v = localStorage.getItem('peblo-orbit-done-days'); return v === null ? 7 : Number(v); } catch { return 7; } });
  const setDoneDays = (v) => { setDoneDaysState(v); try { localStorage.setItem('peblo-orbit-done-days', String(v)); } catch { /* ignore */ } };
  // PEB-123: a short "Undo" after ticking, deleting or moving a task
  const [toast, setToast] = useState(null); // { msg, undo }
  const toastTimer = useRef(null);
  const [gone, setGone] = useState([]); // ids deleted on screen, still waiting out the undo time
  const pending = useRef(new Map()); // id -> { timer, run }
  const say = (msg, undo) => {
    clearTimeout(toastTimer.current);
    setToast({ msg, undo });
    toastTimer.current = setTimeout(() => setToast(null), UNDO_MS);
  };
  // leaving the screen makes any delete that is still waiting go through now
  useEffect(() => () => { clearTimeout(toastTimer.current); for (const p of pending.current.values()) { clearTimeout(p.timer); p.run(); } }, []);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['todos'] });
    queryClient.invalidateQueries({ queryKey: ['dashboard'] });
  };
  // Every call shows a message on failure and refetches, so the screen never keeps a change the server refused
  const run = async (fn, failMsg) => {
    setErr('');
    try { await fn(); return true; } catch (e) { setErr(e.response?.data?.error || failMsg); return false; } finally { refresh(); }
  };
  const setDone = (t, completed) => run(async () => {
    queryClient.setQueryData(['todos', 'orbit-all'], (old) => (old || []).map((x) => (x.id === t.id ? { ...x, completed } : x)));
    await todosAPI.update(t.id, { completed });
  }, 'Could not update that task.');
  const toggle = (t) => {
    const next = !t.completed;
    setDone(t, next);
    say(next ? 'Marked done' : 'Marked not done', () => setDone(t, !next));
  };
  const remove = async (t) => {
    if (t.seriesId) { // a repeating task asks which ones, so that stays a direct question
      const scope = await askScope(t, 'delete');
      if (scope) await run(() => todosAPI.delete(t.id, scope), 'Could not delete that task.');
      return;
    }
    // any other task goes away on screen at once and is really deleted after the undo time
    setGone((g) => [...g, t.id]);
    const finish = () => { pending.current.delete(t.id); return run(() => todosAPI.delete(t.id, 'this'), 'Could not delete that task.').then(() => setGone((g) => g.filter((x) => x !== t.id))); };
    pending.current.set(t.id, { timer: setTimeout(finish, UNDO_MS), run: finish });
    say('Deleted "' + (t.text.length > 40 ? t.text.slice(0, 40) + '…' : t.text) + '"', () => {
      const p = pending.current.get(t.id);
      if (p) { clearTimeout(p.timer); pending.current.delete(t.id); }
      setGone((g) => g.filter((x) => x !== t.id));
    });
  };

  // PEB-139/138: move one task, or every overdue one, to another day
  const reschedule = async (t, day, label) => {
    const prev = t.deadline || null;
    setMenuId(null);
    if (await run(() => todosAPI.update(t.id, { deadline: withDay(t, day).toISOString() }), 'Could not move that task.')) {
      say(`Moved to ${label}`, () => run(() => todosAPI.update(t.id, { deadline: prev }), 'Could not undo that.'));
    }
  };
  const moveOverdue = async (day, label) => {
    const items = todos.filter((t) => !t.completed && t.deadline && startOfDay(t.deadline) < today && !gone.includes(t.id));
    if (!items.length) return;
    const prev = items.map((t) => [t.id, t.deadline]);
    if (await run(() => Promise.all(items.map((t) => todosAPI.update(t.id, { deadline: withDay(t, day).toISOString() }))), 'Could not move the overdue tasks.')) {
      say(`Moved ${items.length} overdue task${items.length === 1 ? '' : 's'} to ${label}`, () => run(() => Promise.all(prev.map(([id, d]) => todosAPI.update(id, { deadline: d }))), 'Could not undo that.'));
    }
  };

  // Round 5: extra details (task.meta), board columns, assignments, bulk edit
  const setMeta = (t, patch) => run(() => todosAPI.update(t.id, { meta: patch }), 'Could not save that.');
  // Round 8: focus timer that logs minutes on the task (meta.spentMin)
  const [focus, setFocus] = useState(null); // { task, startedAt, mins }
  const [, setTick] = useState(0);
  const stopFocus = async () => {
    if (!focus) return;
    const f = focus;
    setFocus(null);
    const mins = Math.min(f.mins, Math.round((Date.now() - f.startedAt) / 60000));
    if (mins < 1) { say('Focus stopped. Under a minute, so nothing was logged.'); return; }
    const cur = todos.find((x) => x.id === f.task.id) || f.task;
    if (await setMeta(cur, { spentMin: (metaOf(cur).spentMin || 0) + mins })) say(`Logged ${mins} min on "${f.task.text.length > 30 ? f.task.text.slice(0, 30) + '…' : f.task.text}"`);
  };
  const startFocus = (t) => { setFocus({ task: t, startedAt: Date.now(), mins: 25 }); setOpenId(null); };
  useEffect(() => {
    if (!focus) return undefined;
    const i = setInterval(() => { setTick((n) => n + 1); if (Date.now() >= focus.startedAt + focus.mins * 60000) stopFocus(); }, 1000);
    return () => clearInterval(i);
  }, [focus]); // eslint-disable-line react-hooks/exhaustive-deps
  const focusLeft = focus ? Math.max(0, focus.startedAt + focus.mins * 60000 - Date.now()) : 0;
  const COLS = { todo: 'To do', doing: 'Doing', done: 'Done' };
  const applyCol = (t, col) => todosAPI.update(t.id, col === 'done' ? { completed: true, meta: { status: null } } : { completed: false, meta: { status: col === 'doing' ? 'doing' : null } });
  const moveCol = async (t, col) => {
    const was = t.completed ? 'done' : metaOf(t).status === 'doing' ? 'doing' : 'todo';
    if (await run(() => applyCol(t, col), 'Could not move that task.')) say(`Moved to ${COLS[col]}`, () => run(() => applyCol(t, was), 'Could not undo that.'));
  };
  const setAStatus = (t, v) => run(() => todosAPI.update(t.id, { completed: v === 'submitted', meta: { astatus: v === 'submitted' ? 'submitted' : v } }), 'Could not update that assignment.');
  const restore = (t) => run(() => todosAPI.update(t.id, { completed: false }), 'Could not bring that back.');
  const selItems = todos.filter((t) => sel.includes(t.id) && !gone.includes(t.id));
  const endSelect = () => { setSelMode(false); setSel([]); setConfirmDel(false); };
  const bulkDone = async () => {
    const items = selItems.filter((t) => !t.completed);
    if (!items.length) return;
    if (await run(() => Promise.all(items.map((t) => todosAPI.update(t.id, { completed: true }))), 'Could not update those tasks.')) {
      say(`Marked ${items.length} done`, () => run(() => Promise.all(items.map((t) => todosAPI.update(t.id, { completed: false }))), 'Could not undo that.'));
      setSel([]);
    }
  };
  const bulkMove = async (day, label) => {
    const items = selItems.filter((t) => !t.completed);
    if (!items.length) return;
    const prev = items.map((t) => [t.id, t.deadline || null]);
    if (await run(() => Promise.all(items.map((t) => todosAPI.update(t.id, { deadline: withDay(t, day).toISOString() }))), 'Could not move those tasks.')) {
      say(`Moved ${items.length} to ${label}`, () => run(() => Promise.all(prev.map(([id, d]) => todosAPI.update(id, { deadline: d }))), 'Could not undo that.'));
      setSel([]);
    }
  };
  const bulkPrio = async (priority) => {
    const items = selItems;
    if (!items.length) return;
    const prev = items.map((t) => [t.id, t.priority || 'medium']);
    if (await run(() => Promise.all(items.map((t) => todosAPI.update(t.id, { priority }))), 'Could not change those tasks.')) {
      say(`Set ${items.length} to ${priority} priority`, () => run(() => Promise.all(prev.map(([id, p]) => todosAPI.update(id, { priority: p }))), 'Could not undo that.'));
    }
  };
  const bulkLabel = async (label) => {
    const items = selItems;
    if (!items.length) return;
    const prev = items.map((t) => [t.id, metaOf(t).label || null]);
    if (await run(() => Promise.all(items.map((t) => todosAPI.update(t.id, { meta: { label } }))), 'Could not label those tasks.')) {
      say(label ? `Labelled ${items.length} ${label}` : `Cleared the label on ${items.length}`, () => run(() => Promise.all(prev.map(([id, l]) => todosAPI.update(id, { meta: { label: l } }))), 'Could not undo that.'));
    }
  };
  const bulkDelete = async () => {
    const items = selItems;
    if (!confirmDel) { setConfirmDel(true); return; }
    if (await run(() => Promise.all(items.map((t) => todosAPI.delete(t.id, 'this'))), 'Could not delete those tasks.')) { say(`Deleted ${items.length} tasks`); endSelect(); }
  };

  // PEB-140: edit a task in place
  const startEdit = (t) => {
    const d = t.deadline ? new Date(t.deadline) : null;
    setMenuId(null);
    setEditId(t.id);
    setDraft({
      text: t.text,
      date: d ? dateValue(d) : '',
      time: d && !isAllDay(t) ? `${pad(d.getHours())}:${pad(d.getMinutes())}` : '',
      priority: t.priority || 'medium',
      topic: tagsOfTodo(t)[0] || '',
    });
  };
  const saveEdit = async (t) => {
    if (!draft.text.trim()) return;
    const scope = t.seriesId ? await askScope(t, 'edit') : 'this';
    if (!scope) return;
    const body = { text: draft.text.trim(), priority: draft.priority, scope };
    if (draft.date) {
      const [y, m, d] = draft.date.split('-').map(Number);
      const [hh, mm] = draft.time ? draft.time.split(':').map(Number) : [23, 59];
      body.deadline = new Date(y, m - 1, d, hh, mm, 0, 0).toISOString();
      if (t.startTime) body.startTime = draft.time || null;
    } else {
      body.deadline = null;
    }
    const old = tagsOfTodo(t);
    const rest = old.filter((x) => x !== old[0] && x !== draft.topic);
    body.tags = draft.topic ? [draft.topic, ...rest] : rest;
    if (await run(() => todosAPI.update(t.id, body), 'Could not save that task.')) setEditId(null);
  };

  const add = async (e) => {
    e.preventDefault();
    const raw = text.trim();
    if (!raw) return;
    const p = parseTask(raw);
    const deadline = p.deadline ? new Date(p.deadline) : null;
    const tags = [...new Set([...(space ? [space] : []), ...p.tags])];
    await run(async () => {
      await todosAPI.create({ text: p.text || raw, priority: p.priority, tags, deadline: deadline ? deadline.toISOString() : null });
      setText('');
    }, 'Could not add the task. Your text is still here, try again.');
  };

  const allTopics = useMemo(() => [...new Set(todos.flatMap(tagsOfTodo))].sort(), [todos]);
  const filtering = !!fTopic || !!fPrio || onlyOver || !!fLabel;
  const pv = text.trim() ? parseTask(text.trim()) : null;
  const pvBits = pv ? [pv.deadline ? shortDate(pv.deadline) + (isAllDay({ deadline: pv.deadline }) ? '' : ` · ${clock(pv.deadline)}`) : '', pv.priority === 'high' || pv.priority === 'low' ? `${pv.priority} priority` : '', ...pv.tags.map((x) => `#${x}`)].filter(Boolean) : [];
  const HINTS = ['Lab 6 file thursday #sql-joins', 'Read chapter 4 tomorrow 6pm', 'Revise normal forms !high next friday', 'Submit assignment 2026-11-02 #dbms'];
  const sortItems = (items) => {
    if (sortBy === 'priority') return [...items].sort((a, b) => (RANK[a.priority] ?? 1) - (RANK[b.priority] ?? 1) || new Date(a.deadline || 8.64e15) - new Date(b.deadline || 8.64e15));
    if (sortBy === 'topic') return [...items].sort((a, b) => (tagsOfTodo(a)[0] || '~').localeCompare(tagsOfTodo(b)[0] || '~') || new Date(a.deadline || 8.64e15) - new Date(b.deadline || 8.64e15));
    return items;
  };

  const groups = useMemo(() => {
    // done tasks stay (struck through) so you can check them; overdue ones that were due over two weeks ago are history
    const list = todos
      .filter((t) => !gone.includes(t.id) && (!t.completed || (!hideDone && (!t.deadline || doneDays === 0 || startOfDay(t.deadline) >= addDays(today, -doneDays)))))
      .filter((t) => !fTopic || tagsOfTodo(t).includes(fTopic))
      .filter((t) => !fPrio || (t.priority || 'medium') === fPrio)
      .filter((t) => !fLabel || metaOf(t).label === fLabel)
      .filter((t) => !onlyOver || (!t.completed && t.deadline && startOfDay(t.deadline) < today));
    const g = [];
    const push = (key, label, items, hot) => { if (items.length) g.push({ key, label, items: sortItems(items), hot: hot && items.some((t) => !t.completed) }); };
    const dated = list.filter((t) => t.deadline).sort((a, b) => new Date(a.deadline) - new Date(b.deadline));
    push('over', 'Overdue', dated.filter((t) => startOfDay(t.deadline) < today), true);
    for (let i = 0; i < 21; i++) {
      const d = addDays(today, i);
      push(`d${i}`, i < 2 ? dayWord(d) : `${DOW[d.getDay()]} ${d.getDate()} ${d.toLocaleDateString('en-GB', { month: 'short' })}`, dated.filter((t) => sameDay(t.deadline, d)), false);
    }
    push('later', 'Later', dated.filter((t) => startOfDay(t.deadline) >= addDays(today, 21)), false);
    push('none', 'No date', list.filter((t) => !t.deadline), false);
    return g;
  }, [todos, gone, hideDone, fTopic, fPrio, fLabel, onlyOver, sortBy, doneDays, today.getTime()]); // eslint-disable-line react-hooks/exhaustive-deps

  const live = todos.filter((t) => !gone.includes(t.id));
  const doneCount = live.filter((t) => t.completed).length;
  const overdueCount = live.filter((t) => !t.completed && t.deadline && startOfDay(t.deadline) < today).length;
  const dueToday = live.filter((t) => !t.completed && t.deadline && sameDay(t.deadline, today)).length;
  const todayAll = live.filter((t) => t.deadline && sameDay(t.deadline, today));
  const todayDone = todayAll.filter((t) => t.completed).length;

  const days = Array.from({ length: 7 }, (_, i) => addDays(week, i));
  const timeOf = (t) => (t.startTime ? clock(momentOf(t)) : isAllDay(t) ? '' : clock(t.deadline));
  const whenOf = (t) => (t.deadline ? `${shortDate(t.deadline)}${timeOf(t) ? ` · ${timeOf(t)}` : ''}` : '');

  const back = () => navigate('/');

  // PEB-146: Space ticks, E edits, Delete removes, arrows move between tasks
  const onRowKey = (e, t) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === ' ') { e.preventDefault(); toggle(t); }
    else if (e.key === 'e' || e.key === 'E') { e.preventDefault(); startEdit(t); }
    else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); remove(t); }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const rows = [...sheet.current.querySelectorAll('.o-task[tabindex]')];
      const at = rows.indexOf(e.currentTarget) + (e.key === 'ArrowDown' ? 1 : -1);
      rows[Math.max(0, Math.min(rows.length - 1, at))]?.focus();
    }
  };

  const taskRow = (t) => {
    const tag = tagsOfTodo(t)[0];
    const editing = editId === t.id && draft;
    const m = metaOf(t);
    const blocked = isBlocked(t, todos);
    const sp = subProgress(t);
    return (
      <div key={t.id} className="o-task-wrap">
        <div className={`o-task${t.completed ? ' done' : ''}`} tabIndex={0} data-id={t.id} onKeyDown={(e) => onRowKey(e, t)} aria-label={`${t.text}. Space to tick, E to edit, Delete to remove.`}>
          {selMode
            ? <input type="checkbox" checked={sel.includes(t.id)} onChange={() => setSel(sel.includes(t.id) ? sel.filter((x) => x !== t.id) : [...sel, t.id])} aria-label={`Select ${t.text}`} />
            : <input type="checkbox" checked={!!t.completed} disabled={blocked} title={blocked ? `Waiting for ${blockersOf(t, todos).map((b) => b.text).join(', ')}` : undefined} onChange={() => toggle(t)} aria-label={`Done: ${t.text}`} />}
          {m.label && <i className="o-dot" style={{ background: LABEL_HEX[m.label] }} title={`Label: ${m.label}`} />}
          <span className="t">{t.text}</span>
          {blocked && <span className="o-prio low">Blocked</span>}
          {m.status === 'doing' && !t.completed && <span className="o-prio">Doing</span>}
          {sp.total > 0 && <span className="m" title="Steps done">{sp.done}/{sp.total} steps</span>}
          {m.estimateMin > 0 && <span className="m">{minutesLabel(m.estimateMin)}</span>}
          {m.spentMin > 0 && <span className="m">{minutesLabel(m.spentMin)} spent</span>}
          {(t.priority === 'high' || t.priority === 'low') && <span className={`o-prio ${t.priority}`}>{t.priority}</span>}
          {tag && <span className="o-chip" style={{ height: 26, fontSize: 12 }}><i style={{ background: levelVar(levelOf(mastery.get(tag)?.score)) }} />{topicName(tag)}</span>}
          {t.deadline && <span className="m">{whenOf(t)}</span>}
          <span className="acts">
            <button type="button" className="del" aria-label={`Details ${t.text}`} aria-expanded={openId === t.id} onClick={() => setOpenId(openId === t.id ? null : t.id)}><ListChecks size={15} /></button>
            <button type="button" className="del" aria-label={`Edit ${t.text}`} onClick={() => (editing ? setEditId(null) : startEdit(t))}><Pencil size={15} /></button>
            <span className="o-menu-wrap">
              <button type="button" className="del" aria-label={`Move ${t.text}`} aria-expanded={menuId === t.id} onClick={() => setMenuId(menuId === t.id ? null : t.id)}><CalendarClock size={15} /></button>
              {menuId === t.id && (
                <div className="o-pop right o-resched" role="menu">
                  <button type="button" role="menuitem" onClick={() => reschedule(t, today, 'today')}>Today</button>
                  <button type="button" role="menuitem" onClick={() => reschedule(t, addDays(today, 1), 'tomorrow')}>Tomorrow</button>
                  <button type="button" role="menuitem" onClick={() => reschedule(t, addDays(mondayOf(today), 7), 'next week')}>Next week</button>
                  <label className="pick">Pick a date
                    <input type="date" aria-label={`Pick a date for ${t.text}`} onChange={(e) => { const [y, m, d] = e.target.value.split('-').map(Number); if (y) reschedule(t, new Date(y, m - 1, d), `${d}/${m}`); }} />
                  </label>
                </div>
              )}
            </span>
            <button type="button" className="del" aria-label={`Delete ${t.text}`} onClick={() => remove(t)}><Trash2 size={15} /></button>
          </span>
        </div>
        {openId === t.id && <TaskDetail t={t} todos={todos} onMeta={setMeta} onOpenNote={(id) => navigate(`/notes/${id}`)} onFocus={startFocus} />}
        {editing && (
          <form className="o-edit" onSubmit={(e) => { e.preventDefault(); saveEdit(t); }}>
            <label>Task<input value={draft.text} onChange={(e) => setDraft({ ...draft, text: e.target.value })} aria-label="Task title" autoFocus /></label>
            <label>Date<input type="date" value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} aria-label="Task date" /></label>
            <label>Time<input type="time" value={draft.time} onChange={(e) => setDraft({ ...draft, time: e.target.value })} aria-label="Task time" /></label>
            <label>Priority
              <select value={draft.priority} onChange={(e) => setDraft({ ...draft, priority: e.target.value })} aria-label="Task priority">
                <option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>
              </select>
            </label>
            <label>Topic
              <select value={draft.topic} onChange={(e) => setDraft({ ...draft, topic: e.target.value })} aria-label="Task topic">
                <option value="">None</option>
                {[...new Set([...allTopics, draft.topic].filter(Boolean))].map((x) => <option key={x} value={x}>{topicName(x)}</option>)}
              </select>
            </label>
            <label>Quick date
              <input placeholder="+1d, +2w, next mon" aria-label="Quick date" onChange={(e) => { const d = parseDateShortcut(e.target.value); if (d) setDraft((p) => ({ ...p, date: dateValue(d) })); }} />
            </label>
            <span className="btns"><button type="submit" className="o-btn small" disabled={!draft.text.trim()}>Save</button><button type="button" className="o-btn ghost small" onClick={() => setEditId(null)}>Cancel</button></span>
          </form>
        )}
      </div>
    );
  };

  return (
    <>
      <div className="o-scrim" onMouseDown={back} />
      <article className="o-sheet" style={{ top: 92, width: 876 }} aria-label="Due" ref={sheet}>
        <header className="o-sheet-head">
          <span className="crumb">Due</span>
          <div className="o-seg" role="tablist" aria-label="View" style={{ marginLeft: 8 }}>
            <button type="button" role="tab" aria-selected={view === 'today'} onClick={() => setView('today')}>Today</button>
            <button type="button" role="tab" aria-selected={view === 'list'} onClick={() => setView('list')}>List</button>
            <button type="button" role="tab" aria-selected={view === 'week'} onClick={() => setView('week')}>Week</button>
            <button type="button" role="tab" aria-selected={view === 'board'} onClick={() => setView('board')}>Board</button>
            <button type="button" role="tab" aria-selected={view === 'assign'} onClick={() => setView('assign')}>Assignments</button>
            <button type="button" role="tab" aria-selected={view === 'done'} onClick={() => setView('done')}>Done</button>
            <button type="button" role="tab" aria-selected={view === 'time'} onClick={() => setView('time')}>Time</button>
          </div>
          <span className="grow" />
          <button type="button" className="o-btn ghost small" style={{ height: 44 }} onClick={back}><Network size={16} strokeWidth={2.2} /> Back to map</button>
        </header>

        <div className="o-due">
          <form className="o-due-add" onSubmit={add}>
            {err && <p className="o-err" role="alert">{err}</p>}
            {pv ? (
              <p className="o-preview" aria-live="polite">Adds “{pv.text || text.trim()}”{pvBits.length ? ` · ${pvBits.join(' · ')}` : ''}</p>
            ) : (
              <p className="o-preview o-quiet">Try: {HINTS[new Date().getDate() % HINTS.length]} <button type="button" className="o-chip" aria-expanded={showWords} onClick={() => setShowWords(!showWords)}>?</button>
                {showWords && <span> Words I understand: today, tonight, tomorrow, weekdays, next friday, 6pm, 2026-11-02, oct 21, !high, !low, #topic</span>}
              </p>
            )}
            <label htmlFor="o-due-input" className="o-sr">New task</label>
            <input id="o-due-input" value={text} onChange={(e) => setText(e.target.value)} placeholder={`Add a task${space ? ` to ${topicName(space)}` : ''}: "Lab 6 file thursday #sql-joins"`} autoComplete="off" />
            <button type="submit" className="o-btn" disabled={!text.trim()}>Add</button>
          </form>

          {view === 'list' && (
            <>
              <div className="o-due-sum">
                <span className="o-counters">
                  <span><b>{dueToday}</b> due today</span>
                  <span className={overdueCount ? 'hot' : ''}><b>{overdueCount}</b> overdue</span>
                  <span><b>{doneCount}</b> done</span>
                </span>
                <label className="o-toggle"><input type="checkbox" checked={hideDone} onChange={(e) => setHide(e.target.checked)} /> Hide completed</label>
              </div>
              {goal > 0 && (() => {
                const n = live.filter((t) => t.completed && t.updatedAt && sameDay(t.updatedAt, new Date())).length;
                const pct = Math.min(1, n / goal);
                return (
                  <div className="o-goal" role="progressbar" aria-label="Daily goal" aria-valuemin={0} aria-valuemax={goal} aria-valuenow={Math.min(n, goal)}>
                    <svg width="44" height="44" viewBox="0 0 44 44" aria-hidden="true">
                      <circle cx="22" cy="22" r="18" fill="none" stroke="var(--o-line)" strokeWidth="5" />
                      <circle cx="22" cy="22" r="18" fill="none" stroke="var(--o-path)" strokeWidth="5" strokeLinecap="round" strokeDasharray={`${pct * 113.1} 113.1`} transform="rotate(-90 22 22)" />
                    </svg>
                    <span>{n >= goal ? `Goal reached: ${n} tasks finished today` : `${n} of ${goal} tasks finished today`}</span>
                  </div>
                );
              })()}
              {todayAll.length > 0 && (
                <div className="o-prog" role="progressbar" aria-valuemin={0} aria-valuemax={todayAll.length} aria-valuenow={todayDone} aria-label="Today's progress">
                  <div className="bar"><div style={{ width: `${Math.round((todayDone / todayAll.length) * 100)}%` }} /></div>
                  <span>{todayDone} of {todayAll.length} done today</span>
                </div>
              )}
              <div className="o-toolbar" role="group" aria-label="Filter and sort tasks">
                <label>Topic
                  <select value={fTopic} onChange={(e) => setFTopic(e.target.value)} aria-label="Filter by topic">
                    <option value="">All topics</option>
                    {allTopics.map((x) => <option key={x} value={x}>{topicName(x)}</option>)}
                  </select>
                </label>
                <label>Priority
                  <select value={fPrio} onChange={(e) => setFPrio(e.target.value)} aria-label="Filter by priority">
                    <option value="">Any</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>
                  </select>
                </label>
                <button type="button" className={`o-chip${onlyOver ? ' on' : ''}`} aria-pressed={onlyOver} onClick={() => setOnlyOver(!onlyOver)}>Overdue only</button>
                <label>Sort
                  <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} aria-label="Sort tasks">
                    <option value="time">By time</option><option value="priority">By priority</option><option value="topic">By topic</option>
                  </select>
                </label>
                <label>Label
                  <select value={fLabel} onChange={(e) => setFLabel(e.target.value)} aria-label="Filter by label">
                    <option value="">Any</option>
                    {LABELS.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </label>
                <label>Show done
                  <select value={doneDays} onChange={(e) => setDoneDays(Number(e.target.value))} aria-label="Show finished tasks from">
                    <option value={1}>Today</option><option value={7}>Last 7 days</option><option value={14}>Last 14 days</option><option value={30}>Last 30 days</option><option value={0}>All</option>
                  </select>
                </label>
                <button type="button" className={`o-chip${selMode ? ' on' : ''}`} aria-pressed={selMode} onClick={() => (selMode ? endSelect() : setSelMode(true))}>Select</button>
                <button type="button" className={`o-chip${showNext ? ' on' : ''}`} aria-pressed={showNext} onClick={() => setShowNext(!showNext)}>What next?</button>
                {filtering && <button type="button" className="o-chip on" onClick={() => { setFTopic(''); setFPrio(''); setFLabel(''); setOnlyOver(false); }}>Clear filters ×</button>}
                <TaskExportMenu tasks={() => (filtering ? groups.flatMap((g) => g.items) : todos)} label={filtering ? 'Export filtered' : 'Export'} />
              </div>
              {showNext && <NextCard todos={live} mastery={mastery} onStart={(t) => { setMeta(t, { status: 'doing' }); setShowNext(false); }} onDone={(t) => toggle(t)} onClose={() => setShowNext(false)} />}
              {selMode && (
                <div className="o-bulk" role="toolbar" aria-label="Bulk edit">
                  <b>{sel.length} selected</b>
                  <button type="button" className="o-chip" onClick={() => setSel(groups.flatMap((g) => g.items.map((t) => t.id)))}>All shown</button>
                  <button type="button" className="o-chip" disabled={!sel.length} onClick={bulkDone}>Done</button>
                  <button type="button" className="o-chip" disabled={!sel.length} onClick={() => bulkMove(today, 'today')}>Move to today</button>
                  <button type="button" className="o-chip" disabled={!sel.length} onClick={() => bulkMove(addDays(today, 1), 'tomorrow')}>Move to tomorrow</button>
                  <button type="button" className="o-chip" disabled={!sel.length} onClick={() => bulkPrio('high')}>High priority</button>
                  <button type="button" className="o-chip" disabled={!sel.length} onClick={() => bulkPrio('low')}>Low priority</button>
                  <select aria-label="Label selected" value="" disabled={!sel.length} onChange={(e) => bulkLabel(e.target.value === 'none' ? null : e.target.value)}>
                    <option value="">Label…</option><option value="none">No label</option>{LABELS.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                  <button type="button" className="o-chip" disabled={!sel.length} onClick={bulkDelete}>{confirmDel ? `Confirm: delete ${sel.length}` : 'Delete'}</button>
                  <button type="button" className="o-chip on" onClick={endSelect}>Cancel</button>
                </div>
              )}
              {groups.length === 0 && <p className="o-quiet">{filtering ? 'No tasks match these filters.' : 'Nothing due. Add a task above, or drop one on a topic from the map.'}</p>}
              {groups.map((g) => (
                <section key={g.key} className="o-day">
                  <h2 className={`o-day-head${g.hot ? ' hot' : ''}`}>
                    {g.key === 'over' ? (
                      <button type="button" className="o-fold" aria-expanded={overOpen} onClick={() => setOverOpen(!overOpen)}><ChevronRight size={13} strokeWidth={2.4} className={`chev${overOpen ? ' open' : ''}`} />{g.label}</button>
                    ) : g.label}
                    {' '}· {g.items.filter((t) => !t.completed).length}{g.items.some((t) => t.completed) ? ` (${g.items.filter((t) => t.completed).length} done)` : ''}
                    {plannedMinutes(g.items) > 0 && <span className={`o-planned${plannedMinutes(g.items) > DAY_LIMIT_MIN ? ' hot' : ''}`} title={plannedMinutes(g.items) > DAY_LIMIT_MIN ? 'More than 8 hours planned' : 'Planned time'}> · {minutesLabel(plannedMinutes(g.items))} planned{plannedMinutes(g.items) > DAY_LIMIT_MIN ? ' (too much)' : ''}</span>}
                    {g.key === 'over' && g.items.some((t) => !t.completed) && (
                      <span className="o-bulkmove">
                        <button type="button" className="o-chip" onClick={() => moveOverdue(today, 'today')}>Move all to today</button>
                        <button type="button" className="o-chip" onClick={() => moveOverdue(addDays(today, 1), 'tomorrow')}>Move all to tomorrow</button>
                      </span>
                    )}
                  </h2>
                  {(g.key !== 'over' || overOpen) && g.items.map(taskRow)}
                </section>
              ))}
            </>
          )}

          {view === 'today' && <OrbitToday onToggle={toggle} />}
          {view === 'time' && <TimeReport todos={live} />}
          {view === 'board' && <Board todos={live} onMove={moveCol} />}
          {view === 'assign' && <Assignments todos={live} mastery={mastery} onStatus={setAStatus} />}
          {view === 'done' && (
            <>
              <div className="o-toolbar"><label>Show
                <select value={doneDays} onChange={(e) => setDoneDays(Number(e.target.value))} aria-label="Finished from">
                  <option value={1}>Today</option><option value={7}>Last 7 days</option><option value={14}>Last 14 days</option><option value={30}>Last 30 days</option><option value={0}>All</option>
                </select></label></div>
              <DoneLog todos={live} days={doneDays} onRestore={restore} />
            </>
          )}

          {view === 'week' && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <button type="button" className="o-btn ghost small" aria-label="Last week" onClick={() => setWeek(addDays(week, -7))}><ChevronLeft size={16} /></button>
                <button type="button" className="o-btn ghost small" onClick={() => setWeek(mondayOf(new Date()))}>This week</button>
                <button type="button" className="o-btn ghost small" aria-label="Next week" onClick={() => setWeek(addDays(week, 7))}><ChevronRight size={16} /></button>
                <span className="o-eyebrow" style={{ marginLeft: 8 }}>{week.getDate()} {week.toLocaleDateString('en-GB', { month: 'short' })} – {addDays(week, 6).getDate()} {addDays(week, 6).toLocaleDateString('en-GB', { month: 'short' })}</span>
                <span className="o-quiet" style={{ marginLeft: 'auto', fontSize: 12.5 }}>Drag a task to another day to move it</span>
              </div>
              <div className="o-week">
                {days.map((d) => {
                  const items = todos.filter((t) => t.deadline && sameDay(t.deadline, d) && !gone.includes(t.id) && !(hideDone && t.completed)).sort((a, b) => (momentOf(a) || 0) - (momentOf(b) || 0));
                  return (
                    <div
                      key={d.toISOString()}
                      className={`o-week-day${sameDay(d, today) ? ' today' : ''}`}
                      data-day={dateValue(d)}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => {
                        e.preventDefault();
                        const t = todos.find((x) => x.id === e.dataTransfer.getData('text/plain'));
                        if (t && !sameDay(t.deadline, d)) reschedule(t, d, dayWord(d).toLowerCase());
                      }}
                    >
                      <div className="h"><b>{d.getDate()}</b><span>{DOW[d.getDay()].toUpperCase()}</span></div>
                      {items.map((t) => (
                        <button key={t.id} type="button" draggable onDragStart={(e) => e.dataTransfer.setData('text/plain', t.id)} className={`o-week-item${t.startTime ? ' meet' : ''}${t.completed ? ' done' : ''}`} onClick={() => toggle(t)} title={t.completed ? 'Mark not done' : 'Mark done'}>
                          <span>{t.text}</span>
                          {timeOf(t) && <span className="m">{timeOf(t)}</span>}
                        </button>
                      ))}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
        {focus && (
          <div className="o-focus" role="timer" aria-label="Focus timer">
            <b>Focus</b>
            <span className="t">{focus.task.text}</span>
            <span className="m" aria-live="off">{String(Math.floor(focusLeft / 60000)).padStart(2, '0')}:{String(Math.floor((focusLeft % 60000) / 1000)).padStart(2, '0')}</span>
            <button type="button" className="o-btn small" onClick={stopFocus}>Stop and log</button>
          </div>
        )}
        {toast && (
          <div className="o-toast" role="status">
            <span>{toast.msg}</span>
            <button type="button" onClick={() => { const u = toast.undo; clearTimeout(toastTimer.current); setToast(null); u(); }}>Undo</button>
          </div>
        )}
      </article>
    </>
  );
}

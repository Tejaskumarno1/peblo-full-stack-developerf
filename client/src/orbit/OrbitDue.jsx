import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Network, Trash2, ChevronLeft, ChevronRight, CalendarClock, Pencil } from 'lucide-react';
import { todosAPI } from '../api';
import { parseTask } from '../utils/parseTask';
import { askScope } from '../utils/askScope';
import { useOrbit } from './OrbitShell';
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
  const filtering = !!fTopic || !!fPrio || onlyOver;
  const sortItems = (items) => {
    if (sortBy === 'priority') return [...items].sort((a, b) => (RANK[a.priority] ?? 1) - (RANK[b.priority] ?? 1) || new Date(a.deadline || 8.64e15) - new Date(b.deadline || 8.64e15));
    if (sortBy === 'topic') return [...items].sort((a, b) => (tagsOfTodo(a)[0] || '~').localeCompare(tagsOfTodo(b)[0] || '~') || new Date(a.deadline || 8.64e15) - new Date(b.deadline || 8.64e15));
    return items;
  };

  const groups = useMemo(() => {
    // done tasks stay (struck through) so you can check them; overdue ones that were due over two weeks ago are history
    const list = todos
      .filter((t) => !gone.includes(t.id) && (!t.completed || (!hideDone && (!t.deadline || startOfDay(t.deadline) >= addDays(today, -14)))))
      .filter((t) => !fTopic || tagsOfTodo(t).includes(fTopic))
      .filter((t) => !fPrio || (t.priority || 'medium') === fPrio)
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
  }, [todos, gone, hideDone, fTopic, fPrio, onlyOver, sortBy, today.getTime()]); // eslint-disable-line react-hooks/exhaustive-deps

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
    return (
      <div key={t.id} className="o-task-wrap">
        <div className={`o-task${t.completed ? ' done' : ''}`} tabIndex={0} data-id={t.id} onKeyDown={(e) => onRowKey(e, t)} aria-label={`${t.text}. Space to tick, E to edit, Delete to remove.`}>
          <input type="checkbox" checked={!!t.completed} onChange={() => toggle(t)} aria-label={`Done: ${t.text}`} />
          <span className="t">{t.text}</span>
          {(t.priority === 'high' || t.priority === 'low') && <span className={`o-prio ${t.priority}`}>{t.priority}</span>}
          {tag && <span className="o-chip" style={{ height: 26, fontSize: 12 }}><i style={{ background: levelVar(levelOf(mastery.get(tag)?.score)) }} />{topicName(tag)}</span>}
          {t.deadline && <span className="m">{whenOf(t)}</span>}
          <span className="acts">
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
            <button type="button" role="tab" aria-selected={view === 'list'} onClick={() => setView('list')}>List</button>
            <button type="button" role="tab" aria-selected={view === 'week'} onClick={() => setView('week')}>Week</button>
          </div>
          <span className="grow" />
          <button type="button" className="o-btn ghost small" style={{ height: 44 }} onClick={back}><Network size={16} strokeWidth={2.2} /> Back to map</button>
        </header>

        <div className="o-due">
          <form className="o-due-add" onSubmit={add}>
            {err && <p className="o-err" role="alert">{err}</p>}
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
                {filtering && <button type="button" className="o-chip on" onClick={() => { setFTopic(''); setFPrio(''); setOnlyOver(false); }}>Clear filters ×</button>}
              </div>
              {groups.length === 0 && <p className="o-quiet">{filtering ? 'No tasks match these filters.' : 'Nothing due. Add a task above, or drop one on a topic from the map.'}</p>}
              {groups.map((g) => (
                <section key={g.key} className="o-day">
                  <h2 className={`o-day-head${g.hot ? ' hot' : ''}`}>
                    {g.key === 'over' ? (
                      <button type="button" className="o-fold" aria-expanded={overOpen} onClick={() => setOverOpen(!overOpen)}><ChevronRight size={13} strokeWidth={2.4} className={`chev${overOpen ? ' open' : ''}`} />{g.label}</button>
                    ) : g.label}
                    {' '}· {g.items.filter((t) => !t.completed).length}{g.items.some((t) => t.completed) ? ` (${g.items.filter((t) => t.completed).length} done)` : ''}
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

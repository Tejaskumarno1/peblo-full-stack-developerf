import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Network, Trash2, ChevronLeft, ChevronRight } from 'lucide-react';
import { todosAPI } from '../api';
import { parseTask } from '../utils/parseTask';
import { askScope } from '../utils/askScope';
import { useOrbit } from './OrbitShell';
import { topicName, levelOf, levelVar, tagsOfTodo } from './orbitUtils';
import { startOfDay, addDays, sameDay, dayWord, clock, isAllDay, momentOf, mondayOf } from '../river/riverUtils';

const UNDO_MS = 6000;
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

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
  // PEB-122: a ticked task stays where it is (light and struck through) unless "Hide completed" is on
  const [hideDone, setHideDone] = useState(() => { try { return localStorage.getItem('peblo-orbit-hide-done') === '1'; } catch { return false; } });
  const setHide = (v) => { setHideDone(v); try { localStorage.setItem('peblo-orbit-hide-done', v ? '1' : '0'); } catch { /* ignore */ } };
  // PEB-123: a short "Undo" after ticking or deleting a task
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
    try { await fn(); } catch (e) { setErr(e.response?.data?.error || failMsg); } finally { refresh(); }
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
  const add = async (e) => {
    e.preventDefault();
    const raw = text.trim();
    if (!raw) return;
    const p = parseTask(raw);
    let deadline = p.deadline ? new Date(p.deadline) : null;
    const tags = [...new Set([...(space ? [space] : []), ...p.tags])];
    await run(async () => {
      await todosAPI.create({ text: p.text || raw, priority: p.priority, tags, deadline: deadline ? deadline.toISOString() : null });
      setText('');
    }, 'Could not add the task. Your text is still here, try again.');
  };

  const groups = useMemo(() => {
    // done tasks stay (struck through) so you can check them; overdue ones that were due over two weeks ago are history
    const list = todos.filter((t) => !gone.includes(t.id) && (!t.completed || (!hideDone && (!t.deadline || startOfDay(t.deadline) >= addDays(today, -14)))));
    const g = [];
    const push = (key, label, items, hot) => { if (items.length) g.push({ key, label, items, hot: hot && items.some((t) => !t.completed) }); };
    const dated = list.filter((t) => t.deadline).sort((a, b) => new Date(a.deadline) - new Date(b.deadline));
    push('over', 'Overdue', dated.filter((t) => startOfDay(t.deadline) < today), true);
    for (let i = 0; i < 21; i++) {
      const d = addDays(today, i);
      const items = dated.filter((t) => sameDay(t.deadline, d));
      push(`d${i}`, i < 2 ? dayWord(d) : `${DOW[d.getDay()]} ${d.getDate()} ${d.toLocaleDateString('en-GB', { month: 'short' })}`, items, false);
    }
    push('later', 'Later', dated.filter((t) => startOfDay(t.deadline) >= addDays(today, 21)), false);
    push('none', 'No date', list.filter((t) => !t.deadline), false);
    return g;
  }, [todos, gone, hideDone, today.getTime()]); // eslint-disable-line react-hooks/exhaustive-deps
  const doneCount = todos.filter((t) => t.completed && !gone.includes(t.id)).length;
  const openCount = todos.filter((t) => !t.completed && !gone.includes(t.id)).length;

  const days = Array.from({ length: 7 }, (_, i) => addDays(week, i));
  const timeOf = (t) => (t.startTime ? clock(momentOf(t)) : isAllDay(t) ? '' : clock(t.deadline));

  const back = () => navigate('/');

  return (
    <>
      <div className="o-scrim" onMouseDown={back} />
      <article className="o-sheet" style={{ top: 92, width: 876 }} aria-label="Due">
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
                <span><b>{openCount}</b> to do · <b>{doneCount}</b> done</span>
                <label className="o-toggle"><input type="checkbox" checked={hideDone} onChange={(e) => setHide(e.target.checked)} /> Hide completed</label>
              </div>
              {groups.length === 0 && <p className="o-quiet">Nothing due. Add a task above, or drop one on a topic from the map.</p>}
              {groups.map((g) => (
                <section key={g.key} className="o-day">
                  <h2 className={`o-day-head${g.hot ? ' hot' : ''}`}>{g.label} · {g.items.filter((t) => !t.completed).length}{g.items.some((t) => t.completed) ? ` (${g.items.filter((t) => t.completed).length} done)` : ''}</h2>
                  {g.items.map((t) => {
                    const tag = tagsOfTodo(t)[0];
                    return (
                      <div key={t.id} className={`o-task${t.completed ? ' done' : ''}`}>
                        <input type="checkbox" checked={!!t.completed} onChange={() => toggle(t)} aria-label={`Done: ${t.text}`} />
                        <span className="t">{t.text}</span>
                        {tag && <span className="o-chip" style={{ height: 26, fontSize: 12 }}><i style={{ background: levelVar(levelOf(mastery.get(tag)?.score)) }} />{topicName(tag)}</span>}
                        {t.deadline && timeOf(t) && <span className="m">{timeOf(t)}</span>}
                        <button type="button" className="del" aria-label={`Delete ${t.text}`} onClick={() => remove(t)}><Trash2 size={15} /></button>
                      </div>
                    );
                  })}
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
              </div>
              <div className="o-week">
                {days.map((d) => {
                  const items = todos.filter((t) => t.deadline && sameDay(t.deadline, d) && !gone.includes(t.id) && !(hideDone && t.completed)).sort((a, b) => (momentOf(a) || 0) - (momentOf(b) || 0));
                  return (
                    <div key={d.toISOString()} className={`o-week-day${sameDay(d, today) ? ' today' : ''}`}>
                      <div className="h"><b>{d.getDate()}</b><span>{DOW[d.getDay()].toUpperCase()}</span></div>
                      {items.map((t) => (
                        <button key={t.id} type="button" className={`o-week-item${t.startTime ? ' meet' : ''}${t.completed ? ' done' : ''}`} onClick={() => toggle(t)} title={t.completed ? 'Mark not done' : 'Mark done'}>
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

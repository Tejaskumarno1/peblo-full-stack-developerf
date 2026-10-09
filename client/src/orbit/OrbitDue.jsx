import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Network, Trash2, ChevronLeft, ChevronRight } from 'lucide-react';
import { todosAPI } from '../api';
import { parseTask } from '../utils/parseTask';
import { useOrbit } from './OrbitShell';
import { topicName, levelOf, levelVar, tagsOfTodo } from './orbitUtils';
import { startOfDay, addDays, sameDay, dayWord, clock, isAllDay, momentOf, mondayOf } from '../river/riverUtils';

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Orbit · Due: tasks as a list (Tasks) or as a week (Calendar), on a sheet over the map. */
export default function OrbitDue({ view: initialView = 'list' }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { todos, mastery, space } = useOrbit();
  const [view, setView] = useState(initialView);
  const [text, setText] = useState('');
  const [week, setWeek] = useState(() => mondayOf(new Date()));
  const today = startOfDay();

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['todos'] });
    queryClient.invalidateQueries({ queryKey: ['dashboard'] });
  };
  const toggle = async (t) => {
    queryClient.setQueryData(['todos', 'orbit-all'], (old) => (old || []).map((x) => (x.id === t.id ? { ...x, completed: !x.completed } : x)));
    await todosAPI.update(t.id, { completed: !t.completed });
    refresh();
  };
  const remove = async (t) => {
    if (!window.confirm(`Delete "${t.text}"?`)) return;
    await todosAPI.delete(t.id);
    refresh();
  };
  const add = async (e) => {
    e.preventDefault();
    const raw = text.trim();
    if (!raw) return;
    const p = parseTask(raw);
    let deadline = p.deadline ? new Date(p.deadline) : null;
    const tags = [...new Set([...(space ? [space] : []), ...p.tags])];
    await todosAPI.create({ text: p.text || raw, priority: p.priority, tags, deadline: deadline ? deadline.toISOString() : null });
    setText('');
    refresh();
  };

  const groups = useMemo(() => {
    const list = todos.filter((t) => !t.completed || (t.deadline && startOfDay(t.deadline) >= today));
    const g = [];
    const push = (key, label, items, hot) => { if (items.length) g.push({ key, label, items, hot }); };
    const dated = list.filter((t) => t.deadline).sort((a, b) => new Date(a.deadline) - new Date(b.deadline));
    push('over', 'Overdue', dated.filter((t) => !t.completed && startOfDay(t.deadline) < today), true);
    for (let i = 0; i < 21; i++) {
      const d = addDays(today, i);
      const items = dated.filter((t) => sameDay(t.deadline, d));
      push(`d${i}`, i < 2 ? dayWord(d) : `${DOW[d.getDay()]} ${d.getDate()} ${d.toLocaleDateString('en-GB', { month: 'short' })}`, items, false);
    }
    push('later', 'Later', dated.filter((t) => startOfDay(t.deadline) >= addDays(today, 21)), false);
    push('none', 'No date', list.filter((t) => !t.deadline && !t.completed), false);
    return g;
  }, [todos, today.getTime()]); // eslint-disable-line react-hooks/exhaustive-deps

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
            <label htmlFor="o-due-input" className="o-sr">New task</label>
            <input id="o-due-input" value={text} onChange={(e) => setText(e.target.value)} placeholder={`Add a task${space ? ` to ${topicName(space)}` : ''}: "Lab 6 file thursday #sql-joins"`} autoComplete="off" />
            <button type="submit" className="o-btn" disabled={!text.trim()}>Add</button>
          </form>

          {view === 'list' && (
            <>
              {groups.length === 0 && <p className="o-quiet">Nothing due. Add a task above, or drop one on a topic from the map.</p>}
              {groups.map((g) => (
                <section key={g.key} className="o-day">
                  <h2 className={`o-day-head${g.hot ? ' hot' : ''}`}>{g.label} · {g.items.length}</h2>
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
                  const items = todos.filter((t) => t.deadline && sameDay(t.deadline, d)).sort((a, b) => (momentOf(a) || 0) - (momentOf(b) || 0));
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
      </article>
    </>
  );
}

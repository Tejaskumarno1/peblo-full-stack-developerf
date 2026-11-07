import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, X, Check } from 'lucide-react';
import { todosAPI } from '../api';
import { useAuth } from '../context/AuthContext';
import { dkey, lastDays, habitStreak, toggleHabitDay, pruneHabits, habitWeekPercent, focusByDay, hm } from './widgetUtils';
import './widgets.css';

const STEPS = ['Review what got done', 'Move unfinished tasks to tomorrow', "Pick tomorrow's top 3", 'Close the day'];

/** Soft Studio · Home widgets (mockup: HomeWidgets). Habits, focus this week, streak and the shutdown ritual. */
export default function HomeWidgets({ streak = 0, lastWeek = [], greeting, switcher }) {
  const { settings, updateSettings } = useAuth();
  const qc = useQueryClient();
  const today = new Date(); const tk = dkey(today);
  const habits = Array.isArray(settings?.habits) ? settings.habits : [];
  const days = useMemo(() => lastDays(7, today), [tk]); // eslint-disable-line react-hooks/exhaustive-deps
  const [adding, setAdding] = useState(false); const [draft, setDraft] = useState('');
  const { data: all = [] } = useQuery({ queryKey: ['todos', 'widgets'], queryFn: () => todosAPI.getAll().then((r) => r.data.todos || []), staleTime: 30000 });

  const saveHabits = (next) => updateSettings({ habits: pruneHabits(next) });
  const addHabit = () => { const name = draft.trim().slice(0, 40); if (!name) return; saveHabits([...habits, { id: 'h' + Date.now().toString(36), name, days: {} }].slice(0, 8)); setDraft(''); setAdding(false); };

  const mins = focusByDay(all, days);
  const prevMins = focusByDay(all, lastDays(14, today).slice(0, 7));
  const total = mins.reduce((a, b) => a + b, 0); const prevTotal = prevMins.reduce((a, b) => a + b, 0);
  const max = Math.max(60, ...mins);

  const ritual = settings?.shutdown?.date === tk ? settings.shutdown : { date: tk, steps: [false, false, false, false] };
  const setStep = (i, v) => updateSettings({ shutdown: { date: tk, steps: ritual.steps.map((x, j) => (j === i ? v : x)) } });
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const doneToday = all.filter((t) => t.completed && new Date(t.updatedAt) >= startOfToday).length;
  const unfinished = all.filter((t) => !t.completed && t.deadline && new Date(t.deadline) >= startOfToday && new Date(t.deadline) < new Date(startOfToday.getTime() + 86400000) && !t.startTime);
  const moveAll = async () => {
    await Promise.all(unfinished.map((t) => { const d = new Date(t.deadline); d.setDate(d.getDate() + 1); return todosAPI.update(t.id, { deadline: d.toISOString() }).catch(() => null); }));
    qc.invalidateQueries({ queryKey: ['todos'] }); setStep(1, true);
  };
  const closed = ritual.steps[3];

  return (
    <div className="s-hw" data-testid="home-widgets">
      <div className="s-hw-head"><h1 className="s-hw-title">{greeting}</h1><span className="grow" />{switcher}</div>
      <div className="s-hw-grid">
        <section className="s-hw-tile mint habits" aria-label="Habits">
          <h2>Habits</h2>
          {habits.length === 0 && <p className="s-empty">No habits yet. Add one you want to repeat every day.</p>}
          {habits.map((h) => (
            <div key={h.id} className="s-hw-habit" data-testid="habit">
              <span className="nm">{h.name}</span>
              <span className="dots" role="group" aria-label={`${h.name}, last 7 days`}>
                {days.map((d) => { const k = dkey(d); const on = !!h.days?.[k]; return <button key={k} type="button" aria-pressed={on} aria-label={`${h.name}, ${d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' })}`} className={on ? 'on' : ''} onClick={() => saveHabits(habits.map((x) => (x.id === h.id ? toggleHabitDay(x, k) : x)))} />; })}
              </span>
              <b>{habitStreak(h)} {habitStreak(h) === 1 ? 'day' : 'days'}</b>
              <button type="button" className="rm" aria-label={`Remove ${h.name}`} onClick={() => saveHabits(habits.filter((x) => x.id !== h.id))}><X size={13} /></button>
            </div>
          ))}
          {habits.length > 0 && <div className="s-hw-week"><span>This week</span><b data-testid="habit-percent">{habitWeekPercent(habits)}%</b><span>of habits done</span></div>}
          {adding ? (
            <form className="s-hw-add" onSubmit={(e) => { e.preventDefault(); addHabit(); }}>
              <input autoFocus aria-label="New habit" placeholder="Read 20 min" value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') setAdding(false); }} />
              <button type="submit" className="s-hw-btn dark" disabled={!draft.trim()}>Add</button>
            </form>
          ) : habits.length < 8 && <button type="button" className="s-hw-btn" onClick={() => setAdding(true)}><Plus size={14} /> Add habit</button>}
        </section>

        <section className="s-hw-tile focus" aria-label="Focus this week">
          <h2>Focus this week</h2>
          <p>{total ? `${hm(total)} of focus${prevTotal ? (total >= prevTotal ? `, ${hm(total - prevTotal)} more than last week` : `, ${hm(prevTotal - total)} less than last week`) : ''}` : 'Log time on a task and it shows up here.'}</p>
          <div className="bars" role="img" aria-label={`Focus minutes per day: ${mins.join(', ')}`}>
            {days.map((d, i) => <div key={dkey(d)}><span style={{ height: Math.max(4, Math.round((mins[i] / max) * 130)) }} className={dkey(d) === tk ? 'today' : ''} title={hm(mins[i])} /><small>{d.toLocaleDateString(undefined, { weekday: 'narrow' })}</small></div>)}
          </div>
        </section>

        <section className="s-hw-tile lilac streak" aria-label="Streak">
          <h2>Streak</h2>
          <span className="num">{streak}</span>
          <p>days with at least one note written</p>
          <div className="dots7">{Array.from({ length: 7 }, (_, i) => lastWeek[i]).map((d, i) => <span key={i} className={d && d.total > 0 ? 'on' : ''} />)}</div>
        </section>

        <section className="s-hw-tile peach ritual" aria-label="Shutdown ritual">
          <h2>Shutdown ritual</h2>
          {STEPS.map((label, i) => {
            const text = i === 0 ? `Review what got done (${doneToday} ${doneToday === 1 ? 'task' : 'tasks'})` : i === 1 ? (unfinished.length ? `Move ${unfinished.length} unfinished ${unfinished.length === 1 ? 'task' : 'tasks'} to tomorrow` : 'Nothing unfinished to move') : label;
            return (
              <label key={label} className={`s-hw-step${ritual.steps[i] ? ' on' : ''}`}>
                <input type="checkbox" checked={!!ritual.steps[i]} onChange={(e) => (i === 1 && e.target.checked && unfinished.length ? moveAll() : setStep(i, e.target.checked))} />
                <span className="box" aria-hidden="true">{ritual.steps[i] && <Check size={13} strokeWidth={3} />}</span>
                <span>{text}</span>
              </label>
            );
          })}
          <button type="button" className="s-hw-btn dark" data-testid="close-day" disabled={closed} onClick={() => updateSettings({ shutdown: { date: tk, steps: [true, true, true, true] } })}>{closed ? 'Day closed' : 'Close the day'}</button>
        </section>
      </div>
    </div>
  );
}

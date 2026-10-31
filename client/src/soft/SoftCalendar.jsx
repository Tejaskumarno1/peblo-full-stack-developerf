import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { todosAPI } from '../api';
import NewMeeting from '../components/NewMeeting';
import TimeGrid from '../components/TimeGrid';
import { startOfWeek, weekdayNames } from '../utils/weekStart';
import { startOfDay, addDays, sameDay, daysFromToday, spanOf, timeOf, toneOf, tagsOf, weekdayLong } from './softUtils';

const DOW = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
// Left accent bar colour per pastel tone (mockup: Calendar.dc.html)
const BAR = { peach: '#c4441c', sky: '#3b7bbf', lilac: '#7b52b8', mint: '#2d9d6a', butter: '#d19a12' };
const fmt = (d, o) => new Date(d).toLocaleDateString('en-GB', o);

/** Soft Studio · Calendar (mockup: SoftCalendar). Week view with a mini month and a countdown. */
export default function SoftCalendar() {
  const navigate = useNavigate();
  const [view, setView] = useState('week');
  const [cursor, setCursor] = useState(() => startOfDay());

  const weekStart = startOfWeek(cursor);
  const monthStart = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const gridStart = startOfWeek(monthStart);
  const from = addDays(gridStart < weekStart ? gridStart : weekStart, -1); // one day back so an event past midnight shows its tail
  const to = addDays(from, 62);

  const { data: todos = [], isError } = useQuery({
    queryKey: ['todos', 'range', 'soft-cal', from.toDateString()],
    queryFn: () => todosAPI.getRange(from.toISOString(), to.toISOString()).then((r) => r.data.todos || []),
  });
  const { data: ahead = [] } = useQuery({
    queryKey: ['todos', 'range', 'soft-cal-ahead', startOfDay().toDateString()],
    queryFn: () => todosAPI.getRange(startOfDay().toISOString(), addDays(startOfDay(), 60).toISOString()).then((r) => r.data.todos || []),
  });

  const nextBig = useMemo(() => {
    const open = ahead.filter((t) => !t.completed && t.deadline && new Date(t.deadline) >= new Date()).sort((a, b) => new Date(a.deadline) - new Date(b.deadline));
    return open.find((t) => t.priority === 'high') || open[0] || null;
  }, [ahead]);

  const days = view === 'day' ? [cursor] : Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  // All 24 hours are always in the grid (TimeGrid scrolls inside itself). Events that run past midnight continue on the next day.
  const openTask = (t) => (t.note?.id ? navigate(`/notes/${t.note.id}`) : navigate('/tasks'));
  const spans = todos.filter((t) => t.deadline).map((t) => ({ t, s: timeOf(t) ? spanOf(t) : null }));
  const allDay = spans.filter((x) => !x.s && days.some((d) => sameDay(x.t.deadline, d)));

  const toneFor = (t) => {
    if (nextBig && t.id === nextBig.id) return { bg: 'var(--s-accent)', fg: 'var(--s-on-accent)', bar: 'var(--s-on-accent)' };
    if (t.priority === 'high') return { bg: 'var(--s-peach)', fg: 'var(--s-fg)', bar: BAR.peach };
    const tone = toneOf(tagsOf(t)[0]);
    const k = tone === 'peach' ? 'sky' : tone;
    return { bg: `var(--s-${k})`, fg: 'var(--s-fg)', bar: BAR[k] };
  };

  const gridEvents = [];
  for (const d of days) {
    const prev = addDays(d, -1);
    for (const { t, s } of spans) {
      if (!s) continue;
      const c = toneFor(t);
      const common = { title: t.text, meta: `${timeOf(t)}${t.endTime ? ` – ${t.endTime}` : ''}`, bg: c.bg, fg: c.fg, bar: c.bar, done: t.completed, day: d, props: { onClick: () => openTask(t) } };
      if (sameDay(t.deadline, d)) gridEvents.push({ ...common, id: t.id, start: s.start, end: Math.min(24, s.end) });
      else if (s.end > 24 && sameDay(t.deadline, prev)) gridEvents.push({ ...common, id: t.id, start: 0, end: s.end - 24, cont: true });
    }
  }
  const gridAllDay = allDay.flatMap(({ t }) => days.filter((d) => sameDay(t.deadline, d)).map((d) => { const c = toneFor(t); return { id: t.id, day: d, title: t.text, bg: c.bg, fg: c.fg, bar: c.bar, done: t.completed, props: { onClick: () => openTask(t) } }; }));

  const move = (dir) => setCursor((c) => (view === 'month' ? new Date(c.getFullYear(), c.getMonth() + dir, 1) : addDays(c, dir * (view === 'day' ? 1 : 7))));
  const title = view === 'day' ? (sameDay(cursor, new Date()) ? 'Today' : weekdayLong(cursor)) : view === 'month' ? fmt(cursor, { month: 'long' }) : (sameDay(weekStart, addDays(startOfDay(), -startOfDay().getDay())) ? 'This week' : `Week of ${fmt(weekStart, { day: 'numeric', month: 'short' })}`);
  const range = view === 'day' ? fmt(cursor, { day: 'numeric', month: 'long', year: 'numeric' })
    : view === 'month' ? fmt(cursor, { year: 'numeric' })
      : `${fmt(weekStart, { day: 'numeric', month: 'long' })} – ${fmt(addDays(weekStart, 6), { day: 'numeric', month: 'long' })}`;

  // Mini month (follows the cursor)
  const miniStart = gridStart;
  const busy = new Set(todos.filter((t) => t.deadline && !t.completed).map((t) => startOfDay(t.deadline).toDateString()));
  // Only this month's days are shown; weeks that are entirely next month are dropped
  const mini = Array.from({ length: 42 }, (_, i) => addDays(miniStart, i)).filter((d, i) => d.getMonth() === cursor.getMonth() || i < 7 || addDays(miniStart, i - (i % 7)).getMonth() === cursor.getMonth());

  const bigDays = nextBig ? daysFromToday(nextBig.deadline) : null;

  return (
    <div className="soft-page s-cal">
      <div className="s-page-head s-cal-head">
        <div className="s-page-title">
          <h1 className="s-h1">{title}</h1>
          <span className="s-sub">{range}</span>
        </div>
        <span className="grow" />
        <button type="button" className="s-round46" aria-label="Previous" onClick={() => move(-1)}>‹</button>
        <button type="button" className="s-pill46" onClick={() => setCursor(startOfDay())}>Today</button>
        <button type="button" className="s-round46" aria-label="Next" onClick={() => move(1)}>›</button>
        <NewMeeting className="s-pill46" day={cursor} />
        <div className="s-seg small" role="tablist" aria-label="View">
          {['day', 'week', 'month'].map((v) => (
            <button key={v} type="button" role="tab" aria-selected={view === v} className={view === v ? 'on' : ''} onClick={() => setView(v)}>{v[0].toUpperCase() + v.slice(1)}</button>
          ))}
        </div>
      </div>

      <div className="s-cal-side">
        <section className="s-minical" aria-label={`${fmt(cursor, { month: 'long' })} overview`}>
          <h2 className="s-mini-title">{fmt(cursor, { month: 'long' })}</h2>
          <div className="s-mini-dow">{weekdayNames(DOW).map((d, i) => <span key={i}>{d}</span>)}</div>
          <div className="s-mini-grid">
            {mini.map((d) => {
              const inMonth = d.getMonth() === cursor.getMonth();
              if (!inMonth) return <span key={d.toISOString()} className="s-minical-blank" aria-hidden="true" />;
              const today = sameDay(d, new Date());
              const picked = sameDay(d, cursor) && !today;
              return (
                <button
                  key={d.toISOString()}
                  type="button"
                  className={`s-mini-day${today ? ' today' : ''}${picked ? ' picked' : ''}${inMonth ? '' : ' out'}`}
                  onClick={() => setCursor(startOfDay(d))}
                  aria-label={fmt(d, { weekday: 'long', day: 'numeric', month: 'long' })}
                >
                  {d.getDate()}
                  <span className="dot" style={{ background: busy.has(d.toDateString()) && !today ? 'var(--s-accent)' : 'transparent' }} />
                </button>
              );
            })}
          </div>
        </section>
        <section className="s-big" aria-label="Next big thing">
          <span className="s-big-label">Next big thing</span>
          {nextBig ? (
            <>
              <span className="s-big-num">{bigDays === 0 ? 'Today' : bigDays === 1 ? 'Tomorrow' : `${bigDays} days`}</span>
              <span className="s-big-title">{nextBig.text}</span>
              <span className="s-big-meta">{[weekdayLong(nextBig.deadline), timeOf(nextBig), tagsOf(nextBig)[0] ? `#${tagsOf(nextBig)[0]}` : null].filter(Boolean).join(' · ')}</span>
            </>
          ) : (
            <span className="s-big-title" style={{ marginTop: 8 }}>Nothing big coming up. Enjoy the calm.</span>
          )}
        </section>
      </div>

      {isError && <p className="s-empty small" role="alert">Could not load your schedule. Check your connection and try again.</p>}
      <section className={`s-week${view === 'month' ? '' : ' is-grid'}`} aria-label="Schedule">
        {view === 'month' ? (
          <div className="s-month">
            {weekdayNames(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']).map((d, i) => <span key={i} className="s-month-dow">{d}</span>)}
            {Array.from({ length: 42 }, (_, i) => addDays(gridStart, i)).map((d) => {
              const items = todos.filter((t) => t.deadline && sameDay(t.deadline, d));
              return (
                <button key={d.toISOString()} type="button" className={`s-month-cell${d.getMonth() === cursor.getMonth() ? '' : ' out'}${sameDay(d, new Date()) ? ' today' : ''}`} onClick={() => { setCursor(startOfDay(d)); setView('day'); }}>
                  <span className="n">{d.getDate()}</span>
                  {items.slice(0, 3).map((t) => { const c = toneFor(t); return <span key={t.id} className={`ev${t.completed ? ' done' : ''}`} style={{ background: c.bg, color: c.fg }}>{t.text}</span>; })}
                  {items.length > 3 && <span className="more">+{items.length - 3}</span>}
                </button>
              );
            })}
          </div>
        ) : (
          <>
            <TimeGrid days={days} events={gridEvents} allDay={gridAllDay} headClass="s-week-day" onToday={() => setCursor(startOfDay())} label="Schedule" />
          </>
        )}
      </section>
    </div>
  );
}

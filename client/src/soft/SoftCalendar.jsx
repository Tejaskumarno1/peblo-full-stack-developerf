import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { todosAPI } from '../api';
import { startOfDay, addDays, sameDay, daysFromToday, spanOf, timeOf, toneOf, tagsOf, weekdayLong } from './softUtils';

const DOW = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const fmt = (d, o) => new Date(d).toLocaleDateString('en-GB', o);

/** Soft Studio · Calendar (mockup: SoftCalendar). Week view with a mini month and a countdown. */
export default function SoftCalendar() {
  const navigate = useNavigate();
  const [view, setView] = useState('week');
  const [cursor, setCursor] = useState(() => startOfDay());

  const weekStart = addDays(cursor, -cursor.getDay());
  const monthStart = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const gridStart = addDays(monthStart, -monthStart.getDay());
  const from = gridStart < weekStart ? gridStart : weekStart;
  const to = addDays(from, 62);

  const { data: todos = [] } = useQuery({
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

  // Hours shown: at least 09:00–22:00, stretched to fit early or late tasks
  const onDays = todos.filter((t) => t.deadline && days.some((d) => sameDay(t.deadline, d)));
  const spans = onDays.map((t) => ({ t, s: timeOf(t) ? spanOf(t) : null }));
  const first = Math.min(9, ...spans.filter((x) => x.s).map((x) => Math.floor(x.s.start)));
  const last = Math.max(22, ...spans.filter((x) => x.s).map((x) => Math.ceil(x.s.end)));
  const total = last - first;
  const hours = Array.from({ length: total }, (_, i) => first + i);
  const allDay = spans.filter((x) => !x.s);

  const toneFor = (t) => {
    if (nextBig && t.id === nextBig.id) return { bg: 'var(--s-accent)', fg: 'var(--s-on-accent)' };
    if (t.priority === 'high') return { bg: 'var(--s-peach)', fg: 'var(--s-fg)' };
    const tone = toneOf(tagsOf(t)[0]);
    return { bg: `var(--s-${tone === 'peach' ? 'sky' : tone})`, fg: 'var(--s-fg)' };
  };

  // Lay out a day's timed tasks side by side when they overlap
  const layout = (day) => {
    const items = spans.filter((x) => x.s && sameDay(x.t.deadline, day)).sort((a, b) => a.s.start - b.s.start);
    const lanes = [];
    for (const it of items) {
      let lane = lanes.findIndex((end) => end <= it.s.start);
      if (lane === -1) { lane = lanes.length; lanes.push(0); }
      lanes[lane] = it.s.end;
      it.lane = lane;
    }
    return items.map((it) => ({ ...it, lanes: Math.max(1, lanes.length) }));
  };

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
  const openTask = (t) => (t.note?.id ? navigate(`/notes/${t.note.id}`) : navigate('/tasks'));

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
        <div className="s-seg small" role="tablist" aria-label="View">
          {['day', 'week', 'month'].map((v) => (
            <button key={v} type="button" role="tab" aria-selected={view === v} className={view === v ? 'on' : ''} onClick={() => setView(v)}>{v[0].toUpperCase() + v.slice(1)}</button>
          ))}
        </div>
      </div>

      <div className="s-cal-side">
        <section className="s-minical" aria-label={`${fmt(cursor, { month: 'long' })} overview`}>
          <h2 className="s-mini-title">{fmt(cursor, { month: 'long' })}</h2>
          <div className="s-mini-dow">{DOW.map((d, i) => <span key={i}>{d}</span>)}</div>
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

      <section className="s-week" aria-label="Schedule">
        {view === 'month' ? (
          <div className="s-month">
            {DOW.map((d, i) => <span key={i} className="s-month-dow">{['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][i]}</span>)}
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
            <div className="s-week-cols" style={{ gridTemplateColumns: `50px repeat(${days.length}, minmax(0, 1fr))` }}>
              <span />
              {days.map((d) => (
                <span key={d.toISOString()} className={`s-week-day${sameDay(d, new Date()) ? ' today' : ''}`}>
                  <span className="n">{fmt(d, { weekday: 'short' })}</span>
                  <span className="d">{d.getDate()}</span>
                </span>
              ))}
            </div>
            {allDay.length > 0 && (
              <div className="s-week-cols s-allday" style={{ gridTemplateColumns: `50px repeat(${days.length}, minmax(0, 1fr))` }}>
                <span className="lbl">All day</span>
                {days.map((d) => (
                  <span key={d.toISOString()} className="cell">
                    {allDay.filter((x) => sameDay(x.t.deadline, d)).map(({ t }) => { const c = toneFor(t); return <button key={t.id} type="button" className="ev" style={{ background: c.bg, color: c.fg }} onClick={() => openTask(t)}>{t.text}</button>; })}
                  </span>
                ))}
              </div>
            )}
            <div className="s-week-grid" style={{ gridTemplateColumns: `50px repeat(${days.length}, minmax(0, 1fr))`, height: total * 36 }}>
              <div className="s-hours">
                {hours.map((h, i) => <span key={h} style={{ top: `${(i / total) * 100}%` }}>{String(h).padStart(2, '0')}:00</span>)}
              </div>
              {days.map((d) => (
                <div key={d.toISOString()} className="s-daycol">
                  {sameDay(d, new Date()) && (() => { const now = new Date(); const pos = (now.getHours() + now.getMinutes() / 60 - first) / total; return pos > 0 && pos < 1 ? <span className="s-now" style={{ top: `${pos * 100}%` }} /> : null; })()}
                  {layout(d).map(({ t, s, lane, lanes }) => {
                    const c = toneFor(t);
                    return (
                      <button
                        key={t.id}
                        type="button"
                        className={`s-ev${t.completed ? ' done' : ''}${s.end - s.start < 1.25 ? ' short' : ''}`}
                        style={{
                          top: `calc(${((s.start - first) / total) * 100}% + 2px)`,
                          height: `calc(${((s.end - s.start) / total) * 100}% - 4px)`,
                          left: `calc(${(lane / lanes) * 100}% + 4px)`,
                          width: `calc(${100 / lanes}% - 8px)`,
                          background: c.bg,
                          color: c.fg,
                        }}
                        onClick={() => openTask(t)}
                        title={t.text}
                      >
                        <span className="t">{t.text}</span>
                        <span className="m">{timeOf(t)}{t.endTime ? ` – ${t.endTime}` : ''}</span>
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          </>
        )}
      </section>
    </div>
  );
}

import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { todosAPI, calSyncAPI, workspacesAPI } from '../api';
import { useCurrentSpace } from './spaces';
import QuickCreate from './QuickCreate';
import { AgendaView, FindSlot, PeekPanel, YearView } from './CalExtras';
import UndoToast from '../components/UndoToast';
import { useUndoToast } from '../utils/useUndoToast';
import NewMeeting from '../components/NewMeeting';
import TimeGrid from '../components/TimeGrid';
import { useAuth } from '../context/AuthContext';
import { COUNTRIES, makeHolidayLookup } from './holidays';
import { exportCalendar, importCalendar } from '../river/calendarIO';
import { startOfWeek, weekdayNames } from '../utils/weekStart';
import { startOfDay, addDays, sameDay, daysFromToday, spanOf, timeOf, toneOf, tagsOf, weekdayLong } from './softUtils';

const DOW = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
// Left accent bar colour per pastel tone (mockup: Calendar.dc.html)
const BAR = { peach: '#c4441c', sky: '#3b7bbf', lilac: '#7b52b8', mint: '#2d9d6a', butter: '#d19a12' };
const fmt = (d, o) => new Date(d).toLocaleDateString('en-GB', o);

/** Soft Studio · Calendar (mockup: SoftCalendar). Week view with a mini month and a countdown. */
export default function SoftCalendar() {
  const navigate = useNavigate();
  const { settings, updateSettings } = useAuth();
  const hol = { on: true, country: 'IN', festivals: true, observances: false, ...(settings?.holidays || {}) };
    const lookupHol = useMemo(() => makeHolidayLookup(hol), [hol.on, hol.country, hol.festivals, hol.observances]); // eslint-disable-line react-hooks/exhaustive-deps
  const setHol = (patch) => updateSettings({ holidays: { ...hol, ...patch } });
  const [view, setView] = useState(() => (typeof window !== 'undefined' && window.matchMedia?.('(max-width: 700px)').matches ? 'day' : 'week')); // phones open on Day
  const [fileMenu, setFileMenu] = useState(false);
  const fileRef = useRef(null);
  const [cursor, setCursor] = useState(() => startOfDay());
  const qc = useQueryClient();
  const { toast, say, dismiss } = useUndoToast();
  const [quick, setQuick] = useState(null);
  const [peek, setPeek] = useState(null);
  const [dropDay, setDropDay] = useState(null);
  const [layers, setLayers] = useState({ tasks: true, meetings: true, done: true });
  // Layers of calendar links (Calendar sync): which are switched off is remembered on this device
  const [offFeeds, setOffFeeds] = useState(() => { try { return JSON.parse(localStorage.getItem('peblo-cal-layers') || '[]'); } catch { return []; } });
  const toggleFeed = (id) => setOffFeeds((o) => { const n = o.includes(id) ? o.filter((x) => x !== id) : [...o, id]; try { localStorage.setItem('peblo-cal-layers', JSON.stringify(n)); } catch { /* not remembered */ } return n; });

  const weekStart = startOfWeek(cursor);
  const monthStart = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const gridStart = startOfWeek(monthStart);
  const from = addDays(gridStart < weekStart ? gridStart : weekStart, -1); // one day back so an event past midnight shows its tail
  const to = addDays(from, 62);

  const { data: todos = [], isError } = useQuery({
    queryKey: ['todos', 'range', 'soft-cal', from.toDateString()],
    queryFn: () => todosAPI.getRange(from.toISOString(), to.toISOString()).then((r) => r.data.todos || []),
  });
  const { data: yearTodos = [] } = useQuery({
    queryKey: ['todos', 'range', 'soft-cal-year', cursor.getFullYear()],
    queryFn: () => todosAPI.getRange(new Date(cursor.getFullYear(), 0, 1).toISOString(), new Date(cursor.getFullYear() + 1, 0, 1).toISOString()).then((r) => r.data.todos || []),
    enabled: view === 'year',
  });
  const { data: ahead = [] } = useQuery({
    queryKey: ['todos', 'range', 'soft-cal-ahead', startOfDay().toDateString()],
    queryFn: () => todosAPI.getRange(startOfDay().toISOString(), addDays(startOfDay(), 60).toISOString()).then((r) => r.data.todos || []),
  });

  const inSpace = useCurrentSpace();
  const { data: teamEvents = [] } = useQuery({
    queryKey: ['cal-team', from.toDateString()],
    enabled: !inSpace,
    staleTime: 60000,
    queryFn: () => workspacesAPI.teamRange(from.toISOString(), to.toISOString()).then((r) => r.data.events || []),
  });
  const { data: ownFeedEvents = [] } = useQuery({
    queryKey: ['cal-sync', 'events', from.toDateString()],
    queryFn: () => calSyncAPI.events(from.toISOString().slice(0, 10), to.toISOString().slice(0, 10)).then((r) => r.data.events || []),
    staleTime: 60000,
  });
  const feedEvents = useMemo(() => [...ownFeedEvents, ...(inSpace ? [] : teamEvents)], [ownFeedEvents, teamEvents, inSpace]);
  const feedList = useMemo(() => { const m = new Map(); feedEvents.forEach((e) => m.set(e.feedId, { id: e.feedId, name: e.feed, color: e.color })); return [...m.values()]; }, [feedEvents]);
  const feedShown = feedEvents.filter((e) => !offFeeds.includes(e.feedId));

  const nextBig = useMemo(() => {
    const open = ahead.filter((t) => !t.completed && t.deadline && new Date(t.deadline) >= new Date()).sort((a, b) => new Date(a.deadline) - new Date(b.deadline));
    return open.find((t) => t.priority === 'high') || open[0] || null;
  }, [ahead]);

  const days = view === 'day' ? [cursor] : Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  // All 24 hours are always in the grid (TimeGrid scrolls inside itself). Events that run past midnight continue on the next day.
  const openTask = (t) => setPeek(t);
  const goTask = (t) => (t.note?.id ? navigate(`/notes/${t.note.id}`) : navigate('/tasks'));
  const isMeeting = (t) => !!(t.startTime && t.endTime);
  const shown = todos.filter((t) => (isMeeting(t) ? layers.meetings : layers.tasks) && (layers.done || !t.completed));
  const spans = shown.filter((t) => t.deadline).map((t) => ({ t, s: timeOf(t) ? spanOf(t) : null }));
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
  const feedTone = (e) => ({ bg: `var(--s-${e.color === 'rose' ? 'peach' : e.color})`, fg: 'var(--s-fg)', bar: BAR[e.color === 'rose' ? 'peach' : e.color] || BAR.sky });
  for (const d of days) {
    for (const e of feedShown) {
      if (e.allDay) continue;
      const st = new Date(e.start), en = new Date(e.end);
      if (!sameDay(st, d)) continue;
      const sh = st.getHours() + st.getMinutes() / 60; const eh = Math.max(sh + 0.5, Math.min(24, sh + (en - st) / 3600000));
      const c = feedTone(e);
      gridEvents.push({ id: `feed-${e.feedId}-${e.uid}-${e.start}`, title: e.title, meta: `${e.feed} · ${String(st.getHours()).padStart(2, '0')}:${String(st.getMinutes()).padStart(2, '0')}`, bg: c.bg, fg: c.fg, bar: c.bar, day: d, start: sh, end: eh, props: { 'data-feed': e.feed, title: `${e.title} (${e.feed})` } });
    }
  }
  const feedAllDay = days.flatMap((d) => feedShown.filter((e) => e.allDay && e.start <= d.toLocaleDateString('en-CA') && d.toLocaleDateString('en-CA') < e.end).map((e) => { const c = feedTone(e); return { id: `feedad-${e.feedId}-${e.uid}-${e.start}-${d.toDateString()}`, day: d, title: e.title, bg: c.bg, fg: c.fg, bar: 'transparent', props: { 'data-feed': e.feed, tabIndex: -1, title: `${e.title} (${e.feed})` } }; }));
  const gridAllDay = allDay.flatMap(({ t }) => days.filter((d) => sameDay(t.deadline, d)).map((d) => { const c = toneFor(t); return { id: t.id, day: d, title: t.text, bg: c.bg, fg: c.fg, bar: c.bar, done: t.completed, props: { onClick: () => openTask(t) } }; }));

  // Drag to a new time or day, or drag the bottom edge: save at once, show it at once, and offer Undo
  const pad2 = (n) => String(n).padStart(2, '0');
  const hm = (h) => { const m = Math.min(24 * 60 - 1, Math.round(h * 60)); return `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`; };
  const patchCache = (id, patch) => qc.setQueriesData({ queryKey: ['todos', 'range'] }, (old) => (Array.isArray(old) ? old.map((t) => (t.id === id ? { ...t, ...patch } : t)) : old));
  const onMove = async (ev, day, start, end) => {
    const t = todos.find((x) => x.id === ev.id);
    if (!t) return;
    const before = { deadline: t.deadline, startTime: t.startTime || null, endTime: t.endTime || null };
    const [sh, sm] = hm(start).split(':').map(Number);
    const after = { deadline: (t.startTime ? new Date(day.getFullYear(), day.getMonth(), day.getDate()) : new Date(day.getFullYear(), day.getMonth(), day.getDate(), sh, sm)).toISOString(), startTime: hm(start), endTime: hm(end) };
    patchCache(t.id, after);
    try {
      await todosAPI.update(t.id, after);
      qc.invalidateQueries({ queryKey: ['todos'] });
      say(`Moved "${t.text.length > 30 ? `${t.text.slice(0, 30)}...` : t.text}" to ${hm(start)}`, async () => { patchCache(t.id, before); await todosAPI.update(t.id, before); qc.invalidateQueries({ queryKey: ['todos'] }); });
    } catch {
      qc.invalidateQueries({ queryKey: ['todos'] });
      say('Could not move it. Nothing changed.');
    }
  };

  // Month view: drag an item onto another day, it keeps its time
  const moveToDay = async (id, day) => {
    const t = todos.find((x) => x.id === id);
    if (!t || sameDay(t.deadline, day)) return;
    const old = new Date(t.deadline);
    const next = t.startTime ? new Date(day.getFullYear(), day.getMonth(), day.getDate()) : new Date(day.getFullYear(), day.getMonth(), day.getDate(), old.getHours(), old.getMinutes());
    const before = { deadline: t.deadline };
    patchCache(t.id, { deadline: next.toISOString() });
    try {
      await todosAPI.update(t.id, { deadline: next.toISOString() });
      qc.invalidateQueries({ queryKey: ['todos'] });
      say(`Moved "${t.text.length > 30 ? `${t.text.slice(0, 30)}...` : t.text}" to ${fmt(day, { weekday: 'short', day: 'numeric', month: 'short' })}`, async () => { patchCache(t.id, before); await todosAPI.update(t.id, before); qc.invalidateQueries({ queryKey: ['todos'] }); });
    } catch { qc.invalidateQueries({ queryKey: ['todos'] }); say('Could not move it. Nothing changed.'); }
  };
  const toggleDone = async (t) => {
    setPeek(null);
    try { await todosAPI.update(t.id, { completed: !t.completed }); qc.invalidateQueries({ queryKey: ['todos'] }); say(t.completed ? 'Reopened' : 'Marked done', async () => { await todosAPI.update(t.id, { completed: t.completed }); qc.invalidateQueries({ queryKey: ['todos'] }); }); } catch { say('Could not save that.'); }
  };

  const move = (dir) => setCursor((c) => (view === 'year' ? new Date(c.getFullYear() + dir, c.getMonth(), 1) : view === 'month' ? new Date(c.getFullYear(), c.getMonth() + dir, 1) : addDays(c, dir * (view === 'day' ? 1 : 7))));
  const title = view === 'year' ? String(cursor.getFullYear()) : view === 'agenda' ? 'Agenda' : view === 'day' ? (sameDay(cursor, new Date()) ? 'Today' : weekdayLong(cursor)) : view === 'month' ? fmt(cursor, { month: 'long' }) : (sameDay(weekStart, addDays(startOfDay(), -startOfDay().getDay())) ? 'This week' : `Week of ${fmt(weekStart, { day: 'numeric', month: 'short' })}`);
  const range = view === 'year' ? 'How busy each day is' : view === 'day' ? fmt(cursor, { day: 'numeric', month: 'long', year: 'numeric' })
    : view === 'month' ? fmt(cursor, { year: 'numeric' })
      : `${fmt(weekStart, { day: 'numeric', month: 'long' })} – ${fmt(addDays(weekStart, 6), { day: 'numeric', month: 'long' })}`;

  // Mini month (follows the cursor)
  const miniStart = gridStart;
  const busy = new Set(todos.filter((t) => t.deadline && !t.completed).map((t) => startOfDay(t.deadline).toDateString()));
  // Only this month's days are shown; weeks that are entirely next month are dropped
  const mini = Array.from({ length: 42 }, (_, i) => addDays(miniStart, i)).filter((d, i) => d.getMonth() === cursor.getMonth() || i < 7 || addDays(miniStart, i - (i % 7)).getMonth() === cursor.getMonth());

  const bigDays = nextBig ? daysFromToday(nextBig.deadline) : null;

  const holAllDay = days.flatMap((d) => lookupHol(d).map((h, i) => ({ id: `hol-${d.toDateString()}-${i}`, day: d, title: h.name, bg: h.kind === 'public' ? 'var(--s-peach)' : h.kind === 'festival' ? 'var(--s-butter)' : 'var(--s-sky)', fg: 'var(--s-fg)', bar: 'transparent', props: { 'data-holiday': h.kind, tabIndex: -1, title: `${h.name} (${h.kind === 'public' ? 'public holiday' : h.kind})` } })));

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
        <div style={{ position: 'relative' }}>
          <button type="button" className="s-pill46" aria-haspopup="menu" aria-expanded={fileMenu} onClick={() => setFileMenu((v) => !v)}>Calendar file</button>
          {fileMenu && (
            <div className="s-menu" role="menu" onMouseLeave={() => setFileMenu(false)}>
              <button type="button" role="menuitem" onClick={() => { setFileMenu(false); fileRef.current?.click(); }}>Import .ics</button>
              <button type="button" role="menuitem" onClick={() => { setFileMenu(false); exportCalendar().then((n) => say(`Downloaded ${n} item${n === 1 ? '' : 's'} (.ics)`)).catch(() => say('Could not export')); }}>Export .ics</button>
              <button type="button" role="menuitem" onClick={() => { setFileMenu(false); window.print(); }}>Print this view</button>
              <button type="button" role="menuitem" onClick={() => { setFileMenu(false); navigate('/calendar/sync'); }}>Calendar sync</button>
            </div>
          )}
          <input ref={fileRef} type="file" accept=".ics,text/calendar" hidden data-testid="ics-input" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) importCalendar(f).then((r) => { say(`Added ${r.added} meeting${r.added === 1 ? '' : 's'}${r.skipped ? `, skipped ${r.skipped}` : ''}`); qc.invalidateQueries({ queryKey: ['todos'] }); }).catch(() => say('Could not read that file')); }} />
        </div>
        <NewMeeting className="s-pill46" day={cursor} />
        <div className="s-seg small" role="tablist" aria-label="View">
          {['day', 'week', 'month', 'agenda', 'year'].map((v) => (
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
        <div className="s-layers" role="group" aria-label="Layers">
          {[['tasks', 'Tasks', '#E8825E'], ['meetings', 'Meetings', '#6FA8DC'], ['done', 'Done', '#7BC59A']].map(([k, label, c]) => (
            <button key={k} type="button" aria-pressed={layers[k]} onClick={() => setLayers((l) => ({ ...l, [k]: !l[k] }))}><i style={{ background: c }} />{label}</button>
          ))}
          {feedList.map((f) => (
            <button key={f.id} type="button" aria-pressed={!offFeeds.includes(f.id)} data-feed-layer={f.name} onClick={() => toggleFeed(f.id)}><i style={{ background: BAR[f.color === 'rose' ? 'peach' : f.color] || BAR.sky }} />{f.name}</button>
          ))}
          <button type="button" role="switch" aria-checked={hol.on} aria-label="Show holidays" aria-pressed={hol.on} onClick={() => setHol({ on: !hol.on })}><i style={{ background: '#E5B53C' }} />Holidays</button>
        </div>
        {hol.on && (
          <div className="s-hol" role="group" aria-label="Holidays">
            <select aria-label="Holiday country" value={hol.country} onChange={(e) => setHol({ country: e.target.value })}>{COUNTRIES.map(([c, n]) => <option key={c} value={c}>{n}</option>)}</select>
            <button type="button" aria-pressed={hol.festivals} onClick={() => setHol({ festivals: !hol.festivals })}>Festivals</button>
            <button type="button" aria-pressed={hol.observances} onClick={() => setHol({ observances: !hol.observances })}>Observances</button>
          </div>
        )}
        <FindSlot todos={todos} from={new Date()} onPick={(s) => setQuick({ day: s.day, start: s.start, end: s.end })} />
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
      <section className={`s-week${view === 'month' || view === 'year' ? '' : ' is-grid'}`} aria-label="Schedule">
        {view === 'year' ? (
          <YearView todos={yearTodos} year={cursor.getFullYear()} mondayFirst={startOfWeek(new Date(2026, 10, 8)).getDay() === 1} onPick={(d) => { setCursor(d); setView('day'); }} />
        ) : view === 'agenda' ? (
          <AgendaView todos={shown} from={startOfDay()} toneFor={toneFor} onPick={openTask} />
        ) : view === 'month' ? (
          <div className="s-month">
            {weekdayNames(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']).map((d, i) => <span key={i} className="s-month-dow">{d}</span>)}
            {Array.from({ length: 42 }, (_, i) => addDays(gridStart, i)).map((d) => {
              const items = shown.filter((t) => t.deadline && sameDay(t.deadline, d));
              return (
                <button
                  key={d.toISOString()}
                  type="button"
                  className={`s-month-cell${d.getMonth() === cursor.getMonth() ? '' : ' out'}${sameDay(d, new Date()) ? ' today' : ''}${dropDay && sameDay(dropDay, d) ? ' drop' : ''}`}
                  onClick={() => { setCursor(startOfDay(d)); setView('day'); }}
                  onDragOver={(e) => { e.preventDefault(); setDropDay(d); }}
                  onDragLeave={() => setDropDay(null)}
                  onDrop={(e) => { e.preventDefault(); setDropDay(null); const id = e.dataTransfer.getData('text/peblo-todo'); if (id) moveToDay(id, d); }}
                >
                  <span className="n">{d.getDate()}</span>
                  {lookupHol(d).slice(0, 1).map((h) => <span key={h.name} className={`s-hol-chip ${h.kind}`} data-holiday={h.kind} title={h.name}>{h.name}</span>)}
                  {items.slice(0, lookupHol(d).length ? 2 : 3).map((t) => { const c = toneFor(t); return <span key={t.id} className={`ev${t.completed ? ' done' : ''}`} style={{ background: c.bg, color: c.fg, cursor: 'grab' }} draggable onDragStart={(e) => { e.dataTransfer.setData('text/peblo-todo', t.id); e.dataTransfer.effectAllowed = 'move'; }}>{t.text}</span>; })}
                  {items.length > (lookupHol(d).length ? 2 : 3) && <span className="more">+{items.length - (lookupHol(d).length ? 2 : 3)}</span>}
                </button>
              );
            })}
          </div>
        ) : (
          <>
            <TimeGrid days={days} events={gridEvents} allDay={[...holAllDay, ...feedAllDay, ...gridAllDay]} headClass="s-week-day" onToday={() => setCursor(startOfDay())} onMove={onMove} onCreate={(day, start, end) => setQuick({ day, start, end })} label="Schedule" />
          </>
        )}
      </section>
      {peek && <PeekPanel t={peek} onClose={() => setPeek(null)} onOpen={(t) => { setPeek(null); goTask(t); }} onDone={toggleDone} />}
      {quick && <QuickCreate anchor={quick} todos={todos} onClose={() => setQuick(null)} onSay={say} />}
      <UndoToast toast={toast} dismiss={dismiss} />
    </div>
  );
}

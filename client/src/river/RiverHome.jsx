import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { todosAPI, notesAPI, riverAPI, hubAPI } from '../api';
import { RiverHeader, useDismiss } from './RiverShell';
import RiverDrawer from './RiverDrawer';
import {
  ZOOMS, DAY_START, DAY_END, dayWidth, rangeStart, rangeWidth, xOf,
  startOfDay, addDays, sameDay, momentOf, endOf, dueMomentOf, isMeeting, isAllDay,
  clock, clockRange, dayWord, fromNow, stack, kindOf,
} from './riverUtils';

const PAD = 14;
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function useNow() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(id);
  }, []);
  return now;
}

/** The moment at a horizontal position (time zooms only), rounded to 15 minutes. */
function timeAt(x, z, start) {
  const dw = dayWidth(z);
  const day = Math.floor(x / dw);
  const within = x - day * dw;
  const awake = (DAY_END - DAY_START) * z.pxh;
  const h = within <= awake ? DAY_START + within / z.pxh : DAY_END + ((within - awake) / z.night) * (24 - (DAY_END - DAY_START));
  const d = addDays(start, day);
  const mins = Math.round((h * 60) / 15) * 15;
  d.setHours(0, 0, 0, 0);
  d.setMinutes(mins);
  return d;
}

/**
 * River · Home (mockup: RiverHome). One timeline, past to future: meetings, tasks,
 * notes and Peblo's suggestions in lanes, and the selected thing in the drawer below.
 * Tasks and Calendar open this same screen.
 */
export default function RiverHome({ initialZoom = 'day' }) {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const now = useNow();
  const [zoom, setZoom] = useState(() => {
    try { return localStorage.getItem('peblo-river-zoom') || initialZoom; } catch { return initialZoom; }
  });
  const [selId, setSelId] = useState(null);
  const [quick, setQuick] = useState(null); // { lane, x, at }
  const [undatedOpen, setUndatedOpen] = useState(false); // false or { left, top } inside the frame
  const [toast, setToast] = useState('');
  const scrollRef = useRef(null);
  const drag = useRef(null);

  const z = ZOOMS[zoom];
  const today = startOfDay(now);
  const todayKey = today.toDateString();
  const start = useMemo(() => rangeStart(z, today), [zoom, todayKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const end = useMemo(() => addDays(start, z.back + z.ahead + 7), [start, z]);
  const width = rangeWidth(z, start) + PAD * 2;
  const X = useCallback((d) => PAD + xOf(d, z, start), [z, start]);

  const setZoomSaved = (k) => {
    setZoom(k);
    try { localStorage.setItem('peblo-river-zoom', k); } catch { /* ignore */ }
  };
  useEffect(() => { if (initialZoom !== 'day') setZoom(initialZoom); }, [initialZoom]);

  // ---------- data ----------
  const { data: todos = [] } = useQuery({
    queryKey: ['todos', 'range', 'river', start.toISOString(), end.toISOString()],
    queryFn: () => todosAPI.getRange(start.toISOString(), end.toISOString()).then((r) => r.data.todos || []),
  });
  const { data: openTodos = [] } = useQuery({
    queryKey: ['todos', 'river-undated'],
    queryFn: () => todosAPI.getAll({ completed: 'false' }).then((r) => r.data.todos || []),
  });
  const { data: notes = [] } = useQuery({
    queryKey: ['notes', 'sidebar'],
    queryFn: () => notesAPI.getAll({ sort: 'updated' }).then((r) => r.data.notes || []),
  });
  const { data: promiseData } = useQuery({
    queryKey: ['river', 'promises'],
    queryFn: () => riverAPI.promises().then((r) => r.data.promises || []),
  });
  const { data: models } = useQuery({ queryKey: ['hub-models'], queryFn: () => hubAPI.models().then((r) => r.data), staleTime: 30000 });

  const undated = openTodos.filter((t) => !t.deadline);
  const meetings = useMemo(() => todos.filter(isMeeting), [todos]);
  const tasks = useMemo(() => todos.filter((t) => t.deadline && !t.startTime), [todos]);
  const visibleNotes = useMemo(() => notes.filter((n) => {
    const c = new Date(n.createdAt);
    return c >= start && c <= end;
  }), [notes, start, end]);
  const promises = useMemo(() => {
    const out = [];
    for (const g of promiseData || []) {
      g.items.forEach((p, index) => {
        if (p.status !== 'open') return;
        const note = notes.find((n) => n.id === g.noteId);
        out.push({ ...p, genId: g.id, index, noteId: g.noteId, noteTitle: g.noteTitle, at: p.due ? new Date(p.due) : note ? new Date(note.createdAt) : null });
      });
    }
    return out.filter((p) => p.at && p.at >= start && p.at <= end);
  }, [promiseData, notes, start, end]);

  // The next thing coming up, for the header and the default selection
  const nextMeeting = useMemo(() => meetings
    .filter((t) => !t.completed && endOf(t) > now)
    .sort((a, b) => momentOf(a) - momentOf(b))[0], [meetings, now]);
  const nextTask = useMemo(() => tasks
    .filter((t) => !t.completed && dueMomentOf(t) > now)
    .sort((a, b) => dueMomentOf(a) - dueMomentOf(b))[0], [tasks, now]);
  const nextUp = [nextMeeting && { at: momentOf(nextMeeting), t: nextMeeting }, nextTask && { at: dueMomentOf(nextTask), t: nextTask }]
    .filter(Boolean).sort((a, b) => a.at - b.at)[0];

  const allTodos = useMemo(() => {
    const m = new Map();
    for (const t of [...todos, ...undated]) m.set(t.id, t);
    return m;
  }, [todos, undated]);
  const selected = (selId && allTodos.get(selId)) || null;
  useEffect(() => {
    if (!selId && nextUp) setSelId(nextUp.t.id);
  }, [nextUp?.t.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Other screens can open the river on one thing: navigate('/', { state: { select: id } })
  const wanted = location.state?.select;
  useEffect(() => {
    if (!wanted) return;
    const t = allTodos.get(wanted);
    if (!t) return;
    setSelId(wanted);
    const at = isMeeting(t) ? momentOf(t) : dueMomentOf(t);
    if (at) setTimeout(() => scrollTo(at), 80);
    navigate('.', { replace: true, state: null });
  }, [wanted, allTodos]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- scrolling ----------
  const scrollTo = useCallback((date, smooth = true) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ left: Math.max(0, X(date) - el.clientWidth * 0.4), behavior: smooth ? 'smooth' : 'auto' });
  }, [X]);
  useLayoutEffect(() => { scrollTo(new Date(), false); }, [zoom]); // eslint-disable-line react-hooks/exhaustive-deps

  const onWheel = (e) => {
    const el = scrollRef.current;
    // Ctrl + wheel is the browser's zoom gesture, which the app ignores: don't scroll either
    if (!el || e.ctrlKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
    el.scrollLeft += e.deltaY;
  };
  const onPointerDown = (e) => {
    if (e.button !== 0 || e.target.closest('button, a, input, label, .r-quick')) return;
    drag.current = { x: e.clientX, left: scrollRef.current.scrollLeft, moved: false };
  };
  const onPointerMove = (e) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    if (Math.abs(dx) > 4) {
      d.moved = true;
      scrollRef.current.classList.add('dragging');
    }
    if (d.moved) scrollRef.current.scrollLeft = d.left - dx;
  };
  const onPointerUp = () => {
    drag.current = null;
    scrollRef.current?.classList.remove('dragging');
  };

  // ---------- actions ----------
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['todos'] });
    queryClient.invalidateQueries({ queryKey: ['dashboard'] });
  };
  const flash = (msg) => { setToast(msg); setTimeout(() => setToast(''), 2400); };
  const toggle = async (t) => {
    queryClient.setQueriesData({ queryKey: ['todos', 'range', 'river'] }, (old) => (Array.isArray(old) ? old.map((x) => (x.id === t.id ? { ...x, completed: !x.completed, updatedAt: new Date().toISOString() } : x)) : old));
    await todosAPI.update(t.id, { completed: !t.completed });
    refresh();
  };

  const onLaneDoubleClick = (lane) => (e) => {
    if (z.mode !== 'time' || e.target.closest('button, a, input, label, .r-quick')) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const at = timeAt(x - PAD, z, start);
    setQuick({ lane, x, at });
  };

  const addPromise = async (p) => {
    let due = p.due ? new Date(p.due) : null;
    if (!due) { due = addDays(startOfDay(), 1); due.setHours(9, 0, 0, 0); }
    const { data } = await todosAPI.create({ text: p.owner && p.owner.toLowerCase() !== 'you' ? `${p.text} (${p.owner})` : p.text, deadline: due.toISOString(), noteId: p.noteId, priority: 'medium' });
    await riverAPI.setPromise(p.genId, p.index, 'added', data.todo?.id);
    queryClient.invalidateQueries({ queryKey: ['river', 'promises'] });
    refresh();
    flash(`On the river · due ${dayWord(due)}, ${clock(due)}`);
  };
  const dismissPromise = async (p) => {
    await riverAPI.setPromise(p.genId, p.index, 'ignored');
    queryClient.invalidateQueries({ queryKey: ['river', 'promises'] });
  };

  const scheduleUndated = async (t, dayOffset) => {
    const d = addDays(startOfDay(), dayOffset);
    d.setHours(23, 59, 0, 0);
    await todosAPI.update(t.id, { deadline: d.toISOString() });
    refresh();
    flash(`Moved to ${dayWord(d).toLowerCase()}`);
  };

  // ---------- brief for the next meeting (Peblo lane) ----------
  const briefFor = nextMeeting && (momentOf(nextMeeting) - now < 36 * 3600000) ? nextMeeting : null;
  const briefKey = ['river', 'brief', briefFor?.id];
  const brief = useQuery({ queryKey: briefKey, queryFn: () => riverAPI.brief(briefFor.id).then((r) => r.data), enabled: false, staleTime: Infinity, retry: false });
  const aiReady = !!(models?.local?.enabled && models.local.ok) || (models?.cloud || []).some((c) => c.configured);

  // ---------- header ----------
  const sub = nextUp
    ? `${clock(now)} · next up ${fromNow(nextUp.at)}`
    : `${clock(now)} · nothing else planned`;

  // ---------- jump ----------
  const [q, setQ] = useState('');
  const [jumpOpen, setJumpOpen] = useState(false);
  const jumpRef = useDismiss(jumpOpen, () => setJumpOpen(false));
  const results = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return [];
    const out = [];
    const dayHit = [['today', 0], ['tomorrow', 1], ['yesterday', -1]].find(([w]) => w.startsWith(s));
    if (dayHit) out.push({ kind: 'DAY', title: dayHit[0][0].toUpperCase() + dayHit[0].slice(1), at: addDays(today, dayHit[1]) });
    DOW.forEach((d, i) => {
      if (s.length >= 3 && d.toLowerCase().startsWith(s.slice(0, 3)) && 'monday tuesday wednesday thursday friday saturday sunday'.includes(s)) {
        const diff = (i - today.getDay() + 7) % 7 || 7;
        out.push({ kind: 'DAY', title: `Next ${d}`, at: addDays(today, diff) });
      }
    });
    for (const t of [...todos, ...undated]) if (t.text.toLowerCase().includes(s)) out.push({ kind: isMeeting(t) ? 'MEETING' : 'TASK', title: t.text, at: dueMomentOf(t), todo: t });
    for (const n of notes) if ((n.title || '').toLowerCase().includes(s)) out.push({ kind: 'NOTE', title: n.title || 'Untitled', at: new Date(n.createdAt), note: n });
    return out.slice(0, 8);
  }, [q, todos, undated, notes, today]);
  const pick = (r) => {
    setJumpOpen(false);
    setQ('');
    if (r.note) { navigate(`/notes/${r.note.id}`); return; }
    if (r.todo) setSelId(r.todo.id);
    if (r.at) {
      if (r.at < start || r.at > end) setZoomSaved('quarter');
      setTimeout(() => scrollTo(r.at), 50);
    }
  };

  // ---------- layout: time zooms ----------
  const lay = useMemo(() => {
    if (z.mode !== 'time') return null;
    const dw = dayWidth(z);
    const days = Math.round((end - start) / 86400000);
    const ticks = [];
    const nights = [];
    for (let i = 0; i < days; i++) {
      const d = addDays(start, i);
      const base = PAD + i * dw;
      for (let h = DAY_START; h < DAY_END; h++) {
        const first = h === DAY_START;
        const hh = h % 12 === 0 ? 12 : h % 12;
        const label = first ? `${DOW[d.getDay()]} ${d.getDate()} · ${hh} am` : zoom === 'hours' ? `${hh}:00 ${h < 12 ? 'am' : 'pm'}` : `${hh} ${h < 12 ? 'am' : 'pm'}`;
        ticks.push({ key: `${i}-${h}`, x: base + (h - DAY_START) * z.pxh, label, day: first, today: first && sameDay(d, today) });
      }
      nights.push({ key: i, x: base + (DAY_END - DAY_START) * z.pxh, w: z.night });
    }

    // Meetings
    const mItems = meetings.map((t) => {
      const s = momentOf(t);
      const e = endOf(t) || new Date(s.getTime() + 3600000);
      const x = X(s);
      return { t, x, w: Math.max(X(e) - x - 4, 44), s, e };
    });
    const mRows = Math.min(stack(mItems, 4), 3);
    const mH = (84 - (mRows - 1) * 4) / mRows;

    // Tasks
    const tItems = tasks.map((t) => {
      const due = dueMomentOf(t);
      const pin = X(due);
      return { t, due, pin, x: Math.max(PAD, pin - 182), w: 176 };
    });
    const tRows = Math.min(stack(tItems, 6), 3);
    const tH = tRows === 1 ? 66 : tRows === 2 ? 38 : 24;

    // Notes
    const nItems = visibleNotes.map((n) => ({ n, x: X(new Date(n.createdAt)), w: 170 }));
    const nRows = Math.min(stack(nItems, 6), 3);
    const nH = nRows === 1 ? 66 : nRows === 2 ? 38 : 24;

    return { ticks, nights, mItems, mRows, mH, tItems, tRows, tH, nItems, nRows, nH };
  }, [z, zoom, start, end, meetings, tasks, visibleNotes, X, today]);

  // ---------- layout: week and quarter ----------
  const bins = useMemo(() => {
    if (z.mode !== 'bins') return null;
    const per = z.bin === 'day' ? 1 : 7;
    const count = Math.ceil(Math.round((end - start) / 86400000) / per);
    const list = [];
    for (let i = 0; i < count; i++) {
      const from = addDays(start, i * per);
      const to = addDays(from, per);
      const inBin = (d) => d && d >= from && d < to;
      list.push({
        i, from, x: PAD + i * z.binW,
        today: today >= from && today < to,
        meet: meetings.filter((t) => inBin(momentOf(t))).sort((a, b) => momentOf(a) - momentOf(b)),
        tasks: tasks.filter((t) => inBin(dueMomentOf(t))).sort((a, b) => dueMomentOf(a) - dueMomentOf(b)),
        notes: visibleNotes.filter((n) => inBin(new Date(n.createdAt))),
        promises: promises.filter((p) => inBin(p.at)),
      });
    }
    return list;
  }, [z, start, end, meetings, tasks, visibleNotes, promises, today]);

  // Peblo lane cards (time zooms): a brief before the next meeting, then promises
  const pebloCards = useMemo(() => {
    if (z.mode !== 'time') return [];
    const cards = [];
    if (briefFor) {
      const x = Math.max(PAD, X(momentOf(briefFor)) - 262);
      cards.push({ key: 'brief', kind: 'brief', x, w: 250 });
    }
    for (const p of promises) cards.push({ key: `${p.genId}-${p.index}`, kind: 'promise', p, x: Math.max(PAD, X(p.at) - 150), w: 300 });
    cards.sort((a, b) => a.x - b.x);
    let edge = -Infinity;
    for (const c of cards) { c.x = Math.max(c.x, edge + 10); edge = c.x + c.w; }
    return cards;
  }, [z, briefFor, promises, X]);

  const nowX = X(now);
  const hotDue = (t, due) => !t.completed && due - now < 3 * 3600000;
  const dueText = (t, due) => {
    if (t.completed) return `done ${clock(t.updatedAt)}`;
    if (isAllDay(t)) return sameDay(due, now) ? 'due today' : `due ${dayWord(due)}`;
    return sameDay(due, now) ? `due ${clock(due)}` : `due ${dayWord(due)} ${clock(due)}`;
  };
  const shortDue = (t, due) => (t.completed ? 'done' : isAllDay(t) ? dayWord(due) : sameDay(due, now) ? clock(due) : `${DOW[due.getDay()]} ${clock(due)}`);
  const noteMeta = (n) => {
    const c = new Date(n.createdAt);
    const u = new Date(n.updatedAt);
    if (u - c > 10 * 60000) return sameDay(u, c) ? `edited ${clock(u)}` : `edited ${dayWord(u).toLowerCase()}`;
    return `written ${clock(c)}`;
  };

  const quickRef = useDismiss(!!quick, () => setQuick(null));
  const undatedRef = useDismiss(!!undatedOpen, () => setUndatedOpen(false));

  return (
    <>
      <RiverHeader
        tools={(
          <>
            <div className="r-jump" ref={jumpRef}>
              <label htmlFor="rv-jump" className="r-sr">Jump to</label>
              <input
                id="rv-jump"
                type="search"
                value={q}
                onChange={(e) => { setQ(e.target.value); setJumpOpen(true); }}
                onFocus={() => setJumpOpen(true)}
                onKeyDown={(e) => { if (e.key === 'Enter' && results[0]) pick(results[0]); }}
                placeholder="Jump to a meeting, note or day…"
                autoComplete="off"
              />
              {jumpOpen && q.trim() && (
                <div className="r-pop">
                  {results.length === 0 && <span className="empty">Nothing on the river matches.</span>}
                  {results.map((r, i) => (
                    <button key={i} type="button" onClick={() => pick(r)}>
                      <span className="kind">{r.kind}</span>
                      <span className="t">{r.title}</span>
                      {r.at && <span className="m">{dayWord(r.at)}</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div role="group" aria-label="Zoom" className="r-zoom">
              {Object.entries(ZOOMS).map(([k, v]) => (
                <button key={k} type="button" aria-pressed={zoom === k} onClick={() => setZoomSaved(k)}>{v.label}</button>
              ))}
            </div>
          </>
        )}
      >
        <div className="r-when">
          <h1>{now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}</h1>
          <span>{sub}</span>
        </div>
      </RiverHeader>

      <section aria-label="Your days as a timeline" className="r-river">
        <div className="r-labels">
          <span aria-hidden="true" />
          <span className="meet">MEETINGS</span>
          <div className="tasks">
            <span>TASKS</span>
            {undated.length > 0 && (
              <button
                type="button"
                className="r-undated"
                aria-expanded={!!undatedOpen}
                onClick={(e) => {
                  const frame = e.currentTarget.closest('.river').getBoundingClientRect();
                  const r = e.currentTarget.getBoundingClientRect();
                  setUndatedOpen(undatedOpen ? false : { left: r.left - frame.left, top: r.bottom - frame.top + 6 });
                }}
              >
                No date · {undated.length}
              </button>
            )}
          </div>
          <span className="notes">NOTES</span>
          <span className="peblo">PEBLO</span>
        </div>

        <div
          className="r-scroll"
          ref={scrollRef}
          onWheel={onWheel}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerUp}
        >
          <div className="r-track" style={{ width }}>
            <div className="r-band-past" style={{ width: nowX }} />
            {lay && lay.nights.map((n) => (
              <div key={n.key} className="r-band-night" style={{ left: n.x, width: n.w }}><span>NIGHT</span></div>
            ))}
            {bins && bins.map((b) => b.today && <div key={b.i} className="r-band-today" style={{ left: b.x, width: z.binW }} />)}
            {bins && bins.map((b) => <div key={`l${b.i}`} className="r-bin-line" style={{ left: b.x }} />)}

            {/* time labels */}
            <div className="r-lane ticks">
              {lay && lay.ticks.map((k) => (
                <span key={k.key} className={`r-tick${k.day ? ' day' : ''}${k.today ? ' today' : ''}`} style={{ left: k.x }}>{k.label}</span>
              ))}
              {bins && bins.map((b) => (
                <button
                  key={b.i}
                  type="button"
                  className={`r-tick btn${b.today ? ' day today' : b.from.getDate() === 1 || z.bin === 'day' ? ' day' : ''}`}
                  style={{ left: b.x + 10 }}
                  onClick={() => { setZoomSaved('day'); setTimeout(() => scrollTo(new Date(b.from.getTime() + 10 * 3600000)), 60); }}
                  title="Open this in Day"
                >
                  {z.bin === 'day'
                    ? `${DOW[b.from.getDay()]} ${b.from.getDate()}${b.today ? ' · today' : ''}`
                    : `Week of ${b.from.getDate()} ${b.from.toLocaleDateString('en-GB', { month: 'short' })}`}
                </button>
              ))}
            </div>

            {/* meetings */}
            <div className="r-lane meet" onDoubleClick={onLaneDoubleClick('meeting')}>
              {lay && lay.mItems.filter((m) => m.row < 3).map((m) => {
                const kind = kindOf(m.t);
                const slim = lay.mH < 40;
                return (
                  <button
                    key={m.t.id}
                    type="button"
                    className={`r-meet ${kind}${m.e < now ? ' past' : ''}${selId === m.t.id ? ' sel' : ''}${slim ? ' slim' : ''}${m.w < 90 ? ' narrow' : ''}`}
                    style={{ left: m.x, width: m.w, top: 14 + m.row * (lay.mH + 4), height: lay.mH }}
                    onClick={() => setSelId(m.t.id)}
                    title={`${m.t.text} · ${clockRange(m.s, m.e)}`}
                  >
                    <span className="t">{m.t.text}</span>
                    <span className="m">{clockRange(m.s, m.e)}</span>
                  </button>
                );
              })}
              {bins && bins.map((b) => (
                <BinChips
                  key={b.i}
                  x={b.x}
                  w={z.binW}
                  items={b.meet}
                  render={(t, top) => (
                    <button key={t.id} type="button" className={`r-chip ${kindOf(t)}${selId === t.id ? ' sel' : ''}`} style={{ left: b.x + 6, width: z.binW - 12, top }} onClick={() => setSelId(t.id)} title={t.text}>
                      {z.bin === 'day' && <span className="tm">{clock(momentOf(t))}</span>}
                      <span>{t.text}</span>
                    </button>
                  )}
                  max={z.bin === 'day' ? 3 : 2}
                  onMore={() => { setZoomSaved('day'); setTimeout(() => scrollTo(new Date(b.from.getTime() + 10 * 3600000)), 60); }}
                />
              ))}
              {quick && quick.lane === 'meeting' && (
                <QuickAdd refEl={quickRef} quick={quick} mode="meeting" onDone={() => setQuick(null)} />
              )}
            </div>

            {/* tasks */}
            <div className="r-lane tasks" onDoubleClick={onLaneDoubleClick('task')}>
              {lay && lay.tItems.filter((k) => k.row < 3).map((k) => {
                const slim = lay.tRows > 1;
                const top = lay.tRows === 1 ? 18 : lay.tRows === 2 ? 12 + k.row * 42 : 10 + k.row * 28;
                return (
                  <div key={k.t.id}>
                    <div className={`r-task${k.t.completed ? ' done' : ''}${selId === k.t.id ? ' sel' : ''}${slim ? ' slim' : ''}`} style={{ left: k.x, top, height: lay.tH }}>
                      <input type="checkbox" checked={!!k.t.completed} onChange={() => toggle(k.t)} aria-label={`Done: ${k.t.text}`} />
                      <button type="button" onClick={() => setSelId(k.t.id)}>
                        <span className="t">{k.t.text}</span>
                        {lay.tRows < 3 && <span className={`m${hotDue(k.t, k.due) ? ' hot' : ''}`}>{slim ? shortDue(k.t, k.due) : dueText(k.t, k.due)}</span>}
                      </button>
                    </div>
                    <span className={`r-pin${k.t.completed ? ' done' : ''}`} style={{ left: k.pin - 6, top: 46 }} />
                  </div>
                );
              })}
              {bins && bins.map((b) => (
                <BinChips
                  key={b.i}
                  x={b.x}
                  w={z.binW}
                  items={b.tasks}
                  max={2}
                  render={(t, top) => {
                    const due = dueMomentOf(t);
                    return (
                      <button key={t.id} type="button" className={`r-chip task${t.completed ? ' done' : ''}${hotDue(t, due) ? ' hot' : ''}${selId === t.id ? ' sel' : ''}`} style={{ left: b.x + 6, width: z.binW - 12, top }} onClick={() => setSelId(t.id)} title={t.text}>
                        {z.bin === 'day' && !isAllDay(t) && <span className="tm">{clock(due)}</span>}
                        <span>{t.text}</span>
                      </button>
                    );
                  }}
                  onMore={() => { setZoomSaved('day'); setTimeout(() => scrollTo(new Date(b.from.getTime() + 10 * 3600000)), 60); }}
                />
              ))}
              {quick && quick.lane === 'task' && (
                <QuickAdd refEl={quickRef} quick={quick} mode="task" onDone={() => setQuick(null)} />
              )}
            </div>

            {/* notes */}
            <div className="r-lane notes">
              {lay && lay.nItems.filter((k) => k.row < 3).map((k) => {
                const slim = lay.nRows > 1;
                const top = lay.nRows === 1 ? 18 : lay.nRows === 2 ? 12 + k.row * 42 : 10 + k.row * 28;
                return (
                  <Link key={k.n.id} to={`/notes/${k.n.id}`} className={`r-note${slim ? ' slim' : ''}`} style={{ left: k.x, top, height: lay.nH }} title={k.n.title}>
                    <span className="t">{k.n.title || 'Untitled'}</span>
                    {lay.nRows < 3 && <span className="m">{noteMeta(k.n)}</span>}
                  </Link>
                );
              })}
              {bins && bins.map((b) => (
                <BinChips
                  key={b.i}
                  x={b.x}
                  w={z.binW}
                  items={b.notes}
                  max={2}
                  render={(n, top) => (
                    <Link key={n.id} to={`/notes/${n.id}`} className="r-chip note" style={{ left: b.x + 6, width: z.binW - 12, top }} title={n.title}>
                      <span>{n.title || 'Untitled'}</span>
                    </Link>
                  )}
                  onMore={() => navigate('/notes')}
                />
              ))}
            </div>

            {/* Peblo */}
            <div className="r-lane peblo">
              {pebloCards.map((c) => (c.kind === 'brief' ? (
                <div key={c.key} className="r-peblo ink" style={{ left: c.x, width: c.w }}>
                  {brief.data ? (
                    <>
                      <span className="t">{brief.data.points.length ? `Your brief for ${briefFor.text} is ready: ${brief.data.points.length} points from ${brief.data.sources.length} note${brief.data.sources.length === 1 ? '' : 's'}.` : `Your notes don't mention ${briefFor.text} yet.`}</span>
                      <span className="acts"><button type="button" onClick={() => setSelId(briefFor.id)}>Read it</button></span>
                    </>
                  ) : brief.isFetching ? (
                    <span className="t" style={{ display: 'flex', gap: 8, alignItems: 'center' }}><Loader2 size={14} className="r-spin" /> Reading your notes for {briefFor.text}…</span>
                  ) : (
                    <>
                      <span className="t">{brief.error ? (brief.error.response?.data?.error || 'The brief could not be written.') : `${briefFor.text} is ${fromNow(momentOf(briefFor))}. Want a brief from your notes?`}</span>
                      <span className="acts">
                        {aiReady
                          ? <button type="button" onClick={() => { brief.refetch(); setSelId(briefFor.id); }}>{brief.error ? 'Try again' : 'Brief me'}</button>
                          : <Link to="/ai/connections" style={{ color: 'inherit' }}>Set up AI first</Link>}
                      </span>
                    </>
                  )}
                </div>
              ) : (
                <div key={c.key} className="r-peblo dash" style={{ left: c.x, width: c.w }}>
                  <span className="t">
                    {c.p.owner && c.p.owner.toLowerCase() !== 'you' ? `${c.p.owner} promised: ` : 'You promised: '}
                    {c.p.text.charAt(0).toLowerCase() + c.p.text.slice(1)}{c.p.due ? `, by ${dayWord(c.p.due)} ${clock(c.p.due)}` : ''}. From {c.p.noteTitle}.
                  </span>
                  <span className="acts">
                    <button type="button" onClick={() => addPromise(c.p)}>Add to river</button>
                    <button type="button" className="quiet" onClick={() => dismissPromise(c.p)}>Dismiss</button>
                  </span>
                </div>
              )))}
              {lay && pebloCards.length === 0 && (
                <span className="r-peblo-empty" style={{ left: Math.max(PAD, nowX + 16) }}>Open a note and press "Find promises": Peblo puts what people promised here.</span>
              )}
              {bins && bins.map((b) => (
                <BinChips
                  key={b.i}
                  x={b.x}
                  w={z.binW}
                  items={b.promises}
                  max={2}
                  render={(p, top) => (
                    <button key={`${p.genId}-${p.index}`} type="button" className="r-chip promise" style={{ left: b.x + 6, width: z.binW - 12, top }} onClick={() => addPromise(p)} title={`Add to river: ${p.text}`}>
                      <span>+ {p.text}</span>
                    </button>
                  )}
                />
              ))}
            </div>

            <div className="r-now-line" style={{ left: nowX }} />
            <span className="r-now-pill" style={{ left: nowX - 30 }}>NOW {clock(now).replace(/ (am|pm)$/, '')}</span>
          </div>
        </div>
      </section>

      <RiverDrawer
        selected={selected}
        meetings={meetings}
        tasks={tasks}
        notes={notes}
        now={now}
        aiReady={aiReady}
        onSelect={(id, at) => { setSelId(id); if (at) scrollTo(at); }}
        onToggle={toggle}
        flash={flash}
      />
      {undatedOpen && (
        <div className="r-pop" ref={undatedRef} style={{ left: undatedOpen.left, top: undatedOpen.top, width: 380 }}>
          {undated.slice(0, 8).map((t) => (
            <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 4px 4px 10px' }}>
              <span className="t">{t.text}</span>
              <button type="button" className="r-btn ghost small" onClick={() => scheduleUndated(t, 0)}>Today</button>
              <button type="button" className="r-btn ghost small" onClick={() => scheduleUndated(t, 1)}>Tomorrow</button>
            </div>
          ))}
          {undated.length > 8 && <span className="empty">and {undated.length - 8} more</span>}
        </div>
      )}
      {toast && <div className="r-toast" role="status">{toast}</div>}
    </>
  );
}

/** A day or week column's items as chips, with "+N more" when they don't fit. */
function BinChips({ x, w, items, render, max = 2, onMore }) {
  if (!items.length) return null;
  const shown = items.slice(0, max);
  const more = items.length - shown.length;
  return (
    <>
      {shown.map((it, i) => render(it, 12 + i * 30))}
      {more > 0 && (
        <button type="button" className="r-chip-more" style={{ left: x + 2, top: 12 + shown.length * 30, width: w - 4, textAlign: 'left' }} onClick={onMore}>+ {more} more</button>
      )}
    </>
  );
}

/** Double-click on the meetings or tasks lane: type a title, Enter puts it there. */
function QuickAdd({ quick, mode, onDone, refEl }) {
  const queryClient = useQueryClient();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const at = quick.at;
  const left = Math.max(8, quick.x - 150);
  const save = async (e) => {
    e.preventDefault();
    if (!text.trim() || busy) return;
    setBusy(true);
    const end = new Date(at.getTime() + 3600000);
    await todosAPI.create({
      text: text.trim(),
      deadline: at.toISOString(),
      startTime: mode === 'meeting' ? at.toTimeString().slice(0, 5) : null,
      endTime: mode === 'meeting' ? end.toTimeString().slice(0, 5) : null,
    });
    queryClient.invalidateQueries({ queryKey: ['todos'] });
    onDone();
  };
  return (
    <form className="r-quick" ref={refEl} style={{ left, top: 8 }} onSubmit={save}>
      <label htmlFor="r-quick-input">{mode === 'meeting' ? `New meeting · ${dayWord(at)}, ${clockRange(at, new Date(at.getTime() + 3600000))}` : `New task · due ${dayWord(at)}, ${clock(at)}`}</label>
      <input id="r-quick-input" autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder={mode === 'meeting' ? 'What is it?' : 'What needs doing?'} autoComplete="off" />
      <div className="row">
        <button type="button" className="r-btn ghost small" onClick={onDone}>Cancel</button>
        <button type="submit" className="r-btn small" disabled={!text.trim() || busy}>Add</button>
      </div>
    </form>
  );
}


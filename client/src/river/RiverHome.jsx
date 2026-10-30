import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { todosAPI, notesAPI, riverAPI, hubAPI } from '../api';
import { RiverHeader, useDismiss } from './RiverShell';
import RiverDrawer from './RiverDrawer';
import { quickMeetingTimes, timeOfDay } from './quickAdd';
import { hiddenClusters, nextHidden } from './hidden';
import { freeGaps, clashes, dur } from './planner';
import { AlertTriangle } from 'lucide-react';
import { useUndoToast } from '../utils/useUndoToast';
import UndoToast from '../components/UndoToast';
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
  const h = within / z.pxh;
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
  // A new meeting opens the full capture card (length, start, people, repeat, reminder) at the time that was clicked
  const openMeeting = (when) => window.dispatchEvent(new CustomEvent('peblo:capture', { detail: { mode: 'meeting', text: '', at: new Date(Math.round(new Date(when).getTime() / 900000) * 900000).toISOString() } }));
  const [undatedOpen, setUndatedOpen] = useState(false); // false or { left, top } inside the frame
  const [toast, setToast] = useState('');
  const [dropDay, setDropDay] = useState(null); // a day (ms) an unscheduled task is being dragged over
  const scrollRef = useRef(null);
  const drag = useRef(null);

  const z = ZOOMS[zoom];
  const today = startOfDay(now);
  const todayKey = today.toDateString();
  const start = useMemo(() => rangeStart(z, today), [zoom, todayKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const end = useMemo(() => addDays(start, z.back + z.ahead + (z.bin === 'week' ? 7 : 1)), [start, z]);
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
  const overdue = useMemo(() => openTodos.filter((t) => t.deadline && !t.startTime && !t.completed && dueMomentOf(t) < now).sort((a, b) => dueMomentOf(a) - dueMomentOf(b)), [openTodos, now]);
  const gaps = useMemo(() => (z.mode === 'time' ? freeGaps(meetings, today, z.ahead + 1, now) : []), [z, meetings, todayKey, now]); // eslint-disable-line react-hooks/exhaustive-deps
  const freeToday = useMemo(() => freeGaps(meetings, today, 1, now).reduce((s, g) => s + g.mins, 0), [meetings, todayKey, now]); // eslint-disable-line react-hooks/exhaustive-deps
  const clash = useMemo(() => clashes(meetings), [meetings]);
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
    return out;
  }, [promiseData, notes]);

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
  // A Jump that needs another zoom parks its target here; the new scale is in place by the time this runs.
  const pendingScroll = useRef(null);
  useLayoutEffect(() => {
    const target = pendingScroll.current;
    pendingScroll.current = null;
    scrollTo(target || new Date(), false);
  }, [zoom]); // eslint-disable-line react-hooks/exhaustive-deps

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
  const { toast: undoToast, say, dismiss } = useUndoToast();
  // Gives every task without a date the first free stretch it fits in (9 am to 6 pm, this week), longest estimate first-come
  const suggestAll = async () => {
    const slots = [];
    for (let d = 0; d < 7; d++) {
      const day = addDays(today, d);
      for (const g of freeGaps(meetings, day, 1, d === 0 ? now : day)) {
        const s = new Date(Math.max(g.s.getTime(), new Date(day).setHours(9, 0, 0, 0)));
        const e = new Date(Math.min(g.e.getTime(), new Date(day).setHours(18, 0, 0, 0)));
        if (e - s >= 30 * 60000) slots.push({ s, e });
      }
    }
    let planned = 0;
    for (const t of undated) {
      const need = ((t.meta && t.meta.estimateMin) || 60) * 60000;
      const slot = slots.find((x) => x.e - x.s >= need);
      if (!slot) continue;
      try {
        await todosAPI.update(t.id, { deadline: slot.s.toISOString() });
        slot.s = new Date(slot.s.getTime() + need);
        planned += 1;
      } catch { /* leave that one in the tray */ }
    }
    refresh();
    flash(planned ? `Planned ${planned} of ${undated.length} into free time` : 'No free time left this week');
  };
  const setDone = async (t, completed) => {
    queryClient.setQueriesData({ queryKey: ['todos', 'range', 'river'] }, (old) => (Array.isArray(old) ? old.map((x) => (x.id === t.id ? { ...x, completed, updatedAt: new Date().toISOString() } : x)) : old));
    let ok = true;
    try {
      await todosAPI.update(t.id, { completed });
    } catch {
      ok = false;
      flash('Could not update that task. Check your connection and try again.');
    }
    refresh(); // on failure this also puts the row back as the server has it
    return ok;
  };
  const toggle = async (t) => {
    const next = !t.completed;
    if (await setDone(t, next)) say(next ? 'Marked done' : 'Marked not done', () => setDone(t, !next));
  };

  const onLaneDoubleClick = (lane) => (e) => {
    if (z.mode !== 'time' || e.target.closest('button, a, input, label, .r-quick')) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const at = timeAt(x - PAD, z, start);
    if (lane === 'meeting') openMeeting(at); else setQuick({ lane, x, at });
  };

  const addPromise = async (p) => {
    let due = p.due ? new Date(p.due) : null;
    if (!due) { due = addDays(startOfDay(), 1); due.setHours(9, 0, 0, 0); }
    let data;
    try {
      ({ data } = await todosAPI.create({ text: p.owner && p.owner.toLowerCase() !== 'you' ? `${p.text} (${p.owner})` : p.text, deadline: due.toISOString(), noteId: p.noteId, priority: 'medium' }));
    } catch {
      flash('Could not add that promise. Try again.');
      return;
    }
    try {
      await riverAPI.setPromise(p.genId, p.index, 'added', data.todo?.id);
    } catch {
      flash('Added to your tasks, but could not mark the promise as added.');
    }
    queryClient.invalidateQueries({ queryKey: ['river', 'promises'] });
    refresh();
    flash(`On the river · due ${dayWord(due)}, ${clock(due)}`);
  };
  const dismissPromise = async (p) => {
    try {
      await riverAPI.setPromise(p.genId, p.index, 'ignored');
    } catch {
      flash('Could not dismiss that promise. Try again.');
    }
    queryClient.invalidateQueries({ queryKey: ['river', 'promises'] });
  };

  const scheduleUndated = async (t, dayOffset) => {
    const d = addDays(startOfDay(), dayOffset);
    d.setHours(23, 59, 0, 0);
    try {
      await todosAPI.update(t.id, { deadline: d.toISOString() });
    } catch {
      flash('Could not move that task. Try again.');
      return;
    }
    refresh();
    flash(`Moved to ${dayWord(d).toLowerCase()}`);
  };

  // Unscheduled tasks can be dragged onto a day of the Tasks lane (Week zoom)
  const dayFromEvent = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const i = Math.floor((e.clientX - rect.left - PAD) / z.binW);
    return i >= 0 ? addDays(start, i) : null;
  };
  const isTaskDrag = (e) => z.mode === 'bins' && z.bin === 'day' && Array.from(e.dataTransfer?.types || []).includes('text/peblo-task');
  const onTaskDragOver = (e) => {
    if (!isTaskDrag(e)) return;
    e.preventDefault();
    const d = dayFromEvent(e);
    setDropDay(d ? d.getTime() : null);
  };
  const onTaskDrop = async (e) => {
    if (!isTaskDrag(e)) return;
    e.preventDefault();
    const id = e.dataTransfer.getData('text/peblo-task');
    const d = dayFromEvent(e);
    setDropDay(null);
    if (!id || !d) return;
    d.setHours(23, 59, 0, 0);
    try {
      await todosAPI.update(id, { deadline: d.toISOString() });
    } catch {
      flash('Could not move that task. Try again.');
      return;
    }
    refresh();
    flash('Planned for ' + dayWord(d).toLowerCase());
  };
  const bookedMins = (b) => Math.round(b.meet.reduce((s, t) => s + Math.max(0, ((endOf(t) || momentOf(t)) - momentOf(t)) / 60000), 0));

  const aiReady = !!(models?.local?.enabled && models.local.ok) || (models?.cloud || []).some((c) => c.configured);

  // ---------- header ----------
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(today, i));
  const weekFree = zoom === 'week' ? weekDays.reduce((s, d, i) => s + freeGaps(meetings, d, 1, i === 0 ? now : d).reduce((a, g) => a + Math.max(0, (Math.min(g.e.getTime(), new Date(d).setHours(18, 0, 0, 0)) - Math.max(g.s.getTime(), new Date(d).setHours(9, 0, 0, 0))) / 60000), 0), 0) : 0; // working hours, 9 am to 6 pm
  const weekEnd = addDays(today, 7);
  const weekMeet = zoom === 'week' ? meetings.filter((t) => !t.completed && momentOf(t) >= today && momentOf(t) < weekEnd).length : 0;
  const weekTasks = zoom === 'week' ? tasks.filter((t) => !t.completed && dueMomentOf(t) >= today && dueMomentOf(t) < weekEnd).length : 0;
  const sub = zoom === 'week'
    ? `Next 7 days · ${weekMeet} meeting${weekMeet === 1 ? '' : 's'} · ${weekTasks} task${weekTasks === 1 ? '' : 's'} · ${dur(weekFree)} free`
    : (nextUp ? clock(now) + ' · ' + (nextUp.at <= now ? 'in a meeting now' : 'next up ' + fromNow(nextUp.at)) : clock(now) + ' · nothing else planned') + (freeToday >= 30 ? ' · ' + dur(freeToday) + ' free' : '');

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
      if ((r.at < start || r.at > end) && zoom !== 'quarter') {
        pendingScroll.current = r.at;
        setZoomSaved('quarter');
      } else if (r.at < start || r.at > end) {
        flash('That is outside the dates the river shows');
      } else {
        setTimeout(() => scrollTo(r.at), 50);
      }
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
      for (let h = 0; h < 24; h++) {
        const first = h === 0;
        const hh = h % 12 === 0 ? 12 : h % 12;
        const label = first ? `${DOW[d.getDay()]} ${d.getDate()} · ${hh} am` : zoom === 'hours' ? `${hh}:00 ${h < 12 ? 'am' : 'pm'}` : `${hh} ${h < 12 ? 'am' : 'pm'}`;
        ticks.push({ key: `${i}-${h}`, x: base + h * z.pxh, label, day: first, today: first && sameDay(d, today) });
      }
      // the night hours are real, usable time: only tinted
      nights.push({ key: i + 'a', x: base, w: DAY_START * z.pxh, label: 'Night' });
      nights.push({ key: i + 'b', x: base + DAY_END * z.pxh, w: (24 - DAY_END) * z.pxh, label: 'Night' });
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
      });
    }
    return list;
  }, [z, start, end, meetings, tasks, visibleNotes, today]);

  // The longest free stretch in a day, inside working hours (9 am to 6 pm), shown as a gap block in the week lane
  const dayGap = (b) => {
    if (b.from < today) return null;
    const open = new Date(b.from).setHours(9, 0, 0, 0);
    const shut = new Date(b.from).setHours(18, 0, 0, 0);
    let best = null;
    for (const g of freeGaps(meetings, b.from, 1, b.today ? now : b.from)) {
      const s = new Date(Math.max(g.s.getTime(), open, b.today ? now.getTime() : 0));
      const e = new Date(Math.min(g.e.getTime(), shut));
      const mins = Math.round((e - s) / 60000);
      if (mins >= 60 && (!best || mins > best.mins)) best = { s, e, mins };
    }
    return best;
  };
  const clockShort = (d) => { const h = d.getHours() % 12 || 12; return h + (d.getMinutes() ? ':' + String(d.getMinutes()).padStart(2, '0') : '') + (d.getHours() < 12 ? ' am' : ' pm'); };
  // A tip for the tray: the fullest day, and where the load is lightest
  const fullTip = (() => {
    if (zoom !== 'week' || !bins || z.bin !== 'day') return null;
    const days = bins.filter((b) => b.from >= today && b.from < weekEnd).map((b) => ({ b, m: bookedMins(b) }));
    const full = days.reduce((a, d) => (!a || d.m > a.m ? d : a), null);
    if (!full || full.m < 300) return null;
    const light = days.filter((d) => d.b.i !== full.b.i && d.m < 240).sort((a, b) => a.m - b.m)[0];
    const nm = (d) => d.toLocaleDateString(undefined, { weekday: 'long' });
    return nm(full.b.from) + ' is nearly full' + (light ? '. ' + nm(light.b.from) + ' has room.' : '.');
  })();

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
            {(undated.length > 0 || overdue.length > 0 || promises.length > 0) && (
              <button
                type="button"
                className={'r-undated' + (overdue.length ? ' late' : '')}
                aria-expanded={!!undatedOpen}
                onClick={(e) => {
                  const frame = e.currentTarget.closest('.river').getBoundingClientRect();
                  const r = e.currentTarget.getBoundingClientRect();
                  setUndatedOpen(undatedOpen ? false : { left: r.left - frame.left, top: r.bottom - frame.top + 6 });
                }}
              >
                {overdue.length ? 'Overdue · ' + overdue.length : undated.length ? 'No date · ' + undated.length : 'Promises · ' + promises.length}
              </button>
            )}
          </div>
          <span className="notes">NOTES</span>
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
              <div key={n.key} className="r-band-night" style={{ left: n.x, width: n.w }}><span>{n.label}</span></div>
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
                  {z.bin === 'day' && b.meet.length > 0 && <small className="r-booked">{dur(bookedMins(b))}</small>}
                </button>
              ))}
              {bins && z.bin === 'day' && bins.filter((b) => b.meet.length > 0).map((b) => (
                <span key={`ld${b.i}`} className={'r-load' + (bookedMins(b) >= 360 ? ' full' : '')} style={{ left: b.x + 10, width: z.binW - 20 }} title={dur(bookedMins(b)) + ' of meetings'}><i style={{ width: Math.min(100, (bookedMins(b) / 480) * 100) + '%' }} /></span>
              ))}
            </div>

            {/* meetings */}
            <div className="r-lane meet" onDoubleClick={onLaneDoubleClick('meeting')}>
              {lay && gaps.map((g) => {
                const gx = X(g.s);
                const gw = X(g.e) - gx - 4;
                return (
                  <button key={g.s.getTime()} type="button" className="r-gap" style={{ left: gx, width: gw, top: 14, height: 84 }} title={'Free for ' + dur(g.mins) + '. Click to add a meeting.'} onClick={() => openMeeting(g.s)}>
                    {gw >= 80 ? <span>Free {dur(g.mins)}</span> : <span className="r-sr">Free {dur(g.mins)}</span>}
                  </button>
                );
              })}
              {lay && clash.list.filter((c) => c.e > now).map((c) => (
                <span key={c.a + c.b} className="r-clash-tag" style={{ left: X(c.s), bottom: 1 }}><AlertTriangle size={11} aria-hidden="true" style={{ verticalAlign: '-1px' }} /> Clash · {dur(c.mins)}</span>
              ))}
              {lay && lay.mItems.filter((m) => m.row < 3).map((m) => {
                const kind = kindOf(m.t);
                const slim = lay.mH < 40;
                return (
                  <button
                    key={m.t.id}
                    type="button"
                    className={`r-meet ${kind}${m.e < now ? ' past' : ''}${selId === m.t.id ? ' sel' : ''}${slim ? ' slim' : ''}${m.w < 90 ? ' narrow' : ''}${clash.ids.has(m.t.id) && m.e > now ? ' clash' : ''}`}
                    style={{ left: m.x, width: m.w, top: 14 + m.row * (lay.mH + 4), height: lay.mH }}
                    onClick={() => setSelId(m.t.id)}
                    title={`${m.t.text} · ${clockRange(m.s, m.e)}`}
                  >
                    <span className="t">{m.t.text}</span>
                    <span className="m">{clockRange(m.s, m.e)}</span>
                  </button>
                );
              })}
              {lay && hiddenClusters(lay.mItems).map((c) => (
                <button key={`meeting-${c.x}`} type="button" className="r-chip-more" style={{ left: c.x, bottom: 2 }} title="Show the meetings that do not fit"
                  onClick={() => { const h = nextHidden(c, selId, (it) => it.t.id); setSelId(h.item.t.id); flash(`${h.item.t.text} · ${h.position} of ${h.total} hidden`); }}>
                  + {c.items.length} more
                </button>
              ))}
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
                  onMore={() => { const hid = b.meet[z.bin === 'day' ? 3 : 2]; pendingScroll.current = hid ? momentOf(hid) : new Date(b.from.getTime() + 10 * 3600000); setZoomSaved('day'); }}
                />
              ))}
              {bins && z.bin === 'day' && bins.map((b) => {
                const g = dayGap(b);
                if (!g) return null;
                return (
                  <button key={`fg${b.i}`} type="button" className="r-wgap" style={{ left: b.x + 6, width: z.binW - 12 }} title={'Free for ' + dur(g.mins) + '. Click to add a meeting.'} onClick={() => openMeeting(g.s)}>
                    Free {clockShort(g.s)} – {clockShort(g.e)}
                  </button>
                );
              })}
              {quick && quick.lane === 'meeting' && (
                <QuickAdd refEl={quickRef} quick={quick} mode="meeting" onDone={() => setQuick(null)} />
              )}
            </div>

            {/* tasks */}
            <div className="r-lane tasks" onDoubleClick={onLaneDoubleClick('task')} onDragOver={onTaskDragOver} onDragLeave={() => setDropDay(null)} onDrop={onTaskDrop}>
              {bins && dropDay !== null && <div className="r-drop-day" style={{ left: PAD + Math.round((dropDay - start) / 86400000) * z.binW, width: z.binW }}><span>Drop to plan it here</span></div>}
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
              {lay && hiddenClusters(lay.tItems).map((c) => (
                <button key={`task-${c.x}`} type="button" className="r-chip-more" style={{ left: c.x, bottom: 2 }} title="Show the tasks that do not fit"
                  onClick={() => { const h = nextHidden(c, selId, (it) => it.t.id); setSelId(h.item.t.id); flash(`${h.item.t.text} · ${h.position} of ${h.total} hidden`); }}>
                  + {c.items.length} more
                </button>
              ))}
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
                  onMore={() => { const hid = b.tasks[2]; pendingScroll.current = hid ? dueMomentOf(hid) : new Date(b.from.getTime() + 10 * 3600000); setZoomSaved('day'); }}
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
              {lay && hiddenClusters(lay.nItems).map((c) => (
                <button key={`note-${c.x}`} type="button" className="r-chip-more" style={{ left: c.x, bottom: 2 }} title="Show the notes that do not fit"
                  onClick={() => { const h = nextHidden(c, null, (it) => it.n.id); navigate(`/notes/${h.item.n.id}`); }}>
                  + {c.items.length} more
                </button>
              ))}
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

            <div className="r-now-line" style={{ left: nowX }} />
            {zoom !== 'week' && <span className="r-now-pill" style={{ left: nowX - 30 }}>NOW {clock(now).replace(/ (am|pm)$/, '')}</span>}
          </div>
        </div>
      </section>

      {zoom === 'week' && undated.length > 0 && (
        <section className="r-tray" aria-label="Tasks without a date">
          <span className="r-tray-h">Unscheduled · {undated.length}</span>
          <span className="r-tray-hint">Drag one onto a day in the Tasks lane</span>
          {fullTip && <span className="r-tray-tip">Tip: {fullTip}</span>}
          <button type="button" className="r-btn small" style={{ marginLeft: 'auto' }} onClick={suggestAll}>Suggest times for all {undated.length}</button>
          <div className="r-tray-row">
            {undated.slice(0, 8).map((t) => (
              <button key={t.id} type="button" className="r-pebble" draggable title="Drag onto a day" onDragStart={(e) => { e.dataTransfer.setData('text/peblo-task', t.id); e.dataTransfer.effectAllowed = 'move'; }} onDragEnd={() => setDropDay(null)}>
                <i aria-hidden="true" />{t.text}
              </button>
            ))}
          </div>
        </section>
      )}
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
        <div className="r-pop r-od" ref={undatedRef} style={{ left: undatedOpen.left, top: undatedOpen.top }}>
          {overdue.length > 0 && <span className="r-pop-h late">Overdue</span>}
          {overdue.slice(0, 8).map((t) => (
            <div key={t.id} className="r-od-row">
              <span className="t">{t.text}<small className="r-late-when"> {dayWord(dueMomentOf(t))}</small></span>
              <button type="button" className="r-btn ghost small" onClick={() => scheduleUndated(t, 0)}>Today</button>
              <button type="button" className="r-btn ghost small" onClick={() => scheduleUndated(t, 1)}>Tomorrow</button>
              <button type="button" className="r-btn ghost small" onClick={() => toggle(t)}>Done</button>
            </div>
          ))}
          {overdue.length > 0 && undated.length > 0 && <span className="r-pop-h">No date</span>}
          {undated.slice(0, 8).map((t) => (
            <div key={t.id} className="r-od-row">
              <span className="t">{t.text}</span>
              <button type="button" className="r-btn ghost small" onClick={() => scheduleUndated(t, 0)}>Today</button>
              <button type="button" className="r-btn ghost small" onClick={() => scheduleUndated(t, 1)}>Tomorrow</button>
            </div>
          ))}
          {undated.length > 8 && <span className="empty">and {undated.length - 8} more</span>}
          {promises.length > 0 && <span className="r-pop-h">Promises from your notes</span>}
          {promises.slice(0, 6).map((pr) => (
            <div key={pr.genId + '-' + pr.index} className="r-od-row">
              <span className="t" title={pr.noteTitle}>{pr.owner && pr.owner.toLowerCase() !== 'you' ? pr.owner + ': ' : ''}{pr.text}<small className="r-late-when" style={{ color: 'var(--r-fg3)' }}> {pr.due ? 'by ' + dayWord(pr.due) : 'no date'}</small></span>
              <button type="button" className="r-btn ghost small" onClick={() => addPromise(pr)}>Add to river</button>
              <button type="button" className="r-btn ghost small" onClick={() => dismissPromise(pr)}>Dismiss</button>
            </div>
          ))}
        </div>
      )}
      {toast && <div className="r-toast" role="status">{toast}</div>}
      <UndoToast toast={undoToast} dismiss={dismiss} />
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
  const [err, setErr] = useState('');
  const at = quick.at;
  const times = quickMeetingTimes(at);
  const left = Math.max(8, quick.x - 150);
  const save = async (e) => {
    e.preventDefault();
    if (!text.trim() || busy) return;
    setBusy(true);
    setErr('');
    try {
      await todosAPI.create({
        text: text.trim(),
        deadline: (mode === 'meeting' ? times.start : at).toISOString(),
        startTime: mode === 'meeting' ? timeOfDay(times.start) : null,
        endTime: mode === 'meeting' ? timeOfDay(times.end) : null,
      });
    } catch {
      setErr('Could not add it. Check your connection and try again.');
      setBusy(false);
      return;
    }
    queryClient.invalidateQueries({ queryKey: ['todos'] });
    onDone();
  };
  return (
    <form className="r-quick" ref={refEl} style={{ left, top: 8 }} onSubmit={save}>
      <label htmlFor="r-quick-input">{mode === 'meeting' ? `New meeting · ${dayWord(at)}, ${clockRange(times.start, times.end)}` : `New task · due ${dayWord(at)}, ${clock(at)}`}</label>
      <input id="r-quick-input" autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder={mode === 'meeting' ? 'What is it?' : 'What needs doing?'} autoComplete="off" />
      {err && <p role="alert" style={{ margin: '4px 0', fontSize: 12, color: 'var(--r-late, #c4441c)' }}>{err}</p>}
      <div className="row">
        <button type="button" className="r-btn ghost small" onClick={onDone}>Cancel</button>
        <button type="submit" className="r-btn small" disabled={!text.trim() || busy}>Add</button>
      </div>
    </form>
  );
}


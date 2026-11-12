import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { X, Plus, Timer } from 'lucide-react';
import { notesAPI, todosAPI } from '../api';
import { useAuth } from '../context/AuthContext';
import { useUndoToast, useDeferredDelete } from '../utils/useUndoToast';
import UndoToast from '../components/UndoToast';
import TaskSheet from './TaskSheet';
import { daysFromToday, startOfDay, tagsOf, weekdayLong } from './softUtils';
import './plan.css';

const DEF_HOURS = [8, 20]; // working hours the day column covers; changed with the pickers in the Today panel and kept per browser
const HOURS_KEY = 'peblo-plan-hours';
const readHours = () => { try { const v = JSON.parse(localStorage.getItem(HOURS_KEY) || 'null'); if (Array.isArray(v) && v[0] >= 0 && v[1] <= 24 && v[1] - v[0] >= 4) return v; } catch { /* storage unavailable */ } return DEF_HOURS; };
const HOUR = 56; // px per hour in the day column
const SNAP = 15;
const DEFAULT_EST = 30;
const BREAK = 10; // minutes left free between tasks that Auto-fit places
const hm = (min) => `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}`;
const hm24 = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
const nice = (min) => (min >= 60 ? `${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60} min` : ''}` : `${min} min`);
const toMin = (s) => { const m = /^(\d{1,2}):(\d{2})/.exec(s || ''); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
const hourLabel = (h) => (h === 12 ? '12 pm' : h > 12 ? `${h - 12} pm` : `${h} am`);
const estOf = (t) => t.meta?.estimateMin || DEFAULT_EST;
const rank = { high: 0, medium: 1, low: 2 };

/** Soft Studio · Plan my day (mockup: TaskPlan). Pick tasks, drop them into the gaps between meetings, approve what Claude proposed. */
export default function SoftPlan() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { settings, updateSettings } = useAuth();
  const { data: todos = [] } = useQuery({ queryKey: ['todos', 'all'], queryFn: () => todosAPI.getAll().then((r) => r.data.todos || []) });
  const { data: proposals = [] } = useQuery({ queryKey: ['todos', 'proposals'], queryFn: () => todosAPI.getAll({ proposals: 'only' }).then((r) => r.data.todos || []) });
  const { toast, say, dismiss } = useUndoToast();
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['todos'] });
  const { gone, schedule } = useDeferredDelete(async (id) => { await todosAPI.delete(id, 'all'); refresh(); });
  const [sheet, setSheet] = useState(null);
  const [drag, setDrag] = useState(null); // { id }
  const [ghost, setGhost] = useState(null); // minutes where a drop would land
  const [msg, setMsg] = useState('');
  const [now, setNow] = useState(() => new Date());
  const colRef = useRef(null);
  useEffect(() => { const i = setInterval(() => setNow(new Date()), 30000); return () => clearInterval(i); }, []);
  const calm = settings?.calmMode === true;
  const [hrs, setHrsState] = useState(readHours);
  const DAY_START = hrs[0] * 60;
  const DAY_END = hrs[1] * 60;
  const setHrs = (next) => { if (next[1] - next[0] < 4) return; setHrsState(next); try { localStorage.setItem(HOURS_KEY, JSON.stringify(next)); } catch { /* ignore */ } };
  const [rs, setRs] = useState(null); // block being resized: { id, end }

  const live = useMemo(() => todos.filter((t) => !gone.includes(t.id)), [todos, gone]);
  const todayAll = live.filter((t) => !t.completed && t.deadline && daysFromToday(t.deadline) === 0);
  const meetings = todayAll.filter((t) => t.startTime && t.endTime && !t.meta?.planned);
  const planned = todayAll.filter((t) => t.meta?.planned && t.startTime);
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const from0 = nowMin >= DAY_END - 150 ? DAY_START : Math.max(DAY_START, nowMin); // late in the evening the whole window stays open to plan
  const busy = useMemo(() => [...meetings, ...planned].map((t) => [toMin(t.startTime), toMin(t.endTime) ?? toMin(t.startTime) + estOf(t)]).filter((x) => x[0] !== null).sort((a, b) => a[0] - b[0]), [meetings, planned]);

  const pick = useMemo(() => {
    const seen = new Set();
    const out = live.filter((t) => {
      if (t.completed || tagsOf(t).map(String).includes('someday')) return false;
      if (t.startTime && t.endTime && !t.meta?.planned) return false;
      if (t.meta?.planned && t.deadline && daysFromToday(t.deadline) === 0) return false;
      if (t.deadline && daysFromToday(t.deadline) > 0) return false;
      if (t.seriesId) { if (seen.has(t.seriesId)) return false; seen.add(t.seriesId); }
      return true;
    });
    const day = (t) => (t.deadline ? daysFromToday(t.deadline) : 1);
    return out.sort((a, b) => day(a) - day(b) || (rank[a.priority] ?? 1) - (rank[b.priority] ?? 1)).slice(0, 14);
  }, [live]);

  const free = Math.max(0, DAY_END - from0 - busy.reduce((n, [a, b]) => n + Math.max(0, Math.min(b, DAY_END) - Math.max(a, from0)), 0));
  const needs = [...pick, ...planned].reduce((n, t) => n + estOf(t), 0);

  /** First free minute at or after `from` where `dur` minutes fit, or null. */
  const slotFor = (dur, from, skipId) => {
    const others = [...meetings, ...planned].filter((t) => t.id !== skipId).map((t) => [toMin(t.startTime), toMin(t.endTime) ?? toMin(t.startTime) + estOf(t)]).filter((x) => x[0] !== null).sort((a, b) => a[0] - b[0]);
    let at = Math.max(DAY_START, Math.ceil(from / SNAP) * SNAP);
    for (let guard = 0; guard < 60; guard += 1) {
      const hit = others.find(([a, b]) => at < b && at + dur > a);
      if (!hit) return at + dur <= DAY_END ? at : null;
      at = Math.ceil(hit[1] / SNAP) * SNAP;
    }
    return null;
  };
  const place = async (t, start) => {
    const dur = estOf(t);
    const d = startOfDay();
    d.setHours(Math.floor(start / 60), start % 60, 0, 0);
    queryClient.setQueryData(['todos', 'all'], (old) => (old || []).map((x) => (x.id === t.id ? { ...x, deadline: d.toISOString(), startTime: hm24(start), endTime: hm24(start + dur), meta: { ...(x.meta || {}), planned: true, estimateMin: x.meta?.estimateMin || dur } } : x)));
    try { await todosAPI.update(t.id, { scope: 'this', deadline: d.toISOString(), startTime: hm24(start), endTime: hm24(start + dur), meta: { planned: true, estimateMin: t.meta?.estimateMin || dur, moves: t.meta?.moves ?? 0 } }); } catch { setMsg('Could not plan that task.'); }
    refresh();
  };
  const planOne = (t, from = from0, skip) => {
    const s = slotFor(estOf(t), from, skip);
    if (s === null) { setMsg(`No gap left for ${t.text} today.`); return false; }
    setMsg('');
    place(t, s);
    return s;
  };
  const unplan = async (t) => {
    queryClient.setQueryData(['todos', 'all'], (old) => (old || []).map((x) => (x.id === t.id ? { ...x, startTime: null, endTime: null, meta: { ...(x.meta || {}), planned: undefined } } : x)));
    try { await todosAPI.update(t.id, { scope: 'this', startTime: '', endTime: '', meta: { planned: null, moves: t.meta?.moves ?? 0 } }); } catch { setMsg('Could not take that out of the day.'); }
    refresh();
  };
  const autoFit = async () => {
    let at = from0;
    let n = 0;
    const taken = [...busy];
    for (const t of pick) {
      const dur = estOf(t);
      let s = Math.max(DAY_START, Math.ceil(at / SNAP) * SNAP);
      for (let g = 0; g < 60; g += 1) { const hit = taken.find(([a, b]) => s < b && s + dur > a); if (!hit) break; s = Math.ceil(hit[1] / SNAP) * SNAP; }
      if (s + dur > DAY_END) continue;
      taken.push([s, s + dur]);
      // eslint-disable-next-line no-await-in-loop
      await place(t, s);
      at = s + dur + BREAK; // a short breather between fitted tasks
      n += 1;
    }
    setMsg(n ? '' : 'No free gaps left today.');
    if (n) say(`${n} task${n === 1 ? '' : 's'} fitted into your gaps`);
  };

  const onDropDay = (e) => {
    e.preventDefault();
    const id = drag?.id || e.dataTransfer.getData('text/plain');
    setDrag(null); setGhost(null);
    const t = live.find((x) => x.id === id);
    if (!t || !colRef.current) return;
    const y = e.clientY - colRef.current.getBoundingClientRect().top;
    const at = DAY_START + Math.round((y / HOUR) * 60 / SNAP) * SNAP;
    const s = slotFor(estOf(t), at, t.id);
    if (s === null) { setMsg(`No gap left for ${t.text} there.`); return; }
    setMsg('');
    place(t, s);
  };
  const overDay = (e) => {
    if (!drag || !colRef.current) return;
    e.preventDefault();
    const y = e.clientY - colRef.current.getBoundingClientRect().top;
    setGhost(DAY_START + Math.round((y / HOUR) * 60 / SNAP) * SNAP);
  };

  // approval inbox
  const approve = async (t) => { try { await todosAPI.update(t.id, { scope: 'this', meta: { proposal: null } }); } catch { setMsg('Could not approve that.'); } refresh(); say(`Approved "${t.text.slice(0, 30)}"`); };
  const reject = (t) => schedule(t.id, t.text, say);
  const proposalsShown = proposals.filter((t) => !gone.includes(t.id));

  // task health: moved three times or more
  const stale = live.filter((t) => !t.completed && (t.meta?.moves || 0) >= 3);
  const doToday = async (t) => { const d = new Date(); d.setHours(Math.max(9, d.getHours() + 1), 0, 0, 0); try { await todosAPI.update(t.id, { scope: 'this', deadline: d.toISOString(), meta: { moves: null } }); } catch { setMsg('Could not move that.'); } refresh(); };
  const someday = async (t) => { try { await todosAPI.update(t.id, { scope: 'this', deadline: null, tags: [...new Set([...tagsOf(t).map(String), 'someday'])], meta: { moves: null } }); } catch { setMsg('Could not move that.'); } refresh(); say(`Moved to Someday`); };

  const briefing = async () => {
    const lines = [`# Plan for ${weekdayLong(new Date())} ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })}`, '', `Free time: ${nice(free)}. Tasks need: ${nice(needs)}.`, '', '## Today'];
    const items = [...meetings.map((t) => ({ s: toMin(t.startTime), line: `- ${t.startTime} Meeting: ${t.text}` })), ...planned.map((t) => ({ s: toMin(t.startTime), line: `- ${t.startTime} ${t.text} (${nice(estOf(t))})` }))].sort((a, b) => a.s - b.s);
    lines.push(...(items.length ? items.map((i) => i.line) : ['- Nothing planned yet']), '', '## Still to pick', ...(pick.length ? pick.map((t) => `- [ ] ${t.text}`) : ['- Nothing waiting']));
    // one briefing note per day: pressing the button again refreshes today's note instead of making another
    const title = `Plan for ${new Date().toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}`;
    try {
      let id = null;
      try { const found = await notesAPI.getAll({ search: title, limit: 10, snippet: '1' }); const hit = (found.data?.notes || []).find((n) => n.title === title && !n.isDeleted); if (hit) { await notesAPI.update(hit.id, { content: lines.join('\n') }); id = hit.id; } } catch { /* fall through to a new note */ }
      if (!id) { const r = await notesAPI.create({ title, content: lines.join('\n') }); id = r.data?.note?.id || r.data?.id; }
      if (id) navigate(`/notes/${id}`);
    } catch { setMsg('Could not write the briefing note.'); }
  };

  // end of day: whatever was planned today and is not done goes to tomorrow morning, and counts as a move
  const carryToTomorrow = async () => {
    const d = startOfDay();
    d.setDate(d.getDate() + 1);
    d.setHours(9, 0, 0, 0);
    const ids = new Set(planned.map((t) => t.id));
    queryClient.setQueryData(['todos', 'all'], (old) => (old || []).map((x) => (ids.has(x.id) ? { ...x, deadline: d.toISOString(), startTime: null, endTime: null, meta: { ...(x.meta || {}), planned: undefined } } : x)));
    try {
      for (const t of planned) {
        // eslint-disable-next-line no-await-in-loop
        await todosAPI.update(t.id, { scope: 'this', deadline: d.toISOString(), startTime: '', endTime: '', meta: { planned: null } });
      }
      say(`${planned.length} unfinished task${planned.length === 1 ? '' : 's'} moved to tomorrow`);
    } catch { setMsg('Could not move them to tomorrow.'); }
    refresh();
  };
  // drag the bottom edge of a planned block to change how long it takes; the estimate follows
  const startResize = (e, t, a) => {
    e.preventDefault(); e.stopPropagation();
    const y0 = e.clientY;
    const b0 = toMin(t.endTime) ?? a + estOf(t);
    const limit = Math.min(DAY_END, ...[...meetings, ...planned].filter((x) => x.id !== t.id).map((x) => toMin(x.startTime)).filter((s) => s !== null && s >= b0));
    let last = b0;
    setRs({ id: t.id, end: b0 });
    const move = (ev) => { last = Math.max(a + SNAP, Math.min(limit, Math.round((b0 + ((ev.clientY - y0) / HOUR) * 60) / SNAP) * SNAP)); setRs({ id: t.id, end: last }); };
    const up = async () => {
      window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up);
      setRs(null);
      if (last === b0) return;
      queryClient.setQueryData(['todos', 'all'], (old) => (old || []).map((x) => (x.id === t.id ? { ...x, endTime: hm24(last), meta: { ...(x.meta || {}), estimateMin: last - a } } : x)));
      try { await todosAPI.update(t.id, { scope: 'this', endTime: hm24(last), meta: { planned: true, estimateMin: last - a, moves: t.meta?.moves ?? 0 } }); } catch { setMsg('Could not resize that block.'); }
      refresh();
    };
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
  };
  const over = needs - free;

  // end-of-day review: what got done, what is left, and where each leftover goes
  const [review, setReview] = useState(false);
  const startToday = startOfDay();
  const doneToday = live.filter((t) => t.completed && t.updatedAt && new Date(t.updatedAt) >= startToday && !(t.startTime && t.endTime && !t.meta?.planned));
  const leftToday = todayAll.filter((t) => !(t.startTime && t.endTime && !t.meta?.planned));
  const doneMin = doneToday.reduce((n, t) => n + estOf(t), 0);
  const tomorrow9 = () => { const d = startOfDay(); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); return d; };
  const moveTo = async (list, dest) => {
    const d = tomorrow9();
    const ids = new Set(list.map((t) => t.id));
    queryClient.setQueryData(['todos', 'all'], (old) => (old || []).map((x) => (ids.has(x.id) ? { ...x, deadline: dest === 'tomorrow' ? d.toISOString() : null, startTime: null, endTime: null, meta: { ...(x.meta || {}), planned: undefined } } : x)));
    try {
      for (const t of list) {
        const body = dest === 'tomorrow'
          ? { scope: 'this', deadline: d.toISOString(), startTime: '', endTime: '', meta: { planned: null, moves: (t.meta?.moves || 0) + 1 } }
          : { scope: 'this', deadline: null, startTime: '', endTime: '', tags: [...new Set([...tagsOf(t).map(String), 'someday'])], meta: { planned: null, moves: null } };
        // eslint-disable-next-line no-await-in-loop
        await todosAPI.update(t.id, body);
      }
      say(dest === 'tomorrow' ? `${list.length} moved to tomorrow` : `${list.length} moved to Someday`);
    } catch { setMsg('Could not move that.'); }
    refresh();
  };
  const recap = async () => {
    const title = `Recap for ${new Date().toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}`;
    const lines = [`# ${title}`, '', `Done: ${doneToday.length} task${doneToday.length === 1 ? '' : 's'} (about ${nice(doneMin)}).`, '', '## Done', ...(doneToday.length ? doneToday.map((t) => `- [x] ${t.text}`) : ['- Nothing finished']), '', '## Left open', ...(leftToday.length ? leftToday.map((t) => `- [ ] ${t.text}`) : ['- Nothing left'])];
    try {
      let id = null;
      try { const found = await notesAPI.getAll({ search: title, limit: 10, snippet: '1' }); const hit = (found.data?.notes || []).find((n) => n.title === title && !n.isDeleted); if (hit) { await notesAPI.update(hit.id, { content: lines.join('\n') }); id = hit.id; } } catch { /* fall through to a new note */ }
      if (!id) { const r = await notesAPI.create({ title, content: lines.join('\n') }); id = r.data?.note?.id || r.data?.id; }
      if (id) navigate(`/notes/${id}`);
    } catch { setMsg('Could not write the recap note.'); }
  };

  const dateLine = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
  const hours = Array.from({ length: DAY_END / 60 - DAY_START / 60 }, (_, i) => DAY_START / 60 + i);
  const top = (m) => ((m - DAY_START) / 60) * HOUR;
  const blockOf = (t, kind) => {
    const a = toMin(t.startTime);
    const b = rs && rs.id === t.id ? rs.end : (toMin(t.endTime) ?? a + estOf(t));
    return { t, kind, a, b };
  };
  const blocks = [...meetings.map((t) => blockOf(t, 'meet')), ...planned.map((t) => blockOf(t, 'plan'))].filter((b) => b.a !== null && b.b > DAY_START && b.a < DAY_END);

  return (
    <div className={`soft-page s-plan${calm ? ' calm' : ''}`}>
      <div className="pl-head">
        <div>
          <Link to="/tasks" className="pl-back">Tasks</Link>
          <h1 className="s-h1">Plan my day</h1>
          <span className="s-sub">{dateLine} · you have {nice(free)} free, your tasks need {nice(needs)}</span>
        </div>
        <span className="grow" />
        {over > 0 && <span className="pl-over" role="status" data-testid="plan-over">Over by {nice(over)}</span>}
        {planned.length > 0 && <button type="button" className="pl-light" data-testid="plan-carry" onClick={carryToTomorrow}>Move {planned.length} unfinished to tomorrow</button>}
        <button type="button" className="pl-light" data-testid="plan-review-open" aria-expanded={review} onClick={() => setReview((v) => !v)}>End of day review</button>
        <button type="button" className="pl-dark" onClick={autoFit} disabled={pick.length === 0}>Auto-fit my gaps</button>
        <button type="button" className="pl-light" onClick={briefing}>Write today's briefing note</button>
      </div>
      {msg && <p className="pl-msg" role="status">{msg}</p>}

      <div className="pl-grid">
        <section className="pl-panel peach" aria-label="Pick for today">
          <div className="pl-ph"><h2>Pick for today</h2><span className="pl-chip">{pick.length} waiting</span></div>
          <p className="pl-note">From yesterday and your backlog. Drag onto the day, or tap the plus.</p>
          <div className="pl-picks">
            {pick.length === 0 && <p className="pl-empty">Nothing waiting. Your day is already picked.</p>}
            {pick.map((t) => {
              const late = t.deadline && daysFromToday(t.deadline) < 0;
              return (
                <div key={t.id} className="pl-pick" data-testid="plan-pick" draggable onDragStart={(e) => { e.dataTransfer.setData('text/plain', t.id); setDrag({ id: t.id }); }} onDragEnd={() => { setDrag(null); setGhost(null); }}>
                  <button type="button" className="pl-title" onClick={() => setSheet({ task: t })}>{t.text}</button>
                  <span className={`pl-chip${late ? ' late' : ''}${t.meta?.estimateMin ? '' : ' faint'}`}>{late ? `From ${daysFromToday(t.deadline) === -1 ? 'yesterday' : weekdayLong(t.deadline)}` : t.meta?.estimateMin ? nice(t.meta.estimateMin) : 'No estimate'}</span>
                  <button type="button" className="pl-add" aria-label={`Put "${t.text}" in my day`} onClick={() => planOne(t)}><Plus size={14} strokeWidth={2.6} /></button>
                </div>
              );
            })}
          </div>
          <p className="pl-note hint">Tasks with no estimate count as {DEFAULT_EST} min.</p>
        </section>

        <section className="pl-panel day" aria-label="Today">
          <div className="pl-ph"><h2>Today</h2><span className="pl-chip">Meetings from your calendar</span><span className="grow" /><label className="pl-hrs">Day <select aria-label="Day starts" data-testid="plan-from" value={hrs[0]} onChange={(e) => setHrs([Number(e.target.value), hrs[1]])}>{Array.from({ length: 13 }, (_, i) => <option key={i} value={i + 3} disabled={hrs[1] - (i + 3) < 4}>{hourLabel(i + 3)}</option>)}</select> to <select aria-label="Day ends" data-testid="plan-to" value={hrs[1]} onChange={(e) => setHrs([hrs[0], Number(e.target.value)])}>{Array.from({ length: 13 }, (_, i) => <option key={i} value={i + 12} disabled={i + 12 - hrs[0] < 4}>{i + 12 === 24 ? '12 am' : hourLabel(i + 12)}</option>)}</select></label></div>
          <div className="pl-scroll">
            <div className="pl-day" ref={colRef} data-testid="plan-day" style={{ height: hours.length * HOUR }} onDragOver={overDay} onDrop={onDropDay} onDragLeave={() => setGhost(null)}>
              {hours.map((h) => <div key={h} className="pl-hr" style={{ top: top(h * 60) }}><span>{hourLabel(h)}</span></div>)}
              {blocks.map(({ t, kind, a, b }) => (
                <div key={t.id} className={`pl-blk ${kind}${b - a <= 45 ? ' short' : ''}`} data-testid={kind === 'plan' ? 'plan-block' : 'plan-meeting'} style={{ top: top(Math.max(a, DAY_START)) + 2, height: Math.max(26, ((Math.min(b, DAY_END) - Math.max(a, DAY_START)) / 60) * HOUR - 4) }} draggable={kind === 'plan'} onDragStart={(e) => { e.dataTransfer.setData('text/plain', t.id); setDrag({ id: t.id }); }} onDragEnd={() => { setDrag(null); setGhost(null); }}>
                  <button type="button" className="pl-btitle" onClick={() => setSheet({ task: t })}>{t.text} · {nice(b - a)}</button>
                  <span className="pl-time">{hm(a)} to {hm(b)}{kind === 'meet' ? ' (calendar)' : ''}</span>
                  {kind === 'plan' && <Link className="pl-focus" to={`/tasks/focus/${t.id}`} aria-label={`Start a focus timer for "${t.text}"`} title="Focus timer" data-testid="plan-focus"><Timer size={12} strokeWidth={2.4} /></Link>}
                  {kind === 'plan' && <span className="pl-grip" role="separator" aria-label="Drag to change the length" data-testid="plan-resize" onMouseDown={(e) => startResize(e, t, a)} />}
                  {kind === 'plan' && <button type="button" className="pl-x" aria-label={`Take "${t.text}" out of my day`} onClick={() => unplan(t)}><X size={12} strokeWidth={2.6} /></button>}
                </div>
              ))}
              {drag && ghost !== null && <div className="pl-blk ghost" style={{ top: top(Math.max(DAY_START, Math.min(ghost, DAY_END - SNAP))), height: Math.max(26, (estOf(live.find((x) => x.id === drag.id) || {}) / 60) * HOUR - 4) }}>Drop here</div>}
              {nowMin >= DAY_START && nowMin <= DAY_END && <div className="pl-now" style={{ top: top(nowMin) }}><b>{hm24(nowMin)}</b></div>}
            </div>
          </div>
        </section>

        <div className="pl-right">
          {review && (
            <section className="pl-panel mint" aria-label="End of day review" data-testid="plan-review">
              <div className="pl-ph"><h2>End of day</h2><span className="pl-chip" data-testid="review-done">{doneToday.length} done · {nice(doneMin)}</span><span className="grow" /><button type="button" className="pl-x2" aria-label="Close the review" onClick={() => setReview(false)}><X size={14} strokeWidth={2.4} /></button></div>
              {leftToday.length === 0 ? <p className="pl-note">Nothing left open for today.</p> : (
                <div className="pl-props">
                  {leftToday.map((t) => (
                    <div key={t.id} className="pl-prop" data-testid="review-left">
                      <b>{t.text}</b>
                      <div className="pl-acts">
                        <button type="button" onClick={() => moveTo([t], 'tomorrow')}>Tomorrow</button>
                        <button type="button" onClick={() => moveTo([t], 'someday')}>Someday</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <div className="pl-acts wrap">
                {leftToday.length > 1 && <button type="button" className="ok" data-testid="review-all" onClick={() => moveTo(leftToday, 'tomorrow')}>Move all to tomorrow</button>}
                <button type="button" data-testid="review-recap" onClick={recap}>Save recap note</button>
              </div>
            </section>
          )}
          <section className="pl-panel lilac" aria-label="Approval inbox" data-testid="approval-inbox">
            <div className="pl-ph"><h2>Approval inbox</h2><span className="pl-chip">{proposalsShown.length} waiting</span></div>
            <p className="pl-note viol">Tasks that Claude or a guest proposed. Nothing lands in your lists until you say yes.</p>
            <div className="pl-props">
              {proposalsShown.length === 0 && <p className="pl-empty">Nothing waiting.</p>}
              {proposalsShown.map((t) => (
                <div key={t.id} className="pl-prop" data-testid="proposal">
                  <b>{t.text}</b>
                  <span>{t.meta?.proposal?.by || 'Claude'}{t.meta?.proposal?.from ? ` · ${t.meta.proposal.from}` : ''}</span>
                  <div className="pl-acts">
                    <button type="button" className="ok" onClick={() => approve(t)}>Approve</button>
                    <button type="button" onClick={() => setSheet({ task: t })}>Edit</button>
                    <button type="button" className="bad" onClick={() => reject(t)}>Reject</button>
                  </div>
                </div>
              ))}
            </div>
            <label className="pl-switch"><input type="checkbox" checked={settings?.aiApproval === true} onChange={(e) => updateSettings({ aiApproval: e.target.checked })} /> Ask me before Claude adds tasks</label>
          </section>
          <section className="pl-panel butter" aria-label="Task health" data-testid="task-health">
            <h2>Task health</h2>
            {stale.length === 0 ? <p className="pl-health">Nothing is stuck. Tasks you move three times show up here.</p> : (
              <>
                <p className="pl-health">{stale[0].text} was moved {stale[0].meta.moves} times. Still want it?{stale.length > 1 ? ` (${stale.length - 1} more)` : ''}</p>
                <div className="pl-acts wrap">
                  <button type="button" onClick={() => doToday(stale[0])}>Do it today</button>
                  <button type="button" onClick={() => someday(stale[0])}>Move to Someday</button>
                  <button type="button" onClick={() => schedule(stale[0].id, stale[0].text, say)}>Drop it</button>
                </div>
              </>
            )}
            <label className="pl-switch"><input type="checkbox" checked={calm} onChange={(e) => updateSettings({ calmMode: e.target.checked })} /> Calm mode: no red counters, no streaks</label>
          </section>
        </div>
      </div>
      {sheet && <TaskSheet task={sheet.task} isNew={false} onClose={() => { setSheet(null); refresh(); }} />}
      <UndoToast toast={toast} dismiss={dismiss} />
    </div>
  );
}

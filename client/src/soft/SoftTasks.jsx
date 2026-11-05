import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { X, Repeat, Target } from 'lucide-react';
import { todosAPI } from '../api';
import { parseTask } from '../utils/parseTask';
import { askScope } from '../utils/askScope';
import { useUndoToast, useDeferredDelete, UNDO_MS } from '../utils/useUndoToast';
import UndoToast from '../components/UndoToast';
import TaskSheet from './TaskSheet';
import { filterTasks, sortTasks, groupTasks, isOverdue, PRIORITY_LABEL, GROUP_OPTIONS, SORT_OPTIONS } from '../utils/taskView';
import './tasks2.css';
import './bulk.css';
import './lists.css';
import { ShortcutSheet, BulkBar, UndoRedo, DeleteConfirm } from './TaskBulk';
import ShareList from './ShareList';
import { ListCards, ListMenu, NewListDialog, DeleteListDialog, MiniCards, withLegacyLists, newListId, INBOX } from './TaskLists';
import { useAuth } from '../context/AuthContext';
import { timeOf, dayChip, daysFromToday, weekdayLong, startOfDay, addDays, tagsOf } from './softUtils';

/** Soft Studio · Tasks (mockup: SoftTasks). A board of Today, Tomorrow, This week and Done. */
const SOFT_H = { whenOf: (t) => (t.deadline ? new Date(t.deadline) : null), tagsOf: (t) => tagsOf(t).map(String), isMeeting: () => false };

const ordinal = (n) => { const v = n % 100; return n + (['th', 'st', 'nd', 'rd'][(v - 20) % 10] || ['th', 'st', 'nd', 'rd'][v] || 'th'); };
/** "Every 1st", "Every weekday", "Every Friday" - what a repeating task says about itself. */
export function repeatLabel(t) {
  const r = t.recurrence;
  if (!r || r === 'none') return '';
  const d = t._ref || t.deadline ? new Date(t._ref || t.deadline) : null; // _ref: a later occurrence, so moving one date does not rename the rule
  if (r === 'daily') return 'Every day';
  if (r === 'weekdays') return 'Every weekday';
  if (r === 'weekly') return d ? `Every ${weekdayLong(d)}` : 'Every week';
  if (r === 'monthly') return d ? `Every ${ordinal(d.getDate())}` : 'Every month';
  if (r === 'yearly') return d ? `Every ${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}` : 'Every year';
  return '';
}
const SMART = [['all', 'All'], ['inbox', 'Inbox'], ['today', 'Today'], ['upcoming', 'Upcoming'], ['waiting', 'Waiting'], ['someday', 'Someday'], ['overdue', 'Overdue'], ['high', 'High priority']];
const VIEWS = [['board', 'Board'], ['list', 'List'], ['table', 'Table'], ['timeline', 'Timeline']];
const stepsOf = (t) => (Array.isArray(t.meta?.subtasks) ? t.meta.subtasks : []);

function StepsBar({ steps }) {
  const done = steps.filter((x) => x.done).length;
  return (
    <span className="s-steps" title={`${done} of ${steps.length} steps`}>
      <span className="bar"><i style={{ width: `${Math.round((done / steps.length) * 100)}%` }} /></span>
      <span className="n">{done} of {steps.length} steps</span>
    </span>
  );
}

function TaskTable({ rows, toggle, open, selMode, sel, onSel }) {
  return (
    <div className="s-table-wrap">
      <table className="s-table" data-testid="task-table">
        <thead><tr><th scope="col"><span className="s-sr">Done</span></th><th scope="col">Task</th><th scope="col">Due</th><th scope="col">Repeat</th><th scope="col">Priority</th><th scope="col">Steps</th><th scope="col">Tags</th></tr></thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={7} className="s-empty small">Nothing here.</td></tr>}
          {rows.map((t) => (
            <tr key={t.id} className={selMode && sel.has(t.id) ? 'sel' : ''} onClick={(e) => { if (selMode) onSel(t, e.shiftKey); }}>
              <td>{selMode ? <button type="button" className={`s-selbox${sel.has(t.id) ? ' on' : ''}`} aria-pressed={sel.has(t.id)} aria-label={`Select "${t.text}"`} /> : <input type="checkbox" className="s-check small" checked={!!t.completed} onChange={() => toggle(t)} aria-label={`Mark "${t.text}" done`} />}</td>
              <td><button type="button" className="s-card-open t" onClick={() => { if (!selMode) open(t); }}>{t.text}</button></td>
              <td>{t.deadline ? `${dayChip(t.deadline)}${timeOf(t) ? ` ${timeOf(t)}` : ''}` : '\u2014'}</td>
              <td>{repeatLabel(t) || '\u2014'}{t._later > 0 && <span className="s-mini later">+{t._later} later</span>}</td>
              <td>{t.priority === 'high' ? 'High' : t.priority === 'low' ? 'Low' : 'Normal'}</td>
              <td>{stepsOf(t).length ? `${stepsOf(t).filter((x) => x.done).length}/${stepsOf(t).length}` : '\u2014'}</td>
              <td>{tagsOf(t).map((g) => `#${g}`).join(' ') || '\u2014'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TaskTimeline({ groups, open }) {
  const days = Array.from({ length: 14 }, (_, i) => addDays(startOfDay(), i));
  const all = [...groups.overdue, ...groups.today, ...groups.tomorrow, ...groups.week, ...groups.later].filter((t) => t.deadline);
  return (
    <div className="s-timeline" data-testid="task-timeline">
      {days.map((d, i) => {
        const items = all.filter((t) => (i === 0 ? daysFromToday(t.deadline) <= 0 : daysFromToday(t.deadline) === i));
        return (
          <section key={i} className={`s-tl-day${i === 0 ? ' today' : ''}`}>
            <h2>{i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : weekdayLong(d)}<small>{d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</small></h2>
            {items.length === 0 && <p className="s-empty small">Free</p>}
            {items.map((t) => <button key={t.id} type="button" className="s-tl-item" onClick={() => open(t)}><b>{timeOf(t) || 'All day'}</b>{t.text}{repeatLabel(t) && <Repeat size={11} />}</button>)}
          </section>
        );
      })}
    </div>
  );
}

export default function SoftTasks() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [view, setView] = useState('board');
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const inputRef = useRef(null);
  const [sheet, setSheet] = useState(null); // { task, isNew }
  const [justAdded, setJustAdded] = useState(null); // the task just added with Enter, so the cursor can stay in the box
  const [dragId, setDragId] = useState(null);
  const [overCol, setOverCol] = useState(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const [selMode, setSelMode] = useState(false);
  const [sel, setSel] = useState(() => new Set());
  const lastSel = useRef(null);
  const [cursor, setCursor] = useState(null);
  const [keys, setKeys] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [bulkGone, setBulkGone] = useState({ ids: new Set(), series: new Set() });
  const hist = useRef({ undo: [], redo: [] });
  const [, bump] = useState(0);
  const pendingDel = useRef(null);
  const flatRef = useRef([]);
  const { settings: acct, updateSettings } = useAuth();
  const [listSel, setListSel] = useState(null); // null = all tasks, INBOX, or a list name
  const [showLists, setShowLists] = useState(() => { try { return localStorage.getItem('peblo-task-lists-open') === '1'; } catch { return false; } });
  const [showArch, setShowArch] = useState(false);
  const [menu, setMenu] = useState(null); // { list, anchor }
  const [newList, setNewList] = useState(false);
  const [delList, setDelList] = useState(null);
  const [gPick, setGPick] = useState(null);

  const { data: todos = [] } = useQuery({ queryKey: ['todos', 'all'], queryFn: () => todosAPI.getAll().then((r) => r.data.todos || []) });

  const { toast, say, dismiss } = useUndoToast();
  const { gone, schedule } = useDeferredDelete(async (id) => { await todosAPI.delete(id, 'this'); refresh(); });
  const [q, setQ] = useState('');
  const [pill, setPill] = useState('all');
  const [lg, setLg] = useState('when');
  const [ls, setLs] = useState('due');
  // A repeating task shows once (its next open date) with "+N later", not as 60 copies.
  const collapsed = useMemo(() => {
    const live = todos.filter((t) => !bulkGone.ids.has(t.id) && !(t.seriesId && bulkGone.series.has(t.seriesId)));
    const open = new Map();
    for (const t of live) if (t.seriesId && !t.completed) { const a = open.get(t.seriesId) || []; a.push(t); open.set(t.seriesId, a); }
    const first = new Map();
    for (const [id, a] of open) { a.sort((x, y) => new Date(x.deadline || 8.64e15) - new Date(y.deadline || 8.64e15)); first.set(id, a[0].id); }
    return live.filter((t) => t.completed || !t.seriesId || first.get(t.seriesId) === t.id).map((t) => (t.seriesId && !t.completed ? { ...t, _later: open.get(t.seriesId).length - 1, _ref: open.get(t.seriesId).at(-1).deadline } : t));
  }, [todos, bulkGone]);
  const inView = (t, key) => {
    const tg = tagsOf(t).map(String);
    const d = t.deadline ? daysFromToday(t.deadline) : null;
    if (key === 'high') return t.priority === 'high';
    if (key === 'overdue') return isOverdue(t, SOFT_H);
    if (key === 'inbox') return d === null && !tg.includes('someday') && !tg.includes('waiting');
    if (key === 'today') return d !== null && d <= 0;
    if (key === 'upcoming') return d !== null && d >= 1;
    if (key === 'waiting') return tg.includes('waiting');
    if (key === 'someday') return tg.includes('someday');
    return true;
  };
  const smartCounts = useMemo(() => Object.fromEntries(SMART.map(([k]) => [k, collapsed.filter((t) => !t.completed && inView(t, k)).length])), [collapsed]);
  const base = useMemo(() => {
    const found = filterTasks(collapsed, { show: 'all', q }, SOFT_H);
    const inList = (t) => (listSel === null ? true : listSel === INBOX ? !t.meta?.list : t.meta?.list === listSel);
    return found.filter((t) => inList(t) && (t.completed || inView(t, pill)));
  }, [collapsed, q, pill, listSel]);
  const groups = useMemo(() => {
  const open = base.filter((t) => !t.completed && !gone.includes(t.id));
    const rank = { high: 0, medium: 1, low: 2 };
    // Important first, then by time (the mockup lists the !high task before earlier ones)
    const byDue = (a, b) => (rank[a.priority] ?? 1) - (rank[b.priority] ?? 1) || new Date(a.deadline || 8.64e15) - new Date(b.deadline || 8.64e15);
    const overdue = open.filter((t) => t.deadline && daysFromToday(t.deadline) < 0).sort((a, b) => new Date(a.deadline) - new Date(b.deadline));
    const today = open.filter((t) => t.deadline && daysFromToday(t.deadline) === 0).sort(byDue);
    const tomorrow = open.filter((t) => t.deadline && daysFromToday(t.deadline) === 1).sort(byDue);
    const week = open.filter((t) => t.deadline && daysFromToday(t.deadline) >= 2 && daysFromToday(t.deadline) <= 6).sort((a, b) => new Date(a.deadline) - new Date(b.deadline));
    const later = open.filter((t) => !t.deadline || daysFromToday(t.deadline) > 6).sort((a, b) => new Date(a.deadline || 8.64e15) - new Date(b.deadline || 8.64e15));
    const weekAgo = addDays(startOfDay(), -6);
    const done = base.filter((t) => t.completed && !gone.includes(t.id) && new Date(t.updatedAt) >= weekAgo).sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    const ord = (t) => (typeof t.meta?.order === 'number' ? t.meta.order : null);
    const withOrder = (arr) => (arr.some((x) => ord(x) !== null) ? [...arr].sort((a, b) => (ord(a) ?? 1e12) - (ord(b) ?? 1e12)) : arr);
    return { overdue, today: withOrder(today), tomorrow: withOrder(tomorrow), week: withOrder(week), later, done, open };
  }, [base, gone]);
  const otherGroups = useMemo(() => {
    const sorted = sortTasks(groups.open, ls === 'due' || lg === 'when' ? 'due' : ls, SOFT_H);
    if (lg === 'list') {
      const m = new Map();
      for (const t of sorted) { const k = t.meta?.list || INBOX; if (!m.has(k)) m.set(k, { key: k, label: k === INBOX ? 'Inbox' : k, items: [] }); m.get(k).items.push(t); }
      return [...m.values()];
    }
    const g = groupTasks(sorted, lg === 'when' ? 'due' : lg, SOFT_H);
    if (lg === 'when' && groups.done.length) g.push({ key: 'done', label: 'Done', items: groups.done });
    return g;
  }, [groups.open, groups.done, lg, ls]);
  const shownGroups = gPick ? otherGroups.filter((g) => g.key === gPick) : otherGroups;

  const subtitle = [
    `${groups.open.length} to do`,
    `${groups.done.length} done this week`,
    groups.overdue.length === 1
      ? `one from ${daysFromToday(groups.overdue[0].deadline) === -1 ? 'yesterday' : weekdayLong(groups.overdue[0].deadline)} still waiting`
      : groups.overdue.length > 1 ? `${groups.overdue.length} from earlier still waiting` : null,
  ].filter(Boolean).join(' · ');

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['todos'] });
    queryClient.invalidateQueries({ queryKey: ['dashboard'] });
  };
  const setDone = async (t, completed) => {
    setErr('');
    queryClient.setQueryData(['todos', 'all'], (old) => (old || []).map((x) => (x.id === t.id ? { ...x, completed, updatedAt: new Date().toISOString() } : x)));
    try {
      await todosAPI.update(t.id, { completed });
    } catch {
      queryClient.setQueryData(['todos', 'all'], (old) => (old || []).map((x) => (x.id === t.id ? { ...x, completed: !completed } : x)));
      setErr('Could not update that task. Please try again.');
      return false;
    }
    refresh();
    return true;
  };
  const toggle = async (t) => {
    const next = !t.completed;
    if (!(await setDone(t, next))) return;
    say(next ? 'Marked done' : 'Marked not done', () => setDone(t, !next));
  };
  const remove = async (t) => {
    if (t.seriesId) { // a repeating task asks which ones, so that stays a direct question
      const scope = await askScope(t, 'delete');
      if (!scope) return;
      try { await todosAPI.delete(t.id, scope); } catch { setErr('Could not delete that task. Please try again.'); return; }
      refresh();
      return;
    }
    schedule(t.id, t.text, say); // goes away at once, really deleted after the undo time
  };

  // ---- Undo / Redo for bulk and keyboard changes ----
  const pushHist = (entry) => { hist.current = { undo: [...hist.current.undo, entry].slice(-20), redo: [] }; bump((n) => n + 1); };
  const patchBody = (p) => {
    const b = { scope: 'this' };
    for (const k of ['completed', 'deadline', 'priority', 'tags']) if (k in p) b[k] = p[k];
    const meta = {};
    if ('list' in p) meta.list = p.list || null;
    if ('order' in p) meta.order = p.order;
    if (Object.keys(meta).length) b.meta = meta;
    return b;
  };
  const applyPatches = async (list) => {
    queryClient.setQueryData(['todos', 'all'], (old) => (old || []).map((x) => {
      const p = list.find((y) => y.id === x.id);
      if (!p) return x;
      const n = { ...x };
      if ('completed' in p) { n.completed = p.completed; n.updatedAt = new Date().toISOString(); }
      if ('deadline' in p) n.deadline = p.deadline;
      if ('priority' in p) n.priority = p.priority;
      if ('tags' in p) n.todoTags = p.tags;
      if ('list' in p || 'order' in p) n.meta = { ...(x.meta || {}), ...('list' in p ? { list: p.list || undefined } : {}), ...('order' in p ? { order: p.order ?? undefined } : {}) };
      return n;
    }));
    try { await Promise.all(list.map((p) => todosAPI.update(p.id, patchBody(p)))); } catch { setErr('Some changes could not be saved.'); }
    refresh();
  };
  const undoLast = async () => {
    const e = hist.current.undo.at(-1);
    if (!e || e.expired) return;
    hist.current = { undo: hist.current.undo.slice(0, -1), redo: [...hist.current.redo, e] };
    bump((n) => n + 1);
    await e.undo();
  };
  const redoLast = async () => {
    const e = hist.current.redo.at(-1);
    if (!e || e.expired || !e.redo) return;
    hist.current = { undo: [...hist.current.undo, e], redo: hist.current.redo.slice(0, -1) };
    bump((n) => n + 1);
    await e.redo();
  };
  const snapshot = (t, ks) => {
    const o = { id: t.id };
    for (const k of ks) o[k] = k === 'tags' ? [...tagsOf(t)] : k === 'list' ? (t.meta?.list || null) : k === 'order' ? (t.meta?.order ?? null) : (t[k] ?? null);
    return o;
  };
  const bulk = async (label, ks, make, ids) => {
    const chosen = collapsed.filter((t) => ids.has(t.id));
    if (!chosen.length) return;
    const before = chosen.map((t) => snapshot(t, ks));
    const after = chosen.map((t) => ({ id: t.id, ...make(t) }));
    await applyPatches(after);
    pushHist({ label, undo: () => applyPatches(before), redo: () => applyPatches(after) });
    say(`${label}: ${chosen.length} task${chosen.length === 1 ? '' : 's'}`, () => undoLast());
  };
  const dateFor = (key, t) => {
    if (key === 'none') return null;
    const dow = new Date().getDay();
    const d = addDays(startOfDay(), key === 'today' ? 0 : key === 'tomorrow' ? 1 : key === 'weekend' ? ((6 - dow + 7) % 7 || 7) : 7);
    const prev = t.deadline ? new Date(t.deadline) : null;
    d.setHours(prev ? prev.getHours() : 9, prev ? prev.getMinutes() : 0, 0, 0);
    return d.toISOString();
  };
  const bDone = (ids = sel) => bulk('Marked done', ['completed'], () => ({ completed: true }), ids);
  const bDate = (k, ids = sel) => bulk('Date changed', ['deadline'], (t) => ({ deadline: dateFor(k, t) }), ids);
  const bMove = (name, ids = sel) => bulk(name ? `Moved to ${name}` : 'Moved to Inbox', ['list'], () => ({ list: name || null }), ids);
  const bTag = (tag, ids = sel) => bulk(`Tagged #${tag}`, ['tags'], (t) => ({ tags: [...new Set([...tagsOf(t), tag])] }), ids);
  const bPrio = (p, ids = sel) => bulk('Priority changed', ['priority'], () => ({ priority: p }), ids);

  const exitSelect = () => { setSelMode(false); setSel(new Set()); lastSel.current = null; };
  const toggleSel = (t, shift = false, ordered = []) => {
    setSel((s) => {
      const n = new Set(s);
      if (shift && lastSel.current && ordered.length) {
        const a = ordered.indexOf(lastSel.current);
        const b = ordered.indexOf(t.id);
        if (a >= 0 && b >= 0) { for (const id of ordered.slice(Math.min(a, b), Math.max(a, b) + 1)) n.add(id); lastSel.current = t.id; return n; }
      }
      if (n.has(t.id)) n.delete(t.id); else n.add(t.id);
      lastSel.current = t.id;
      return n;
    });
  };
  const delStats = () => {
    const chosen = collapsed.filter((t) => sel.has(t.id));
    const series = chosen.filter((t) => t.seriesId);
    return { tasks: chosen.length, repeating: series.length, occurrences: series.reduce((n, t) => n + todos.filter((x) => x.seriesId === t.seriesId && !x.completed).length, 0) };
  };
  const doDelete = () => deleteTasks(collapsed.filter((t) => sel.has(t.id)));
  const deleteTasks = (chosen) => {
    pendingDel.current?.();
    setConfirmDel(false);
    setBulkGone({ ids: new Set(chosen.map((t) => t.id)), series: new Set(chosen.filter((t) => t.seriesId).map((t) => t.seriesId)) });
    exitSelect();
    const entry = { label: 'Deleted', expired: false, undo: async () => { clearTimeout(pendingDel.timer); pendingDel.current = null; setBulkGone({ ids: new Set(), series: new Set() }); }, redo: null };
    pushHist(entry);
    say(`Deleted ${chosen.length} task${chosen.length === 1 ? '' : 's'}`, () => undoLast());
    const run = async () => {
      clearTimeout(pendingDel.timer);
      pendingDel.current = null;
      entry.expired = true;
      try { await Promise.all(chosen.map((t) => todosAPI.delete(t.id, t.seriesId ? 'all' : 'this'))); } catch { setErr('Some tasks could not be deleted.'); }
      setBulkGone({ ids: new Set(), series: new Set() });
      refresh();
    };
    pendingDel.current = run;
    pendingDel.timer = setTimeout(run, UNDO_MS + 1500);
  };
  useEffect(() => () => { pendingDel.current?.(); }, []); // leaving the page finishes a delete that was waiting

  const reorder = async (id, target, column) => {
    setDragId(null);
    setOverCol(null);
    const col = columns.find((c) => c.key === column);
    if (!col || !collapsed.some((x) => x.id === id)) return;
    if (!col.items.some((x) => x.id === id)) { moveTo(id, column === 'later' ? 'week' : column); return; }
    const ids = col.items.map((x) => x.id).filter((x) => x !== id);
    ids.splice(Math.max(0, ids.indexOf(target.id)), 0, id);
    const patches = ids.map((x, i) => ({ id: x, order: i * 10 }));
    const before = col.items.map((x) => ({ id: x.id, order: x.meta?.order ?? null }));
    await applyPatches(patches);
    pushHist({ label: 'Order changed', undo: () => applyPatches(before), redo: () => applyPatches(patches) });
  };

  const parsed = draft.trim() ? parseTask(draft) : null;
  const add = async (e) => {
    e.preventDefault();
    if (!parsed || saving) return;
    setSaving(true);
    setErr('');
    try {
      let when = parsed.deadline;
      if (!when && parsed.recurrence !== 'none') { when = new Date(); when.setHours(9, 0, 0, 0); if (when < new Date()) when.setDate(when.getDate() + 1); }
      const { data } = await todosAPI.create({ text: parsed.text || draft.trim(), priority: parsed.priority, tags: parsed.tags, deadline: when ? when.toISOString() : null, ...(parsed.recurrence !== 'none' ? { recurrence: parsed.recurrence } : {}) });
      setDraft('');
      refresh();
      const made = data.todo || data.todos?.[0] || null;
      setJustAdded(made ? { task: made, label: parsed.text || made.text } : null);
      inputRef.current?.focus();
    } catch {
      setErr('Could not add the task. Your text is kept, please try again.');
    } finally {
      setSaving(false);
    }
  };

  const moveTo = async (id, col) => {
    const t = todos.find((x) => x.id === id);
    if (!t || t.completed) return;
    if (col === 'done') { toggle(t); return; }
    const days = col === 'today' ? 0 : col === 'tomorrow' ? 1 : 2;
    const old = t.deadline;
    const d = addDays(startOfDay(), days);
    const prev = old ? new Date(old) : null;
    d.setHours(prev ? prev.getHours() : 9, prev ? prev.getMinutes() : 0, 0, 0);
    const put = (deadline) => todosAPI.update(id, { deadline, scope: 'this' }).then(refresh);
    queryClient.setQueryData(['todos', 'all'], (o) => (o || []).map((x) => (x.id === id ? { ...x, deadline: d.toISOString() } : x)));
    try { await put(d.toISOString()); } catch { setErr('Could not move that task.'); refresh(); return; }
    say(`Moved to ${col === 'week' ? dayChip(d) : col === 'today' ? 'Today' : 'Tomorrow'}`, () => put(old));
  };
  const dropProps = (key) => ({
    onDragOver: (e) => { if (dragId) { e.preventDefault(); setOverCol(key); } },
    onDragLeave: () => setOverCol((c) => (c === key ? null : c)),
    onDrop: (e) => { e.preventDefault(); const id = e.dataTransfer.getData('text/plain') || dragId; setOverCol(null); setDragId(null); if (id) moveTo(id, key); },
  });

  // /tasks?task=<id> opens that task, /tasks?q=<tag> filters (used by the command palette)
  useEffect(() => {
    const id = searchParams.get('task');
    const qq = searchParams.get('q');
    if (qq) setQ(qq);
    if (id) {
      if (!todos.length) { if (qq) setSearchParams({ task: id }, { replace: true }); return; }
      const t = todos.find((x) => x.id === id);
      if (t) setSheet({ task: t, isNew: false });
      setSearchParams({}, { replace: true });
    } else if (qq) setSearchParams({}, { replace: true });
  }, [searchParams, todos]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (cursor) document.querySelector(`[data-id="${cursor}"]`)?.scrollIntoView({ block: 'nearest' }); }, [cursor]);
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') { if (keys) { setKeys(false); } else if (selMode && !sheet && !confirmDel) exitSelect(); return; }
      const el = document.activeElement;
      const typing = el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable);
      if (typing || sheet || confirmDel || keys || document.querySelector('[role="dialog"],[role="alertdialog"]')) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redoLast(); else undoLast(); return; }
      if (mod || e.altKey) return;
      const k = e.key;
      const list = flatRef.current;
      const idx = list.findIndex((t) => t.id === cursor);
      const cur = idx >= 0 ? list[idx] : null;
      const target = () => (sel.size ? new Set(sel) : cur ? new Set([cur.id]) : new Set());
      if (k === 'n') { e.preventDefault(); inputRef.current?.focus(); }
      else if (k === '/') { e.preventDefault(); document.getElementById('s-task-search')?.focus(); }
      else if (k === '?') { e.preventDefault(); e.stopPropagation(); setKeys(true); }
      else if (k === 'j') { e.preventDefault(); setCursor(list[Math.min(list.length - 1, idx + 1)]?.id ?? null); }
      else if (k === 'k') { e.preventDefault(); setCursor(list[Math.max(0, idx - 1)]?.id ?? null); }
      else if ((k === 'x' || k === ' ') && (cur || sel.size)) { e.preventDefault(); if (sel.size) bDone(sel); else toggle(cur); }
      else if (k === 'e' && cur) { e.preventDefault(); setSheet({ task: cur, isNew: false }); }
      else if ((k === '1' || k === '2' || k === '3') && target().size) { e.preventDefault(); bPrio(k === '1' ? 'high' : k === '2' ? 'medium' : 'low', target()); }
      else if ((k === 't' || k === 'm') && target().size) { e.preventDefault(); bDate(k === 't' ? 'today' : 'tomorrow', target()); }
      else if (k === 's' && cur) { e.preventDefault(); setSelMode(true); toggleSel(cur, false, list.map((t) => t.id)); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  const chipsFor = (t, column) => {
    const out = [];
    const days = t.deadline ? daysFromToday(t.deadline) : null;
    if (days !== null && days < 0) out.push({ label: `From ${days === -1 ? 'yesterday' : weekdayLong(t.deadline)}`, kind: 'late' });
    else if (t.deadline && (column === 'today' || column === 'tomorrow')) { if (timeOf(t)) out.push({ label: timeOf(t) }); }
    else if (t.deadline && column !== 'done') out.push({ label: `${dayChip(t.deadline)}${timeOf(t) ? ` ${timeOf(t)}` : ''}` });
    else if (column === 'done') out.push({ label: dayChip(t.updatedAt) });
    if (t.priority === 'high' && column !== 'done') out.push({ label: 'High', kind: 'high' });
    const rl = repeatLabel(t);
    if (rl && column !== 'done') out.push({ label: rl, kind: 'repeat' });
    if (t._later > 0 && column !== 'done') out.push({ label: `+${t._later} later`, kind: 'later' });
    for (const tag of tagsOf(t).slice(0, 2)) out.push({ label: `#${tag}` });
    return out;
  };

  const card = (t, column) => (
    <div key={t.id} data-id={t.id} className={`s-card${t.completed ? ' done' : ''}${dragId === t.id ? ' dragging' : ''}${selMode && sel.has(t.id) ? ' sel' : ''}${cursor === t.id ? ' kb' : ''}`} data-testid="task-card" draggable={!selMode} onClick={(e) => { if (selMode && !e.target.closest('a')) toggleSel(t, e.shiftKey, visibleIds); else setCursor(t.id); }} onDragOver={(e) => { if (dragId && dragId !== t.id) e.preventDefault(); }} onDrop={(e) => { if (dragId && dragId !== t.id) { e.preventDefault(); e.stopPropagation(); reorder(dragId, t, column); } }} onDragStart={(e) => { e.dataTransfer.setData('text/plain', t.id); e.dataTransfer.effectAllowed = 'move'; setDragId(t.id); }} onDragEnd={() => { setDragId(null); setOverCol(null); }}>
      {selMode
        ? <button type="button" className={`s-selbox${sel.has(t.id) ? ' on' : ''}`} aria-pressed={sel.has(t.id)} aria-label={`Select "${t.text}"`} />
        : <input type="checkbox" className="s-check small" checked={!!t.completed} onChange={() => toggle(t)} aria-label={`Mark "${t.text}" ${t.completed ? 'not done' : 'done'}`} />}
      <div className="s-card-body">
        <button type="button" className="t s-card-open" onClick={() => { if (!selMode) setSheet({ task: t, isNew: false }); }}>{t.text}</button>
        <span className="s-card-chips">
          {chipsFor(t, column).map((c) => <span key={c.label} className={`s-mini ${c.kind || ''}`}>{c.kind === 'repeat' && <Repeat size={11} />}{c.label}</span>)}
          {stepsOf(t).length > 0 && <StepsBar steps={stepsOf(t)} />}
          {t.note && <Link to={`/notes/${t.note.id}`} className="s-mini note">{t.note.title || 'Note'}</Link>}
        </span>
      </div>
      {!selMode && !t.completed && <Link to={`/tasks/focus/${t.id}`} className="s-card-x focus" aria-label={`Focus on "${t.text}"`} title="Focus on this task"><Target size={14} strokeWidth={2.4} /></Link>}
      {!selMode && <button type="button" className="s-card-x" aria-label={`Delete "${t.text}"`} onClick={() => remove(t)}><X size={14} strokeWidth={2.4} /></button>}
    </div>
  );

  const columns = [
    { key: 'today', title: 'Today', tone: 'peach', items: [...groups.overdue, ...groups.today] },
    { key: 'tomorrow', title: 'Tomorrow', tone: 'mint', items: groups.tomorrow },
    { key: 'week', title: 'This week', tone: 'lilac', items: groups.week, extra: groups.later },
    { key: 'done', title: 'Done', tone: 'butter', items: groups.done.slice(0, 12) },
  ];

  const visibleTasks = view === 'table' || view === 'timeline'
    ? [...groups.overdue, ...groups.today, ...groups.tomorrow, ...groups.week, ...groups.later]
    : view === 'board' ? columns.flatMap((c) => [...c.items, ...(c.extra || [])]) : shownGroups.flatMap((g) => g.items);
  const visibleIds = visibleTasks.map((t) => t.id);
  flatRef.current = visibleTasks;
  const reg = Array.isArray(acct?.taskLists) ? acct.taskLists : [];
  const allLists = useMemo(() => withLegacyLists(reg, todos), [reg, todos]); // eslint-disable-line react-hooks/exhaustive-deps
  const knownLists = allLists.filter((l) => !l.archived).map((l) => l.name).sort();
  const listStats = useMemo(() => {
    const st = { [INBOX]: { open: 0, done: 0, overdue: 0 } };
    for (const t of collapsed) {
      const k = t.meta?.list || INBOX;
      const o = (st[k] = st[k] || { open: 0, done: 0, overdue: 0 });
      if (t.completed) o.done += 1; else { o.open += 1; if (isOverdue(t, SOFT_H)) o.overdue += 1; }
    }
    return st;
  }, [collapsed]);
  const saveLists = (next) => updateSettings({ taskLists: next });
  const upsertList = (def) => saveLists(reg.some((l) => l.id === def.id) ? reg.map((l) => (l.id === def.id ? { ...l, ...def } : l)) : [...reg, def]);
  const createList = (name) => { setNewList(false); upsertList({ id: newListId(), name, color: ['peach', 'mint', 'lilac', 'butter', 'sand'][allLists.length % 5] }); setListSel(name); setGPick(null); say(`List ${name} created`); };
  const renameList = async (l, name) => {
    if (allLists.some((x) => x.name === name && x.id !== l.id)) { setErr('You already have a list with that name.'); return; }
    await upsertList({ ...l, name, legacy: undefined });
    const moved = todos.filter((t) => t.meta?.list === l.name).map((t) => ({ id: t.id, list: name }));
    if (moved.length) await applyPatches(moved);
    if (listSel === l.name) setListSel(name);
  };
  const colorList = (l, color) => upsertList({ ...l, color, legacy: undefined });
  const archiveList = (l) => { upsertList({ ...l, archived: !l.archived, legacy: undefined }); if (!l.archived && listSel === l.name) setListSel(null); say(l.archived ? `${l.name} is back` : `${l.name} archived`, () => upsertList({ ...l, archived: !!l.archived, legacy: undefined })); };
  const tasksOfList = (l) => collapsed.filter((t) => t.meta?.list === l.name);
  const dropOnList = (key) => { const id = dragId; setDragId(null); setOverCol(null); if (id) bMove(key === INBOX ? null : key, new Set([id])); };
  const [shareList, setShareList] = useState(null);
  const confirmDeleteList = async (l, mode) => {
    setDelList(null);
    const before = reg;
    const restoreList = () => saveLists(before);
    await saveLists(reg.filter((x) => x.id !== l.id));
    if (listSel === l.name) setListSel(null);
    const mine = tasksOfList(l);
    if (mode === 'trash' && mine.length) {
      deleteTasks(mine);
      const e = hist.current.undo.at(-1);
      if (e) { const u = e.undo; e.undo = async () => { await u(); await restoreList(); }; }
    } else if (mine.length) {
      const ids = new Set(mine.map((t) => t.id));
      await bulk(`List ${l.name} deleted`, ['list'], () => ({ list: null }), ids);
      const e = hist.current.undo.at(-1);
      if (e) { const u = e.undo; e.undo = async () => { await u(); await restoreList(); }; }
    } else say(`List ${l.name} deleted`, restoreList);
  };
  const toggleLists = () => { const n = !showLists; setShowLists(n); try { localStorage.setItem('peblo-task-lists-open', n ? '1' : '0'); } catch { /* ignore */ } };

  return (
    <div className={`soft-page s-tasks${acct?.calmMode === true ? ' calm' : ''}`}>
      <div className="s-page-head">
        <div className="s-page-title">
          <h1 className="s-h1">{selMode ? `${sel.size} selected` : 'Tasks'}</h1>
          <span className="s-sub">{selMode ? 'Click tasks to select them, Shift-click for a range.' : subtitle}</span>
        </div>
        <span className="grow" />
        {selMode && <button type="button" className="s-selbtn" onClick={exitSelect}>Cancel</button>}
        {!selMode && <Link to="/tasks/plan" className="s-selbtn plan-link">Plan my day</Link>}
        <div className="s-seg" role="tablist" aria-label="View">
          {VIEWS.map(([k, name]) => <button key={k} type="button" role="tab" aria-selected={view === k} className={view === k ? 'on' : ''} onClick={() => setView(k)}>{name}</button>)}
        </div>
      </div>

      <form className="s-addbar" onSubmit={add}>
        <label htmlFor="task-add" className="s-sr">Add a task</label>
        <input id="task-add" ref={inputRef} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder='Add a task… try "revise BCNF tomorrow !high #exams"' autoComplete="off" />
        <button type="submit" className="s-accent-btn" disabled={!parsed || saving}>Add</button>
      </form>
      {parsed ? (
        <div className="s-understood" aria-live="polite" data-testid="understood">
          <span className="lead">Understood</span>
          <b className="what">{parsed.text || draft.trim()}</b>
          {parsed.recurrence !== 'none' && <span className="s-mini"><Repeat size={11} /> {repeatLabel({ recurrence: parsed.recurrence, deadline: parsed.deadline })}</span>}
          {parsed.deadline && <span className="s-mini">Next: {dayChip(parsed.deadline)}{parsed.allDay ? '' : ` ${timeOf({ deadline: parsed.deadline })}`}</span>}
          {parsed.priority !== 'medium' && <span className="s-mini high">{parsed.priority === 'high' ? 'High' : 'Low'}</span>}
          {parsed.tags.map((t) => <span key={t} className="s-mini">#{t}</span>)}
          <span className="grow" />
          <kbd>Enter</kbd><span className="hint">adds it and keeps the cursor here</span>
        </div>
      ) : justAdded ? (
        <div className="s-understood added" data-testid="just-added">
          <span className="lead ok">Added</span>
          <b className="what">{justAdded.label}</b>
          <span className="grow" />
          <button type="button" className="s-linkbtn" onClick={() => { setSheet({ task: justAdded.task, isNew: true }); setJustAdded(null); }}>Add details</button>
        </div>
      ) : null}
      {err && <p className="s-empty small" role="alert" style={{ margin: '4px 0' }}>{err}</p>}

      <div className="s-tasktools">
        <label htmlFor="s-task-search" className="s-sr">Search tasks</label>
        <input id="s-task-search" type="search" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setQ('')} placeholder="Search tasks and tags…" />
        <div className="s-filter" role="tablist" aria-label="Filter tasks">
          {SMART.map(([k, name]) => (
            <button key={k} type="button" role="tab" aria-selected={pill === k} className={pill === k ? 'on' : ''} onClick={() => setPill(k)}>{name}{k !== 'all' && <span className="s-pcount">{smartCounts[k]}</span>}</button>
          ))}
        </div>
        <button type="button" className={`s-selbtn${showLists ? ' on' : ''}`} aria-pressed={showLists} onClick={toggleLists}>Lists</button>
        <button type="button" className={`s-selbtn${selMode ? ' on' : ''}`} aria-pressed={selMode} onClick={() => (selMode ? exitSelect() : setSelMode(true))}>Select</button>
        {view === 'list' && (
          <>
            <div className="tl-seg" role="group" aria-label="Group tasks by">{[['none', 'None'], ['when', 'Date'], ['list', 'List'], ['tag', 'Tag'], ['priority', 'Priority']].map(([k, n]) => <button key={k} type="button" className={lg === k ? 'on' : ''} aria-pressed={lg === k} onClick={() => { setLg(k); setGPick(null); }}>{n}</button>)}</div>
            {lg !== 'when' && <label className="s-tt-sel">Sort <select value={ls} onChange={(e) => setLs(e.target.value)} aria-label="Sort tasks by">{SORT_OPTIONS.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select></label>}
          </>
        )}
      </div>

      {showLists && <ListCards lists={allLists.filter((l) => showArch || !l.archived)} stats={listStats} sel={listSel} dragging={!!dragId} onOpen={(n) => { setListSel(listSel === n ? null : n); setGPick(null); }} onNew={() => setNewList(true)} onMenu={(l, el) => setMenu({ list: l, anchor: el })} onDropTask={dropOnList} />}
      {showLists && allLists.some((l) => l.archived) && <button type="button" className="s-linkbtn" onClick={() => setShowArch(!showArch)}>{showArch ? 'Hide archived lists' : 'Show archived lists'}</button>}
      {(listSel !== null || showLists) && (
        <nav className="tl-crumbs" aria-label="List path" data-testid="list-crumbs">
          <button type="button" onClick={() => { setListSel(null); if (!showLists) toggleLists(); }}>Lists</button><span>/</span>
          <b>{listSel === null ? 'All tasks' : listSel === INBOX ? 'Inbox' : listSel}</b>
          {listSel !== null && <button type="button" className="x" aria-label="Show all tasks" onClick={() => setListSel(null)}>Show all</button>}
        </nav>
      )}
      {view === 'list' && lg !== 'none' && lg !== 'priority' && otherGroups.length > 0 && <MiniCards groups={otherGroups} picked={gPick} onPick={setGPick} />}
      {view === 'table' ? <TaskTable rows={visibleTasks} toggle={toggle} open={(t) => setSheet({ task: t, isNew: false })} selMode={selMode} sel={sel} onSel={(t, shift) => toggleSel(t, shift, visibleIds)} /> : view === 'timeline' ? <TaskTimeline groups={groups} open={(t) => setSheet({ task: t, isNew: false })} /> : view === 'board' ? (
        <div className="s-board">
          {columns.map((c) => (
            <section key={c.key} data-col={c.key} className={`s-col${overCol === c.key ? ' over' : ''}`} style={{ background: `var(--s-${c.tone})` }} aria-labelledby={`s-col-${c.key}`} {...dropProps(c.key)}>
              <div className="s-col-head">
                <h2 id={`s-col-${c.key}`} className="s-col-title">{c.title}</h2>
                <span className="s-col-count">{c.items.length + (c.extra?.length || 0)}</span>
              </div>
              <div className="s-col-cards">
                {c.items.length === 0 && !c.extra?.length && <p className="s-empty small" style={{ padding: '0 4px' }}>{c.key === 'done' ? 'Finished tasks land here.' : 'Nothing here.'}</p>}
                {c.items.map((t) => card(t, c.key))}
                {c.extra?.length > 0 && (
                  <>
                    <span className="s-col-divider">Later</span>
                    {c.extra.map((t) => card(t, 'later'))}
                  </>
                )}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <div className="s-list">
          {shownGroups.map((g) => (
            <section key={g.key} className="s-list-group">
              <h2 className="s-col-title">{g.label} <span className="s-col-count">{g.items.length}</span></h2>
              {g.items.map((t) => card(t, g.key))}
            </section>
          ))}
        </div>
      )}
      {selMode && sel.size > 0 && <BulkBar count={sel.size} lists={knownLists} onDone={() => bDone()} onDate={(k) => bDate(k)} onMove={(n) => bMove(n)} onTag={(t) => bTag(t)} onPriority={(p) => bPrio(p)} onDelete={() => setConfirmDel(true)} onCancel={exitSelect} />}
      <UndoRedo canUndo={hist.current.undo.length > 0 && !hist.current.undo.at(-1).expired} canRedo={hist.current.redo.length > 0 && !!hist.current.redo.at(-1).redo} label={hist.current.undo.at(-1)?.label?.toLowerCase() || ''} onUndo={undoLast} onRedo={redoLast} />
      {keys && <ShortcutSheet onClose={() => setKeys(false)} />}
      {confirmDel && <DeleteConfirm {...delStats()} onCancel={() => setConfirmDel(false)} onConfirm={doDelete} />}
      {menu && <ListMenu list={menu.list} anchor={menu.anchor} onClose={() => setMenu(null)} onRename={renameList} onColor={colorList} onArchive={archiveList} onShare={(l) => setShareList(l)} onDelete={(l) => setDelList(l)} />}
      {shareList && <ShareList list={shareList} open={tasksOfList(shareList).filter((t) => !t.completed).length} onClose={() => setShareList(null)} />}
      {newList && <NewListDialog taken={allLists.map((l) => l.name)} onCreate={createList} onClose={() => setNewList(false)} />}
      {delList && <DeleteListDialog list={delList} open={tasksOfList(delList).filter((t) => !t.completed).length} done={tasksOfList(delList).filter((t) => t.completed).length} onCancel={() => setDelList(null)} onConfirm={(m) => confirmDeleteList(delList, m)} />}
      {sheet && <TaskSheet task={sheet.task} isNew={sheet.isNew} onClose={() => { setSheet(null); inputRef.current?.focus(); }} />}
      <UndoToast toast={toast} dismiss={dismiss} />
    </div>
  );
}

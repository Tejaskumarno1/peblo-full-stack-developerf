import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, ChevronDown, ChevronRight, X } from 'lucide-react';
import { todosAPI } from '../api';
import { RiverHeader } from './RiverShell';
import RSelect from './RSelect';
import UndoToast from '../components/UndoToast';
import { useUndoToast, useDeferredDelete } from '../utils/useUndoToast';
import { askScope } from '../utils/askScope';
import { parseTask } from '../utils/parseTask';
import { filterTasks, sortTasks, groupTasks, isOverdue, PRIORITY_LABEL, SHOW_OPTIONS, GROUP_OPTIONS, SORT_OPTIONS } from '../utils/taskView';
import { dueMomentOf, momentOf, isMeeting, clock, dayWord, tagsOfTask } from './riverUtils';

const OPTS_KEY = 'peblo-river-tasks-opts';
const loadOpts = () => { try { return { show: 'open', group: 'due', sort: 'due', ...JSON.parse(localStorage.getItem(OPTS_KEY) || '{}') }; } catch { return { show: 'open', group: 'due', sort: 'due' }; } };
const H = { whenOf: (t) => (isMeeting(t) ? momentOf(t) : dueMomentOf(t)), tagsOf: (t) => tagsOfTask(t).map(String), isMeeting };

/** River: Tasks as a list. Add, search, group, filter and sort every task, tick them off, change several at once. */
export default function RiverTaskList() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [opts, setOptsState] = useState(loadOpts);
  const [q, setQ] = useState('');
  const [draft, setDraft] = useState('');
  const [adding, setAdding] = useState(false);
  const [closed, setClosed] = useState(() => new Set());
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState(() => new Set());
  const { toast, say, dismiss } = useUndoToast();
  const setOpts = (patch) => setOptsState((o) => { const n = { ...o, ...patch }; try { localStorage.setItem(OPTS_KEY, JSON.stringify(n)); } catch { /* storage blocked */ } return n; });
  const refresh = () => qc.invalidateQueries();
  const { gone, schedule } = useDeferredDelete(async (id) => { await todosAPI.delete(id, 'this'); refresh(); });

  const { data: all = [], isLoading } = useQuery({
    queryKey: ['river', 'task-list'],
    queryFn: () => todosAPI.getAll().then((r) => r.data.todos || []),
  });

  const now = new Date();
  const shown = useMemo(
    () => sortTasks(filterTasks(all.filter((t) => !gone.includes(t.id)), { show: opts.show, q }, H), opts.sort, H),
    [all, gone, opts.show, opts.sort, q], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const groups = useMemo(() => groupTasks(shown, opts.group, H), [shown, opts.group]);

  const setDone = async (t, completed) => { await todosAPI.update(t.id, { completed }); refresh(); };
  const toggle = async (t) => {
    const next = !t.completed;
    await setDone(t, next);
    say(next ? 'Marked done' : 'Marked not done', () => setDone(t, !next));
  };
  const remove = async (t) => {
    if (t.seriesId) {
      const scope = await askScope(t, 'delete');
      if (!scope) return;
      await todosAPI.delete(t.id, scope);
      refresh();
      return;
    }
    schedule(t.id, t.text, say);
  };
  const open = (t) => navigate('/', { state: { select: t.id } });
  const flip = (key) => setClosed((s) => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n; });

  const parsed = draft.trim() ? parseTask(draft) : null;
  const add = async (e) => {
    e.preventDefault();
    if (!parsed || adding) return;
    setAdding(true);
    try {
      await todosAPI.create({ text: parsed.text || draft.trim(), priority: parsed.priority, tags: parsed.tags, deadline: parsed.deadline ? parsed.deadline.toISOString() : null });
      setDraft('');
      refresh();
    } finally { setAdding(false); }
  };

  // several at once
  const ids = [...picked].filter((id) => shown.some((t) => t.id === id));
  const bulk = async (label, patchFor) => {
    const chosen = shown.filter((t) => picked.has(t.id));
    const before = chosen.map((t) => ({ id: t.id, completed: t.completed, deadline: t.deadline, priority: t.priority }));
    await Promise.all(chosen.map((t) => todosAPI.update(t.id, patchFor(t))));
    refresh();
    say(`${label}: ${chosen.length} task${chosen.length === 1 ? '' : 's'}`, async () => {
      await Promise.all(before.map((b) => todosAPI.update(b.id, { completed: b.completed, deadline: b.deadline, priority: b.priority })));
      refresh();
    });
    setPicked(new Set());
  };
  const onDay = (days) => (t) => {
    const d = new Date(); d.setDate(d.getDate() + days);
    const old = t.deadline ? new Date(t.deadline) : null;
    if (old) d.setHours(old.getHours(), old.getMinutes(), 0, 0); else d.setHours(23, 59, 0, 0);
    return { deadline: d.toISOString() };
  };
  const bulkDelete = () => {
    shown.filter((t) => picked.has(t.id) && !t.seriesId).forEach((t) => schedule(t.id, t.text, say));
    setPicked(new Set());
  };

  const openCount = all.filter((t) => !t.completed).length;
  const lateCount = all.filter((t) => isOverdue(t, H, now)).length;
  const whenText = (t) => {
    const w = H.whenOf(t);
    if (!w) return 'No date';
    const timed = isMeeting(t) || w.getHours() !== 23 || w.getMinutes() !== 59;
    return `${dayWord(w)}${timed ? ' ' + clock(w) : ''}`;
  };

  return (
    <>
      <RiverHeader>
        <div className="r-when"><h1>Tasks</h1><span>{openCount} open{lateCount ? ` · ${lateCount} overdue` : ''}</span></div>
      </RiverHeader>
      <section className="r-tl" aria-label="Tasks">
        <form className="r-tl-add" onSubmit={add}>
          <label htmlFor="r-task-add" className="r-sr">Add a task</label>
          <input id="r-task-add" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder='Add a task… try "revise BCNF tomorrow !high #exams"' autoComplete="off" />
          {parsed?.deadline && <span className="r-tl-pre">{dayWord(parsed.deadline)}</span>}
          {parsed && parsed.priority !== 'medium' && <span className="r-tl-pre">{parsed.priority === 'high' ? 'High' : 'Low'}</span>}
          {parsed?.tags.map((t) => <span key={t} className="r-tl-pre">#{t}</span>)}
          <button type="submit" className="r-btn" disabled={!parsed || adding}>Add</button>
        </form>
        <div className="r-tl-bar">
          <label htmlFor="r-task-search" className="r-sr">Search tasks</label>
          <input id="r-task-search" type="search" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setQ('')} placeholder="Search tasks and tags…" />
          <RSelect label="Show" value={opts.show} onChange={(v) => setOpts({ show: v })} options={SHOW_OPTIONS} />
          <RSelect label="Group by" value={opts.group} onChange={(v) => setOpts({ group: v })} options={GROUP_OPTIONS} />
          <RSelect label="Sort" value={opts.sort} onChange={(v) => setOpts({ sort: v })} options={SORT_OPTIONS} />
          {opts.group !== 'none' && groups.length > 1 && (
            <button type="button" className="r-btn ghost small" onClick={() => setClosed(closed.size ? new Set() : new Set(groups.map((g) => g.key)))}>{closed.size ? 'Expand all' : 'Collapse all'}</button>
          )}
          <button type="button" className={`r-btn ghost small${picking ? ' on' : ''}`} aria-pressed={picking} onClick={() => { setPicking((v) => !v); setPicked(new Set()); }}>{picking ? 'Done selecting' : 'Select'}</button>
          <Link to="/" className="r-btn ghost small">Back to the river</Link>
        </div>
        {picking && (
          <div className="r-tl-bulk" role="toolbar" aria-label="Actions for the selected tasks">
            <b>{ids.length} selected</b>
            <button type="button" className="r-btn ghost small" onClick={() => setPicked(new Set(shown.map((t) => t.id)))}>All shown</button>
            <button type="button" className="r-btn ghost small" disabled={!ids.length} onClick={() => bulk('Marked done', () => ({ completed: true }))}>Mark done</button>
            <button type="button" className="r-btn ghost small" disabled={!ids.length} onClick={() => bulk('Moved to today', onDay(0))}>Move to today</button>
            <button type="button" className="r-btn ghost small" disabled={!ids.length} onClick={() => bulk('Moved to tomorrow', onDay(1))}>Move to tomorrow</button>
            <button type="button" className="r-btn ghost small" disabled={!ids.length} onClick={() => bulk('Set to high priority', () => ({ priority: 'high' }))}>High priority</button>
            <button type="button" className="r-btn ghost small danger" disabled={!ids.length} onClick={bulkDelete}>Delete</button>
          </div>
        )}
        {isLoading && <div className="r-tl-empty"><Loader2 className="r-spin" /></div>}
        {!isLoading && groups.length === 0 && <div className="r-tl-empty">{q.trim() ? 'No tasks match your search.' : 'Nothing here. Try another filter.'}</div>}
        {groups.map((g) => (
          <div key={g.key} className={`r-tl-group${g.key === 'late' ? ' late' : ''}`}>
            {opts.group !== 'none' && (
              <button type="button" className="r-tl-gh" aria-expanded={!closed.has(g.key)} onClick={() => flip(g.key)}>
                {closed.has(g.key) ? <ChevronRight size={15} /> : <ChevronDown size={15} />} {g.label} <span>{g.items.length}</span>
              </button>
            )}
            {!closed.has(g.key) && g.items.map((t) => (
              <div key={`${g.key}-${t.id}`} className={`r-tl-row${t.completed ? ' done' : ''}`}>
                {picking
                  ? <input type="checkbox" className="r-tl-pick" checked={picked.has(t.id)} onChange={() => setPicked((s) => { const n = new Set(s); if (n.has(t.id)) n.delete(t.id); else n.add(t.id); return n; })} aria-label={`Select: ${t.text}`} />
                  : <input type="checkbox" checked={!!t.completed} onChange={() => toggle(t)} aria-label={`Done: ${t.text}`} />}
                <button type="button" className="r-tl-main" onClick={() => open(t)}>
                  <span className="r-tl-text">{t.text}</span>
                  {H.tagsOf(t).map((tg) => <span key={tg} className="r-tl-tag">#{tg}</span>)}
                </button>
                <span className={`r-tl-pri ${t.priority || 'medium'}`} title={PRIORITY_LABEL[t.priority] || PRIORITY_LABEL.medium} />
                <span className={`r-tl-when${isOverdue(t, H, now) ? ' late' : ''}`}>{whenText(t)}</span>
                {!picking && <button type="button" className="r-tl-x" aria-label={`Delete: ${t.text}`} onClick={() => remove(t)}><X size={14} /></button>}
              </div>
            ))}
          </div>
        ))}
      </section>
      <UndoToast toast={toast} dismiss={dismiss} />
    </>
  );
}

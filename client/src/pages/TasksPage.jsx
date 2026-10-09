import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Sparkles, Plus, Trash2, ChevronLeft, ChevronRight, Repeat, FileText } from 'lucide-react';
import { todosAPI } from '../api';
import { parseTask } from '../utils/parseTask';
import { startOfWeek } from '../utils/weekStart';
import { askScope } from '../utils/askScope';
import '../styles/tasks.css';

const PRIORITY_RANK = { high: 0, medium: 1, low: 2 };

function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function sameDay(a, b) { return startOfDay(a).getTime() === startOfDay(b).getTime(); }

function dueLabel(t) {
  if (!t.deadline) return 'No date';
  const d = new Date(t.deadline);
  const today = startOfDay(new Date());
  const time = t.startTime || (d.getHours() === 23 && d.getMinutes() === 59 ? '' : d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false }));
  let day;
  if (sameDay(d, today)) day = time ? '' : 'Today';
  else if (sameDay(d, addDays(today, 1))) day = 'Tomorrow';
  else if (sameDay(d, addDays(today, -1))) day = 'Yesterday';
  else if (d > today && d < addDays(today, 7)) day = d.toLocaleDateString('en-IN', { weekday: 'short' });
  else day = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  return [day, time].filter(Boolean).join(' ');
}

export default function TasksPage() {
  // "Capture" buttons open this page with ?add=1: jump straight to the add box.
  const [params, setParams] = useSearchParams();
  useEffect(() => {
    if (params.get('add') !== '1') return;
    document.getElementById('task-add')?.focus();
    setParams({}, { replace: true });
  }, [params, setParams]);

  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [draft, setDraft] = useState('');
  const [tagFilter, setTagFilter] = useState('');
  const [showDone, setShowDone] = useState(false);
  const [weekOffset, setWeekOffset] = useState(0);
  const [selectedDay, setSelectedDay] = useState(() => startOfDay(new Date()));
  const [saving, setSaving] = useState(false);

  const { data: todos = [], isLoading } = useQuery({
    queryKey: ['todos', 'all'],
    queryFn: () => todosAPI.getAll().then((r) => r.data.todos || []),
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['todos'] });
    queryClient.invalidateQueries({ queryKey: ['dashboard'] });
  };

  const today = startOfDay(new Date());
  const tomorrow = addDays(today, 1);
  const weekEnd = addDays(today, 7);

  const allTags = useMemo(() => {
    const counts = new Map();
    for (const t of todos) for (const tag of Array.isArray(t.todoTags) ? t.todoTags : []) counts.set(tag, (counts.get(tag) || 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([t]) => t);
  }, [todos]);

  const visible = todos.filter((t) => (!tagFilter || (Array.isArray(t.todoTags) && t.todoTags.includes(tagFilter))));
  const open = visible.filter((t) => !t.completed);
  const done = visible.filter((t) => t.completed);

  const groups = useMemo(() => {
    const sort = (a, b) => (PRIORITY_RANK[a.priority] ?? 1) - (PRIORITY_RANK[b.priority] ?? 1) || new Date(a.deadline || 0) - new Date(b.deadline || 0);
    const g = [
      { key: 'overdue', name: 'Overdue', tone: 'danger', items: open.filter((t) => t.deadline && new Date(t.deadline) < today) },
      { key: 'today', name: 'Today', items: open.filter((t) => t.deadline && sameDay(t.deadline, today)) },
      { key: 'tomorrow', name: 'Tomorrow', items: open.filter((t) => t.deadline && sameDay(t.deadline, tomorrow)) },
      { key: 'week', name: 'Later this week', items: open.filter((t) => t.deadline && new Date(t.deadline) >= addDays(today, 2) && new Date(t.deadline) < weekEnd) },
      { key: 'later', name: 'Later', items: open.filter((t) => t.deadline && new Date(t.deadline) >= weekEnd).slice(0, 15) },
      { key: 'someday', name: 'No date', items: open.filter((t) => !t.deadline) },
    ];
    return g.filter((x) => x.items.length).map((x) => ({ ...x, items: [...x.items].sort(sort) }));
  }, [todos, tagFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  const preview = draft.trim() ? parseTask(draft) : null;

  const addTask = async (e) => {
    e.preventDefault();
    if (!draft.trim() || saving) return;
    const t = parseTask(draft);
    setSaving(true);
    try {
      await todosAPI.create({
        text: t.text || draft.trim(),
        priority: t.priority,
        tags: tagFilter && !t.tags.includes(tagFilter) ? [...t.tags, tagFilter] : t.tags,
        deadline: t.deadline ? t.deadline.toISOString() : null,
      });
      setDraft('');
      refresh();
    } finally {
      setSaving(false);
    }
  };

  const [actionError, setActionError] = useState('');
  const toggle = async (t) => {
    setActionError('');
    try { await todosAPI.update(t.id, { completed: !t.completed }); }
    catch { setActionError('Could not update that task. Try again.'); }
    refresh();
  };
  const remove = async (t) => {
    setActionError('');
    const scope = await askScope(t, 'delete');
    if (!scope) return;
    try { await todosAPI.delete(t.id, scope); }
    catch { setActionError('Could not delete that task. Try again.'); }
    refresh();
  };

  // Week strip + day timeline
  const weekStart = addDays(startOfWeek(today), weekOffset * 7);
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const dayTasks = todos.filter((t) => t.deadline && sameDay(t.deadline, selectedDay) && !t.completed);
  const timed = dayTasks
    .map((t) => {
      const d = new Date(t.deadline);
      const [sh, sm] = (t.startTime || '').split(':').map(Number);
      const [eh, em] = (t.endTime || '').split(':').map(Number);
      const start = !Number.isNaN(sh) && t.startTime ? sh + (sm || 0) / 60 : (d.getHours() === 23 && d.getMinutes() === 59 ? null : d.getHours() + d.getMinutes() / 60);
      const end = t.endTime && !Number.isNaN(eh) ? eh + (em || 0) / 60 : start !== null ? start + 0.75 : null;
      return { t, start, end };
    })
    .filter((x) => x.start !== null && x.start >= 6 && x.start < 23);
  const untimed = dayTasks.filter((t) => !timed.find((x) => x.t.id === t.id));
  const TL_START = 6; // the filter above keeps 06:00-22:59, so the timeline starts at 06:00
  const HOURS = Array.from({ length: 23 - TL_START }, (_, i) => TL_START + i);
  const HOUR_H = 44;

  return (
    <div className="tasks">
      <header className="pb-topbar">
        <span className="title">Tasks</span>
        <div className="pb-seg" style={{ marginLeft: 8 }}>
          <button type="button" className="on">List</button>
          <Link to="/calendar">Calendar</Link>
        </div>
        <span className="grow" />
        <button type="button" className="pb-btn soft" onClick={() => navigate(`/ai?q=${encodeURIComponent('Plan my day from my tasks and deadlines')}`)}>
          <Sparkles size={14} /> Plan my day
        </button>
      </header>

      <div className="tasks-body">
        <section className="tasks-main" aria-label="Task list">
          <div className="tasks-head">
            <div style={{ flex: 1, minWidth: 0 }}>
              <h1 className="pb-display">This week</h1>
              <p className="pb-muted">{open.length} open · {done.length} done{tagFilter ? ` · #${tagFilter}` : ''}</p>
            </div>
            <div className="tasks-filters">
              <button type="button" className={`pb-chip${!tagFilter ? ' on' : ''}`} onClick={() => setTagFilter('')}>All</button>
              {allTags.map((tag) => (
                <button key={tag} type="button" className={`pb-chip${tagFilter === tag ? ' on' : ''}`} onClick={() => setTagFilter(tagFilter === tag ? '' : tag)}>#{tag}</button>
              ))}
            </div>
          </div>

          <form className="tasks-add" onSubmit={addTask}>
            <Plus size={16} color="var(--pb-fg-3)" />
            <label htmlFor="task-add" className="sr-only">New task</label>
            <input id="task-add" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder='Add a task… try "Submit lab record tomorrow !high #college"' autoComplete="off" />
            {preview && (
              <span className="tasks-add-preview">
                {preview.deadline && <span className="pb-badge accent">{preview.deadline.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}</span>}
                {preview.priority !== 'medium' && <span className={`pb-badge ${preview.priority === 'high' ? 'danger' : ''}`}>{preview.priority}</span>}
                {preview.tags.map((t) => <span key={t} className="pb-badge">#{t}</span>)}
              </span>
            )}
            <button type="submit" className="pb-btn primary sm" disabled={!draft.trim() || saving}>Add</button>
          </form>

          {actionError && <p role="alert" className="pb-muted" style={{ color: 'var(--pb-danger, #c0392b)' }}>{actionError}</p>}
          {isLoading ? (
            <div className="pb-empty">Loading tasks…</div>
          ) : groups.length === 0 && !done.length ? (
            <div className="pb-empty">No tasks yet. Type one above; dates like "friday" and tags like #college are understood.</div>
          ) : (
            groups.map((g) => (
              <div key={g.key} className="tasks-group">
                <div className={`tasks-group-head ${g.tone || ''}`}>
                  <span>{g.name}</span><span className="pb-muted">{g.items.length}</span>
                </div>
                {g.items.map((t) => (
                  <TaskRow key={t.id} t={t} overdue={g.key === 'overdue'} onToggle={toggle} onRemove={remove} />
                ))}
              </div>
            ))
          )}

          {done.length > 0 && (
            <div className="tasks-group">
              <button type="button" className="tasks-group-head as-button" onClick={() => setShowDone((v) => !v)}>
                <span>Done</span><span className="pb-muted">{done.length}</span><span className="pb-link" style={{ marginLeft: 'auto' }}>{showDone ? 'Hide' : 'Show'}</span>
              </button>
              {showDone && done.slice(0, 30).map((t) => <TaskRow key={t.id} t={t} onToggle={toggle} onRemove={remove} />)}
            </div>
          )}
        </section>

        <aside className="tasks-plan" aria-label="Day plan">
          <div className="tasks-plan-head">
            <span style={{ fontWeight: 600, flex: 1 }}>{weekStart.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}</span>
            <button type="button" className="pb-icon-btn bordered" aria-label="Previous week" onClick={() => setWeekOffset((w) => w - 1)}><ChevronLeft size={14} /></button>
            <button type="button" className="pb-icon-btn bordered" aria-label="Next week" onClick={() => setWeekOffset((w) => w + 1)}><ChevronRight size={14} /></button>
          </div>
          <div className="tasks-week">
            {weekDays.map((d) => {
              const count = todos.filter((t) => t.deadline && !t.completed && sameDay(t.deadline, d)).length;
              const sel = sameDay(d, selectedDay);
              return (
                <button key={d.toISOString()} type="button" className={`tasks-day${sel ? ' sel' : ''}${sameDay(d, today) ? ' today' : ''}`} onClick={() => setSelectedDay(d)}>
                  <span className="dow">{d.toLocaleDateString('en-IN', { weekday: 'short' }).toUpperCase()}</span>
                  <span className="num">{d.getDate()}</span>
                  <span className="dot" style={{ opacity: count ? 1 : 0 }} />
                </button>
              );
            })}
          </div>

          <div className="tasks-plan-sub">
            <span>{sameDay(selectedDay, today) ? 'Today' : selectedDay.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short' })}</span>
            <span className="pb-muted">{dayTasks.length} task{dayTasks.length === 1 ? '' : 's'}</span>
          </div>

          {untimed.length > 0 && (
            <div className="tasks-untimed">
              {untimed.map((t) => (
                <div key={t.id} className={`tasks-untimed-item ${t.priority}`}>{t.text}</div>
              ))}
            </div>
          )}

          <div className="tasks-timeline" style={{ height: HOURS.length * HOUR_H }}>
            {HOURS.map((h, i) => (
              <div key={h} className="tasks-hour" style={{ top: i * HOUR_H }}>
                <span>{String(h).padStart(2, '0')}:00</span>
              </div>
            ))}
            {timed.map(({ t, start, end }) => (
              <div
                key={t.id}
                className={`tasks-block ${t.priority}`}
                style={{ top: (start - TL_START) * HOUR_H + 2, height: Math.max((end - start) * HOUR_H - 4, 40) }}
                title={t.text}
              >
                <span className="t">{t.text}</span>
                <span className="m">{t.startTime || new Date(t.deadline).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false })}{t.endTime ? ` – ${t.endTime}` : ''}</span>
              </div>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}

function TaskRow({ t, overdue, onToggle, onRemove }) {
  const [confirming, setConfirming] = useState(false);
  const tags = Array.isArray(t.todoTags) ? t.todoTags : [];
  return (
    <div className={`tasks-row${t.completed ? ' done' : ''}`}>
      <input type="checkbox" className="pb-check" checked={!!t.completed} onChange={() => onToggle(t)} aria-label={`Mark "${t.text}" ${t.completed ? 'not done' : 'done'}`} />
      <span className="tasks-row-text">
        <span className="title">{t.text}</span>
        <span className="pb-muted meta">
          {t.recurrence && t.recurrence !== 'none' && <><Repeat size={11} /> repeats {t.recurrence}</>}
          {t.note?.title && <Link to={`/notes/${t.note.id}`} className="tasks-note-link"><FileText size={11} /> {t.note.title}</Link>}
        </span>
      </span>
      {tags.slice(0, 2).map((tag) => <span key={tag} className="pb-badge">#{tag}</span>)}
      <span className={`tasks-due${overdue ? ' late' : ''}`}>{dueLabel(t)}</span>
      <span className="tasks-prio">
        {t.priority === 'high' && <span className="pb-badge danger">High</span>}
        {t.priority === 'low' && <span className="pb-muted" style={{ fontSize: 11 }}>Low</span>}
      </span>
      {confirming ? (
        <span className="tasks-del-confirm">
          <button type="button" className="pb-btn sm danger" onClick={() => { setConfirming(false); onRemove(t); }}>Delete</button>
          <button type="button" className="pb-btn sm" onClick={() => setConfirming(false)}>Keep</button>
        </span>
      ) : (
        <button type="button" className="pb-icon-btn tasks-del" aria-label={`Delete "${t.text}"`} onClick={() => (t.seriesId ? onRemove(t) : setConfirming(true))}><Trash2 size={14} /></button>
      )}
    </div>
  );
}

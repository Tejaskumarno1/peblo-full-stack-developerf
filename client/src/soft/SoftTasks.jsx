import { useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { todosAPI } from '../api';
import { parseTask } from '../utils/parseTask';
import { askScope } from '../utils/askScope';
import { timeOf, dayChip, daysFromToday, weekdayLong, startOfDay, addDays, tagsOf } from './softUtils';

/** Soft Studio · Tasks (mockup: SoftTasks). A board of Today, Tomorrow, This week and Done. */
export default function SoftTasks() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [view, setView] = useState('board');
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const inputRef = useRef(null);

  const { data: todos = [] } = useQuery({ queryKey: ['todos', 'all'], queryFn: () => todosAPI.getAll().then((r) => r.data.todos || []) });

  const groups = useMemo(() => {
    const open = todos.filter((t) => !t.completed);
    const rank = { high: 0, medium: 1, low: 2 };
    // Important first, then by time (the mockup lists the !high task before earlier ones)
    const byDue = (a, b) => (rank[a.priority] ?? 1) - (rank[b.priority] ?? 1) || new Date(a.deadline || 8.64e15) - new Date(b.deadline || 8.64e15);
    const overdue = open.filter((t) => t.deadline && daysFromToday(t.deadline) < 0).sort((a, b) => new Date(a.deadline) - new Date(b.deadline));
    const today = open.filter((t) => t.deadline && daysFromToday(t.deadline) === 0).sort(byDue);
    const tomorrow = open.filter((t) => t.deadline && daysFromToday(t.deadline) === 1).sort(byDue);
    const week = open.filter((t) => t.deadline && daysFromToday(t.deadline) >= 2 && daysFromToday(t.deadline) <= 6).sort((a, b) => new Date(a.deadline) - new Date(b.deadline));
    const later = open.filter((t) => !t.deadline || daysFromToday(t.deadline) > 6).sort((a, b) => new Date(a.deadline || 8.64e15) - new Date(b.deadline || 8.64e15));
    const weekAgo = addDays(startOfDay(), -6);
    const done = todos.filter((t) => t.completed && new Date(t.updatedAt) >= weekAgo).sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    return { overdue, today, tomorrow, week, later, done, open };
  }, [todos]);

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
  const toggle = async (t) => {
    queryClient.setQueryData(['todos', 'all'], (old) => (old || []).map((x) => (x.id === t.id ? { ...x, completed: !x.completed, updatedAt: new Date().toISOString() } : x)));
    await todosAPI.update(t.id, { completed: !t.completed });
    refresh();
  };
  const remove = async (t) => {
    const scope = t.seriesId ? await askScope(t, 'delete') : (window.confirm(`Delete "${t.text}"?`) ? 'this' : null);
    if (!scope) return;
    if (scope === 'this') queryClient.setQueryData(['todos', 'all'], (old) => (old || []).filter((x) => x.id !== t.id));
    await todosAPI.delete(t.id, scope);
    refresh();
  };

  const parsed = draft.trim() ? parseTask(draft) : null;
  const add = async (e) => {
    e.preventDefault();
    if (!parsed || saving) return;
    setSaving(true);
    try {
      await todosAPI.create({ text: parsed.text || draft.trim(), priority: parsed.priority, tags: parsed.tags, deadline: parsed.deadline ? parsed.deadline.toISOString() : null });
      setDraft('');
      refresh();
      inputRef.current?.focus();
    } finally {
      setSaving(false);
    }
  };

  const chipsFor = (t, column) => {
    const out = [];
    const days = t.deadline ? daysFromToday(t.deadline) : null;
    if (days !== null && days < 0) out.push({ label: `From ${days === -1 ? 'yesterday' : weekdayLong(t.deadline)}`, kind: 'late' });
    else if (t.deadline && (column === 'today' || column === 'tomorrow')) { if (timeOf(t)) out.push({ label: timeOf(t) }); }
    else if (t.deadline && column !== 'done') out.push({ label: `${dayChip(t.deadline)}${timeOf(t) ? ` ${timeOf(t)}` : ''}` });
    else if (column === 'done') out.push({ label: dayChip(t.updatedAt) });
    if (t.priority === 'high' && column !== 'done') out.push({ label: 'High', kind: 'high' });
    for (const tag of tagsOf(t).slice(0, 2)) out.push({ label: `#${tag}` });
    return out;
  };

  const card = (t, column) => (
    <div key={t.id} className={`s-card${t.completed ? ' done' : ''}`}>
      <input type="checkbox" className="s-check small" checked={!!t.completed} onChange={() => toggle(t)} aria-label={`Mark "${t.text}" ${t.completed ? 'not done' : 'done'}`} />
      <div className="s-card-body">
        <span className="t">{t.text}</span>
        <span className="s-card-chips">
          {chipsFor(t, column).map((c) => <span key={c.label} className={`s-mini ${c.kind || ''}`}>{c.label}</span>)}
          {t.note && <Link to={`/notes/${t.note.id}`} className="s-mini note">{t.note.title || 'Note'}</Link>}
        </span>
      </div>
      <button type="button" className="s-card-x" aria-label={`Delete "${t.text}"`} onClick={() => remove(t)}><X size={14} strokeWidth={2.4} /></button>
    </div>
  );

  const columns = [
    { key: 'today', title: 'Today', tone: 'peach', items: [...groups.overdue, ...groups.today] },
    { key: 'tomorrow', title: 'Tomorrow', tone: 'mint', items: groups.tomorrow },
    { key: 'week', title: 'This week', tone: 'lilac', items: groups.week, extra: groups.later },
    { key: 'done', title: 'Done', tone: 'butter', items: groups.done.slice(0, 12) },
  ];

  return (
    <div className="soft-page s-tasks">
      <div className="s-page-head">
        <div className="s-page-title">
          <h1 className="s-h1">Tasks</h1>
          <span className="s-sub">{subtitle}</span>
        </div>
        <span className="grow" />
        <div className="s-seg" role="tablist" aria-label="View">
          <button type="button" role="tab" aria-selected={view === 'board'} className={view === 'board' ? 'on' : ''} onClick={() => setView('board')}>Board</button>
          <button type="button" role="tab" aria-selected={view === 'list'} className={view === 'list' ? 'on' : ''} onClick={() => setView('list')}>List</button>
          <button type="button" role="tab" aria-selected={false} onClick={() => navigate('/calendar')}>Timeline</button>
        </div>
      </div>

      <form className="s-addbar" onSubmit={add}>
        <label htmlFor="task-add" className="s-sr">Add a task</label>
        <input id="task-add" ref={inputRef} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder='Add a task… try "revise BCNF tomorrow !high #exams"' autoComplete="off" />
        {parsed?.deadline && <span className="s-tag" style={{ background: 'var(--s-mint)', padding: '7px 12px' }}>{dayChip(parsed.deadline)}</span>}
        {parsed && parsed.priority !== 'medium' && <span className="s-tag" style={{ background: 'var(--s-peach)', padding: '7px 12px' }}>{parsed.priority === 'high' ? 'High' : 'Low'}</span>}
        {parsed?.tags.map((t) => <span key={t} className="s-tag" style={{ background: 'var(--s-butter)', padding: '7px 12px' }}>#{t}</span>)}
        <button type="submit" className="s-accent-btn" disabled={!parsed || saving}>Add</button>
      </form>

      {view === 'board' ? (
        <div className="s-board">
          {columns.map((c) => (
            <section key={c.key} className="s-col" style={{ background: `var(--s-${c.tone})` }} aria-labelledby={`s-col-${c.key}`}>
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
          {columns.filter((c) => c.items.length || c.extra?.length).map((c) => (
            <section key={c.key} className="s-list-group">
              <h2 className="s-col-title"><span className="blob" style={{ background: `var(--s-${c.tone})` }} aria-hidden="true" />{c.title}</h2>
              {c.items.map((t) => card(t, c.key))}
              {c.extra?.map((t) => card(t, 'later'))}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

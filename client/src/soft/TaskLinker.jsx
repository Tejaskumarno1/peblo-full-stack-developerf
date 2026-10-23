import { useMemo, useState } from 'react';
import { Search, X } from 'lucide-react';
import { dayChip, daysFromToday, tagsOf, timeOf } from './softUtils';

/** "Link a task" card for a note: a titled search with filters and rows showing due date and tags. */
export default function TaskLinker({ noteTitle, tasks, onLink, onCreate, onClose }) {
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('open'); // open | soon | nodate
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return tasks
      .filter((t) => !s || t.text.toLowerCase().includes(s))
      .filter((t) => (filter === 'soon' ? t.deadline && daysFromToday(t.deadline) <= 3 : filter === 'nodate' ? !t.deadline : true))
      .slice(0, 6);
  }, [tasks, q, filter]);

  return (
    <div className="s-linker" role="dialog" aria-label="Link a task">
      <div className="s-linker-head">
        <div><b>Link a task</b><small>to “{noteTitle || 'this note'}”</small></div>
        <button type="button" aria-label="Close" onClick={onClose}><X size={14} /></button>
      </div>
      <label className="s-linker-search"><Search size={15} /><input autoFocus aria-label="Search tasks" placeholder="Search your tasks" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }} /></label>
      <div className="s-linker-filters" role="tablist" aria-label="Filter tasks">
        {[['open', 'Open'], ['soon', 'Due soon'], ['nodate', 'No date']].map(([k, name]) => <button key={k} type="button" role="tab" aria-selected={filter === k} className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>{name}</button>)}
      </div>
      <div className="s-linker-list">
        {list.length === 0 && <p className="s-empty small" style={{ padding: '6px 10px' }}>No task matches.</p>}
        {list.map((t) => (
          <button key={t.id} type="button" className="s-linker-row" onClick={() => onLink(t.id)}>
            <span className="ring" aria-hidden="true" />
            <span className="txt">
              <b>{t.text}</b>
              <span className="chips">
                <span className="c" style={{ background: t.deadline && daysFromToday(t.deadline) <= 0 ? 'var(--s-peach)' : t.deadline ? 'var(--s-sky)' : 'var(--s-item)' }}>{t.deadline ? `${dayChip(t.deadline)}${timeOf(t) ? ` ${timeOf(t)}` : ''}` : 'No date'}</span>
                {tagsOf(t).slice(0, 2).map((g) => <span key={g} className="c" style={{ background: 'var(--s-butter)' }}>#{g}</span>)}
              </span>
            </span>
          </button>
        ))}
      </div>
      {q.trim() && <button type="button" className="s-linker-new" onClick={() => onCreate(q.trim())}>+ Create “{q.trim().slice(0, 40)}” as a new task</button>}
    </div>
  );
}

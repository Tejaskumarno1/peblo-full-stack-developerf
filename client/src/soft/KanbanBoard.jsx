// Status board (mockups K02, K08, K09): To do / In progress / In review / Done, drag a card to change its status.
import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { todosAPI } from '../api';

const COLS = [
  ['todo', 'To do', 'peach'],
  ['doing', 'In progress', 'sky'],
  ['review', 'In review', 'lilac'],
  ['done', 'Done', 'butter'],
];
const LIMIT = 8;

export const columnOf = (t) => (t.completed ? 'done' : t.meta?.status === 'doing' || t.meta?.status === 'review' ? t.meta.status : 'todo');
const assigneesOf = (t) => (Array.isArray(t.meta?.assignees) && t.meta.assignees.length ? t.meta.assignees : t.assigneeId ? [t.assigneeId] : []);

export default function KanbanBoard({ tasks, team, card, onError }) {
  const queryClient = useQueryClient();
  const [who, setWho] = useState('all'); // all | me | <userId>
  const [only, setOnly] = useState('all'); // all | overdue
  const [dragId, setDragId] = useState(null);
  const [over, setOver] = useState(null);
  const [more, setMore] = useState({});

  const shown = useMemo(() => tasks.filter((t) => {
    if (who !== 'all') {
      const a = assigneesOf(t);
      if (!a.includes(who === 'me' ? team.me : who)) return false;
    }
    if (only === 'overdue' && (t.completed || !t.deadline || new Date(t.deadline) >= new Date())) return false;
    return true;
  }), [tasks, who, only, team.me]);

  const move = async (id, col) => {
    const t = tasks.find((x) => x.id === id);
    if (!t || columnOf(t) === col) return;
    queryClient.setQueryData(['todos', 'all'], (o) => (o || []).map((x) => (x.id === id ? { ...x, completed: col === 'done', meta: { ...(x.meta || {}), status: col === 'doing' || col === 'review' ? col : null } } : x)));
    try { await todosAPI.update(id, { column: col, scope: 'this' }); } catch { onError?.('Could not move that task.'); }
    queryClient.invalidateQueries({ queryKey: ['todos'] });
  };

  const people = team.canAssign ? team.people : [];
  return (
    <div data-testid="kanban">
      <div className="kb-filters" role="group" aria-label="Filter the board">
        {people.length > 0 && (
          <>
            <button type="button" className={who === 'all' ? 'on' : ''} aria-pressed={who === 'all'} onClick={() => setWho('all')}>Everyone</button>
            <button type="button" className={who === 'me' ? 'on' : ''} aria-pressed={who === 'me'} data-testid="kb-me" onClick={() => setWho('me')}>Mine</button>
            {people.filter((p) => p.id !== team.me).map((p) => <button key={p.id} type="button" className={who === p.id ? 'on' : ''} aria-pressed={who === p.id} onClick={() => setWho(p.id)}>{p.name.split(' ')[0]}</button>)}
            <span className="kb-sep" aria-hidden />
          </>
        )}
        <button type="button" className={only === 'overdue' ? 'on' : ''} aria-pressed={only === 'overdue'} onClick={() => setOnly(only === 'overdue' ? 'all' : 'overdue')}>Overdue</button>
      </div>
      <div className="s-board kb-board">
        {COLS.map(([key, title, tone]) => {
          const items = shown.filter((t) => columnOf(t) === key);
          const open = more[key];
          const list = open ? items : items.slice(0, LIMIT);
          return (
            <section key={key} data-col={key} className={`s-col${over === key ? ' over' : ''}`} style={{ background: `var(--s-${tone})` }} aria-labelledby={`kb-${key}`}
              onDragOver={(e) => { e.preventDefault(); setOver(key); }}
              onDragLeave={() => setOver((c) => (c === key ? null : c))}
              onDrop={(e) => { e.preventDefault(); const id = e.dataTransfer.getData('text/plain') || dragId; setOver(null); setDragId(null); if (id) move(id, key); }}>
              <div className="s-col-head">
                <h2 id={`kb-${key}`} className="s-col-title">{title}</h2>
                <span className="s-col-count" data-testid={`kb-count-${key}`}>{items.length}</span>
              </div>
              <div className="s-col-cards">
                {items.length === 0 && <p className="s-empty small" style={{ padding: '0 4px' }}>{key === 'done' ? 'Finished tasks land here.' : key === 'todo' ? 'Nothing waiting.' : 'Drag a card here.'}</p>}
                {list.map((t) => <div key={t.id} draggable data-kb-card={t.id} onDragStart={(e) => { e.dataTransfer.setData('text/plain', t.id); setDragId(t.id); }} onDragEnd={() => { setDragId(null); setOver(null); }}>{card(t, key)}</div>)}
                {items.length > LIMIT && <button type="button" className="kb-more" onClick={() => setMore({ ...more, [key]: !open })}>{open ? 'Show less' : `Show ${items.length - LIMIT} more`}</button>}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

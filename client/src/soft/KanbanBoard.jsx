// Status board (mockups K02, K08, K09): To do / In progress / In review / Done, drag a card to change its status.
import { useEffect, useMemo, useState } from 'react';
import { Clock, Filter, AlertTriangle, ChevronDown } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { todosAPI } from '../api';
import './teamshare.css';

const COLS = [
  ['todo', 'To do', 'peach'],
  ['doing', 'In progress', 'sky'],
  ['review', 'In review', 'lilac'],
  ['done', 'Done', 'butter'],
];
const limitFor = (h) => (h <= 900 ? 3 : h <= 1080 ? 5 : 8);
const AV = ['#FFD8C2', '#CDEFDC', '#FFE594', '#D3E6FF', '#E4DAFB'];
const avOf = (id) => AV[[...String(id)].reduce((a, ch) => a + ch.charCodeAt(0), 0) % AV.length];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const dayChip = (d) => { const x = new Date(d); const t = new Date(); t.setHours(0,0,0,0); const diff = Math.round((new Date(x.getFullYear(), x.getMonth(), x.getDate()) - t) / 864e5); return diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow' : diff > 1 && diff < 7 ? DAYS[x.getDay()] : x.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }); };
const lateDays = (d) => Math.max(1, Math.ceil((Date.now() - new Date(d).getTime()) / 864e5) - (new Date(d).getHours() === 0 ? 0 : 0));

export const columnOf = (t) => (t.completed ? 'done' : t.meta?.status === 'doing' || t.meta?.status === 'review' ? t.meta.status : 'todo');
const assigneesOf = (t) => (Array.isArray(t.meta?.assignees) && t.meta.assignees.length ? t.meta.assignees : t.assigneeId ? [t.assigneeId] : []);


export default function KanbanBoard({ tasks, team, open, onError }) {
  const queryClient = useQueryClient();
  const [who, setWho] = useState('all'); // all | me | <userId>
  const [menu, setMenu] = useState(false);
  const [only, setOnly] = useState('all'); // all | overdue
  const [dragId, setDragId] = useState(null);
  const [over, setOver] = useState(null);
  const [more, setMore] = useState({});
  const [lim, setLim] = useState(() => limitFor(typeof window === 'undefined' ? 900 : window.innerHeight));
  useEffect(() => { const on = () => setLim(limitFor(window.innerHeight)); window.addEventListener('resize', on); return () => window.removeEventListener('resize', on); }, []);

  const isLate = (t) => !t.completed && t.deadline && new Date(t.deadline) < new Date();
  const byWho = useMemo(() => tasks.filter((t) => who === 'all' || assigneesOf(t).includes(who === 'me' ? team.me : who)), [tasks, who, team.me]);
  const lateCount = byWho.filter(isLate).length;
  const shown = only === 'overdue' ? byWho.filter(isLate) : byWho;

  const move = async (id, col) => {
    const t = tasks.find((x) => x.id === id);
    if (!t || columnOf(t) === col) return;
    queryClient.setQueryData(['todos', 'all'], (o) => (o || []).map((x) => (x.id === id ? { ...x, completed: col === 'done', meta: { ...(x.meta || {}), status: col === 'doing' || col === 'review' ? col : null } } : x)));
    try { await todosAPI.update(id, { column: col, scope: 'this' }); } catch { onError?.('Could not move that task.'); }
    queryClient.invalidateQueries({ queryKey: ['todos'] });
  };

  const people = team.canAssign ? team.people : [];
  const whoLabel = who === 'all' ? 'Everyone' : who === 'me' ? 'Mine only' : `${(people.find((p) => p.id === who)?.name || '').split(' ')[0]} only`;
  const pick = (v) => { setWho(v); setMenu(false); };
  const nameOf = (id) => (id === team.me ? 'You' : people.find((p) => p.id === id)?.name || 'Someone');

  return (
    <div data-testid="kanban" className="kb">
      <div className="kb-filters" role="group" aria-label="Filter the board">
        {people.length > 0 && (
          <div className="kb-who">
            <button type="button" className={`kb-pill${who !== 'all' ? ' dark' : ''}`} data-testid="kb-who" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)}><Filter size={16} />{whoLabel}<ChevronDown size={14} /></button>
            {menu && (
              <div className="kb-menu" role="menu">
                <button type="button" role="menuitemradio" aria-checked={who === 'all'} onClick={() => pick('all')}>Everyone</button>
                <button type="button" role="menuitemradio" aria-checked={who === 'me'} data-testid="kb-me" onClick={() => pick('me')}>Mine only</button>
                {people.filter((p) => p.id !== team.me).map((p) => <button key={p.id} type="button" role="menuitemradio" aria-checked={who === p.id} onClick={() => pick(p.id)}>{p.name.split(' ')[0]} only</button>)}
              </div>
            )}
          </div>
        )}
        <button type="button" className={`kb-pill late${only === 'overdue' ? ' on' : ''}`} aria-pressed={only === 'overdue'} data-testid="kb-overdue" onClick={() => setOnly(only === 'overdue' ? 'all' : 'overdue')}><AlertTriangle size={16} />Overdue {lateCount}</button>
      </div>
      <div className="kb-board">
        {COLS.map(([key, title]) => {
          const items = shown.filter((t) => columnOf(t) === key);
          const expanded = more[key];
          const list = expanded ? items : items.slice(0, lim);
          return (
            <section key={key} data-col={key} className={`kb-col${over === key ? ' over' : ''}`} aria-labelledby={`kb-${key}`}
              onDragOver={(e) => { e.preventDefault(); setOver(key); }}
              onDragLeave={() => setOver((c) => (c === key ? null : c))}
              onDrop={(e) => { e.preventDefault(); const id = e.dataTransfer.getData('text/plain') || dragId; setOver(null); setDragId(null); if (id) move(id, key); }}>
              <div className={`kb-head ${key}`}>
                <h2 id={`kb-${key}`}>{title}</h2>
                <span className="kb-n" data-testid={`kb-count-${key}`}>{items.length}</span>
              </div>
              <div className="kb-cards">
                {items.length === 0 && <p className="kb-empty">{key === 'done' ? 'Finished tasks land here.' : key === 'todo' ? 'Nothing waiting.' : 'Drag a card here.'}</p>}
                {list.map((t) => {
                  const a = assigneesOf(t);
                  return (
                    <div key={t.id} className="kb-card" data-testid="task-card" draggable data-kb-card={t.id} onDragStart={(e) => { e.dataTransfer.setData('text/plain', t.id); setDragId(t.id); }} onDragEnd={() => { setDragId(null); setOver(null); }}>
                      <button type="button" className={`kb-t${t.completed ? ' done' : ''}`} onClick={() => open(t)}>{t.text}</button>
                      {(t.deadline || t.note) && (
                        <div className="kb-chips">
                          {t.deadline && <span className={`kb-chip${isLate(t) ? ' late' : ''}`}><Clock size={12} />{isLate(t) ? `${Math.max(1, Math.floor((Date.now() - new Date(t.deadline).getTime()) / 864e5))} d late` : dayChip(t.deadline)}</span>}
                          {t.note && <span className="kb-chip">{t.note.title || 'Note'}</span>}
                        </div>
                      )}
                      {a.length > 0 && <div className="kb-av">{a.slice(0, 4).map((id) => <span key={id} className="kb-a" style={{ background: avOf(id) }} title={nameOf(id)} data-testid="kb-avatar">{nameOf(id).trim()[0]?.toUpperCase()}</span>)}</div>}
                    </div>
                  );
                })}
              </div>
              {items.length > lim && <button type="button" className="kb-more" onClick={() => setMore({ ...more, [key]: !expanded })}>{expanded ? 'Show less' : `Show ${items.length - lim} more`}</button>}
            </section>
          );
        })}
      </div>
    </div>
  );
}

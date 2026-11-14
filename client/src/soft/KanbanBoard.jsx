// Status board (mockups K02, K08, K09): your columns, drag a card to change its status, collapse a column to a strip.
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Clock, Filter, AlertTriangle, ChevronDown, ChevronsLeft, ChevronsRight, Plus, Settings2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { todosAPI } from '../api';
import { useBoardColumns, columnFor } from './useBoard';
import AssignDialog, { avColor } from './AssignDialog';
import './teamshare.css';

const limitFor = (h) => (h <= 900 ? 3 : h <= 1080 ? 5 : 8);
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const dayChip = (d) => { const x = new Date(d); const t = new Date(); t.setHours(0, 0, 0, 0); const diff = Math.round((new Date(x.getFullYear(), x.getMonth(), x.getDate()) - t) / 864e5); return diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow' : diff > 1 && diff < 7 ? DAYS[x.getDay()] : x.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }); };
const assigneesOf = (t) => (Array.isArray(t.meta?.assignees) && t.meta.assignees.length ? t.meta.assignees : t.assigneeId ? [t.assigneeId] : []);
const stored = (k) => { try { return JSON.parse(localStorage.getItem(k) || '{}') || {}; } catch { return {}; } };

export default function KanbanBoard({ tasks, team, open, onError, slot }) {
  const queryClient = useQueryClient();
  const { columns, canEdit, space } = useBoardColumns();
  const keys = useMemo(() => columns.map((c) => c.key), [columns]);
  const [who, setWho] = useState('all'); // all | me | <userId>
  const [menu, setMenu] = useState(false);
  const [only, setOnly] = useState('all'); // all | overdue
  const [dragId, setDragId] = useState(null);
  const [over, setOver] = useState(null);
  const [more, setMore] = useState({});
  const [asg, setAsg] = useState(null); // task id being assigned
  const colKey = `peblo-kb-collapsed-${space || 'personal'}`;
  const [fold, setFold] = useState(() => stored(colKey)); // key -> true/false; missing = automatic
  useEffect(() => { setFold(stored(colKey)); }, [colKey]);
  const setFolded = (key, v) => setFold((f) => { const n = { ...f, [key]: v }; try { localStorage.setItem(colKey, JSON.stringify(n)); } catch { /* ignore */ } return n; });
  const [lim, setLim] = useState(() => limitFor(typeof window === 'undefined' ? 900 : window.innerHeight));
  useEffect(() => { const on = () => setLim(limitFor(window.innerHeight)); window.addEventListener('resize', on); return () => window.removeEventListener('resize', on); }, []);

  const isLate = (t) => !t.completed && t.deadline && new Date(t.deadline) < new Date();
  const byWho = useMemo(() => tasks.filter((t) => who === 'all' || assigneesOf(t).includes(who === 'me' ? team.me : who)), [tasks, who, team.me]);
  const lateCount = byWho.filter(isLate).length;
  const shown = only === 'overdue' ? byWho.filter(isLate) : byWho;

  const move = async (id, col) => {
    const t = tasks.find((x) => x.id === id);
    if (!t || columnFor(t, keys) === col) return;
    queryClient.setQueryData(['todos', 'all'], (o) => (o || []).map((x) => (x.id === id ? { ...x, completed: col === 'done', meta: { ...(x.meta || {}), status: col === 'todo' || col === 'done' ? null : col } } : x)));
    try { await todosAPI.update(id, { column: col, scope: 'this' }); } catch { onError?.('Could not move that task.'); }
    queryClient.invalidateQueries({ queryKey: ['todos'] });
  };

  const [adding, setAdding] = useState(null); // column key with the add-task row open
  const [draft, setDraft] = useState('');
  const addTask = async (key) => {
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    try { await todosAPI.create({ text, column: key }); queryClient.invalidateQueries({ queryKey: ['todos'] }); } catch (e) { onError?.(e.response?.data?.error || 'Could not add that task.'); }
  };
  const people = team.canAssign ? team.people : [];
  const setPeople = async (t, next) => {
    queryClient.setQueryData(['todos', 'all'], (o) => (o || []).map((x) => (x.id === t.id ? { ...x, assigneeId: next[0] || null, meta: { ...(x.meta || {}), assignees: next } } : x)));
    try { await todosAPI.update(t.id, { assignees: next, scope: 'this' }); } catch { onError?.('Could not change who is on that task.'); }
    queryClient.invalidateQueries({ queryKey: ['todos'] });
  };
  const asgTask = asg ? tasks.find((t) => t.id === asg) : null;
  const toggleAssignee = (id) => { if (!asgTask) return; const cur = assigneesOf(asgTask); setPeople(asgTask, cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]); };

  const whoLabel = who === 'all' ? 'Everyone' : who === 'me' ? 'Mine only' : `${(people.find((p) => p.id === who)?.name || '').split(' ')[0]} only`;
  const pick = (v) => { setWho(v); setMenu(false); };
  const nameOf = (id) => (id === team.me ? 'You' : people.find((p) => p.id === id)?.name || 'Someone');

  const bar = (
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
      <Link to="/settings/board" className="kb-pill icon" data-testid="kb-edit-columns" aria-label="Edit board columns" title={canEdit ? 'Edit board columns' : 'Board columns'}><Settings2 size={16} /></Link>
    </div>
  );

  const byCol = Object.fromEntries(columns.map((c) => [c.key, shown.filter((t) => columnFor(t, keys) === c.key)]));
  const isFolded = (c) => (fold[c.key] !== undefined ? fold[c.key] : byCol[c.key].length === 0 && c.key !== 'todo' && c.key !== 'done');
  const template = columns.map((c) => (isFolded(c) ? '56px' : 'minmax(260px, 1fr)')).join(' ');

  const dropOn = (e, key) => { e.preventDefault(); const id = e.dataTransfer.getData('text/plain') || dragId; setOver(null); setDragId(null); if (id) { move(id, key); if (isFolded(columns.find((c) => c.key === key))) setFolded(key, false); } };

  return (
    <div data-testid="kanban" className="kb">
      {slot ? createPortal(bar, slot) : bar}
      <div className="kb-board" style={{ gridTemplateColumns: template }} data-cols={columns.length}>
        {columns.map((c) => {
          const items = byCol[c.key];
          const folded = isFolded(c);
          const expanded = more[c.key];
          const list = expanded ? items : items.slice(0, lim);
          const dnd = { onDragOver: (e) => { e.preventDefault(); setOver(c.key); }, onDragLeave: () => setOver((o) => (o === c.key ? null : o)), onDrop: (e) => dropOn(e, c.key) };
          if (folded) {
            return (
              <section key={c.key} data-col={c.key} data-folded="true" className={`kb-col strip tone-${c.tone}${over === c.key ? ' over' : ''}`} aria-label={`${c.name}, ${items.length} tasks, collapsed`} {...dnd}>
                <button type="button" className="kb-strip" data-testid={`kb-expand-${c.key}`} aria-label={`Expand ${c.name}`} onClick={() => setFolded(c.key, false)}>
                  <ChevronsRight size={16} /><span className="kb-n" data-testid={`kb-count-${c.key}`}>{items.length}</span><span className="kb-vert">{c.name}</span>
                </button>
              </section>
            );
          }
          return (
            <section key={c.key} data-col={c.key} className={`kb-col tone-${c.tone}${over === c.key ? ' over' : ''}`} aria-labelledby={`kb-${c.key}`} {...dnd}>
              <div className="kb-head">
                <h2 id={`kb-${c.key}`}>{c.name}</h2>
                <span className="kb-head-r">
                  <span className="kb-n" data-testid={`kb-count-${c.key}`}>{items.length}</span>
                  <button type="button" className="kb-fold" data-testid={`kb-collapse-${c.key}`} aria-label={`Collapse ${c.name}`} onClick={() => setFolded(c.key, true)}><ChevronsLeft size={15} /></button>
                </span>
              </div>
              <div className="kb-cards">
                {items.length === 0 && <p className="kb-empty">{c.key === 'done' ? 'Finished tasks land here.' : c.key === 'todo' ? 'Nothing waiting.' : 'Drag a card here.'}</p>}
                {list.map((t) => {
                  const a = assigneesOf(t);
                  return (
                    <div key={t.id} className={`kb-card${dragId === t.id ? ' dragging' : ''}`} data-testid="task-card" draggable data-kb-card={t.id} onDragStart={(e) => { e.dataTransfer.setData('text/plain', t.id); e.dataTransfer.effectAllowed = 'move'; setDragId(t.id); }} onDragEnd={() => { setDragId(null); setOver(null); }}>
                      <button type="button" className={`kb-t${t.completed ? ' done' : ''}`} onClick={() => open(t)}>{t.text}</button>
                      {(t.deadline || t.note) && (
                        <div className="kb-chips">
                          {t.deadline && <span className={`kb-chip${isLate(t) ? ' late' : ''}`}><Clock size={12} />{isLate(t) ? `${Math.max(1, Math.floor((Date.now() - new Date(t.deadline).getTime()) / 864e5))} d late` : dayChip(t.deadline)}</span>}
                          {t.note && <span className="kb-chip">{t.note.title || 'Note'}</span>}
                        </div>
                      )}
                      {(a.length > 0 || people.length > 0) && (
                        <div className="kb-who-row">
                          <span className="kb-av">{a.slice(0, 4).map((id) => <span key={id} className="kb-a" style={{ background: avColor(id) }} title={nameOf(id)} data-testid="kb-avatar">{(people.find((p) => p.id === id)?.name || nameOf(id)).trim()[0]?.toUpperCase()}</span>)}</span>
                          {a.length > 0 && <span className="kb-names">{a.map((id) => nameOf(id).split(' ')[0]).join(', ')}</span>}
                          {people.length > 0 && !t.completed && (
                            <button type="button" className="kb-add" data-testid="kb-assign" aria-label={`Change who is on "${t.text}"`} onClick={() => setAsg(t.id)}>{a.length === 0 ? <><Plus size={12} />Assign</> : <Plus size={12} />}</button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              {adding === c.key ? (
                <form className="kb-new" onSubmit={(e) => { e.preventDefault(); addTask(c.key); }}>
                  <input autoFocus aria-label={`New task in ${c.name}`} data-testid={`kb-new-input-${c.key}`} placeholder="Task name" value={draft} maxLength={200} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') { setAdding(null); setDraft(''); } }} />
                  <button type="submit" className="kb-new-go" disabled={!draft.trim()}>Add</button>
                </form>
              ) : (
                <button type="button" className="kb-addtask" data-testid={`kb-addtask-${c.key}`} onClick={() => { setAdding(c.key); setDraft(''); }}><Plus size={15} />Add task</button>
              )}
              {items.length > lim && <button type="button" className="kb-more" onClick={() => setMore({ ...more, [c.key]: !expanded })}>{expanded ? 'Show less' : `Show ${items.length - lim} more`}</button>}
            </section>
          );
        })}
      </div>
      {asgTask && <AssignDialog task={asgTask} people={people} me={team.me} picked={assigneesOf(asgTask)} onToggle={toggleAssignee} onClear={() => setPeople(asgTask, [])} onClose={() => setAsg(null)} />}
    </div>
  );
}

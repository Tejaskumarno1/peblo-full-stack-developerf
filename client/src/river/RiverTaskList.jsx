import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, ChevronDown, ChevronRight } from 'lucide-react';
import { todosAPI } from '../api';
import { RiverHeader } from './RiverShell';
import RSelect from './RSelect';
import { startOfDay, dueMomentOf, momentOf, isMeeting, clock, dayWord, tagsOfTask } from './riverUtils';

const OPTS_KEY = 'peblo-river-tasks-opts';
const loadOpts = () => { try { return { show: 'open', group: 'due', sort: 'due', ...JSON.parse(localStorage.getItem(OPTS_KEY) || '{}') }; } catch { return { show: 'open', group: 'due', sort: 'due' }; } };
const PRI = { high: 0, medium: 1, low: 2 };
const PRI_LABEL = { high: 'High priority', medium: 'Medium priority', low: 'Low priority' };

/** River A. Tasks as a list: group, filter and search every task, tick them off, open one in the river. */
export default function RiverTaskList() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [opts, setOptsState] = useState(loadOpts);
  const [q, setQ] = useState('');
  const [closed, setClosed] = useState(() => new Set());
  const setOpts = (patch) => setOptsState((o) => { const n = { ...o, ...patch }; try { localStorage.setItem(OPTS_KEY, JSON.stringify(n)); } catch { /* storage blocked */ } return n; });

  const { data: all = [], isLoading } = useQuery({
    queryKey: ['river', 'task-list'],
    queryFn: () => todosAPI.getAll().then((r) => r.data.todos || []),
  });

  const now = new Date();
  const whenOf = (t) => (isMeeting(t) ? momentOf(t) : dueMomentOf(t));
  const overdue = (t) => !t.completed && !isMeeting(t) && whenOf(t) && whenOf(t) < now;

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let list = all.filter((t) => {
      if (opts.show === 'open' && t.completed) return false;
      if (opts.show === 'done' && !t.completed) return false;
      if (opts.show === 'overdue' && !overdue(t)) return false;
      if (opts.show === 'meetings' && !isMeeting(t)) return false;
      if (opts.show === 'nodate' && (t.deadline || t.completed)) return false;
      if (needle && !(String(t.text).toLowerCase().includes(needle) || tagsOfTask(t).some((g) => String(g).toLowerCase().includes(needle)))) return false;
      return true;
    });
    const dueKey = (t) => (whenOf(t) ? whenOf(t).getTime() : Infinity);
    list = [...list].sort((a, b) => {
      if (opts.sort === 'priority') return (PRI[a.priority] ?? 1) - (PRI[b.priority] ?? 1) || dueKey(a) - dueKey(b);
      if (opts.sort === 'newest') return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
      if (opts.sort === 'az') return String(a.text).localeCompare(String(b.text));
      return dueKey(a) - dueKey(b);
    });
    return list;
  }, [all, opts.show, opts.sort, q]); // eslint-disable-line react-hooks/exhaustive-deps

  const groups = useMemo(() => {
    const map = new Map();
    const put = (key, label, rank, t) => { if (!map.has(key)) map.set(key, { key, label, rank, items: [] }); map.get(key).items.push(t); };
    const today = startOfDay();
    shown.forEach((t) => {
      if (opts.group === 'none') return put('all', 'All tasks', 0, t);
      if (opts.group === 'priority') return put(t.priority || 'medium', PRI_LABEL[t.priority] || 'Medium priority', PRI[t.priority] ?? 1, t);
      if (opts.group === 'tag') {
        const tags = tagsOfTask(t);
        if (!tags.length) return put('~none', 'No tag', 999, t);
        return tags.forEach((g) => put(`t:${g}`, `#${g}`, 0, t));
      }
      const w = whenOf(t);
      if (!w) return put('nodate', 'No date', 900, t);
      const days = Math.round((startOfDay(w) - today) / 86400000);
      if (days < 0 && !t.completed) return put('late', 'Overdue', 0, t);
      if (days < 0) return put('past', 'Earlier', 800, t);
      if (days === 0) return put('today', 'Today', 1, t);
      if (days === 1) return put('tomorrow', 'Tomorrow', 2, t);
      if (days < 7) return put('week', 'This week', 3, t);
      return put('later', 'Later', 4, t);
    });
    return [...map.values()].sort((a, b) => a.rank - b.rank || a.label.localeCompare(b.label));
  }, [shown, opts.group]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = async (t) => {
    try { await todosAPI.update(t.id, { completed: !t.completed }); } finally { qc.invalidateQueries(); }
  };
  const open = (t) => navigate('/', { state: { select: t.id } });
  const flip = (key) => setClosed((s) => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  const openCount = all.filter((t) => !t.completed).length;
  const lateCount = all.filter(overdue).length;

  return (
    <>
      <RiverHeader>
        <div className="r-when"><h1>Tasks</h1><span>{openCount} open{lateCount ? ` · ${lateCount} overdue` : ''}</span></div>
      </RiverHeader>
      <section className="r-tl" aria-label="Tasks">
        <div className="r-tl-bar">
          <label htmlFor="r-task-search" className="r-sr">Search tasks</label>
          <input id="r-task-search" type="search" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setQ('')} placeholder="Search tasks and tags…" />
          <RSelect label="Show" value={opts.show} onChange={(v) => setOpts({ show: v })}
            options={[['open', 'Open'], ['overdue', 'Overdue'], ['nodate', 'No date'], ['meetings', 'Meetings'], ['done', 'Done'], ['all', 'Everything']]} />
          <RSelect label="Group by" value={opts.group} onChange={(v) => setOpts({ group: v })}
            options={[['due', 'When it is due'], ['priority', 'Priority'], ['tag', 'Tag'], ['none', 'No grouping']]} />
          <RSelect label="Sort" value={opts.sort} onChange={(v) => setOpts({ sort: v })}
            options={[['due', 'Due soonest'], ['priority', 'Priority'], ['newest', 'Newest'], ['az', 'A to Z']]} />
          {opts.group !== 'none' && groups.length > 1 && (
            <button type="button" className="r-btn ghost small" onClick={() => setClosed(closed.size ? new Set() : new Set(groups.map((g) => g.key)))}>{closed.size ? 'Expand all' : 'Collapse all'}</button>
          )}
          <Link to="/" className="r-btn ghost small">Back to the river</Link>
        </div>
        {isLoading && <div className="r-tl-empty"><Loader2 className="r-spin" /></div>}
        {!isLoading && groups.length === 0 && <div className="r-tl-empty">{q.trim() ? 'No tasks match your search.' : 'Nothing here. Try another filter.'}</div>}
        {groups.map((g) => (
          <div key={g.key} className={`r-tl-group${g.key === 'late' ? ' late' : ''}`}>
            {opts.group !== 'none' && (
              <button type="button" className="r-tl-gh" aria-expanded={!closed.has(g.key)} onClick={() => flip(g.key)}>
                {closed.has(g.key) ? <ChevronRight size={15} /> : <ChevronDown size={15} />} {g.label} <span>{g.items.length}</span>
              </button>
            )}
            {!closed.has(g.key) && g.items.map((t) => {
              const w = whenOf(t);
              return (
                <div key={`${g.key}-${t.id}`} className={`r-tl-row${t.completed ? ' done' : ''}`}>
                  <input type="checkbox" checked={!!t.completed} onChange={() => toggle(t)} aria-label={`Done: ${t.text}`} />
                  <button type="button" className="r-tl-main" onClick={() => open(t)}>
                    <span className="r-tl-text">{t.text}</span>
                    {tagsOfTask(t).map((tg) => <span key={tg} className="r-tl-tag">#{tg}</span>)}
                  </button>
                  <span className={`r-tl-pri ${t.priority || 'medium'}`} title={PRI_LABEL[t.priority] || 'Medium priority'} />
                  <span className={`r-tl-when${overdue(t) ? ' late' : ''}`}>{w ? `${dayWord(w)}${isMeeting(t) || (w.getHours() !== 23 || w.getMinutes() !== 59) ? ' ' + clock(w) : ''}` : 'No date'}</span>
                </div>
              );
            })}
          </div>
        ))}
      </section>
    </>
  );
}

// Workload and weekly summary (mockup K06): open tasks per person, what is late, what the week looked like, and who is around.
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { workspacesAPI } from '../api';
import { useCurrentSpace } from './spaces';
import { Initial } from './TaskThread';
import './teamshare.css';

const AVAIL = [['available', 'Available'], ['busy', 'Busy'], ['away', 'Away']];
const lateText = (d) => {
  const days = Math.max(1, Math.floor((Date.now() - new Date(d).getTime()) / 864e5));
  return `${days} day${days === 1 ? '' : 's'} late`;
};

export default function WorkloadView({ team }) {
  const space = useCurrentSpace();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['workload', space], enabled: !!space, queryFn: () => workspacesAPI.workload(space).then((r) => r.data), refetchInterval: 30000 });
  if (isLoading || !data) return <p className="s-empty" data-testid="workload">Loading the team's work...</p>;
  const nameOf = (id) => (data.people.find((p) => p.id === id)?.name || 'Someone').split(' ')[0];
  const max = Math.max(1, ...data.people.map((p) => p.open));
  const busiest = [...data.people].sort((a, b) => b.open - a.open)[0];
  const mine = data.people.find((p) => p.id === team.me);
  const setAvail = async (status) => { try { await workspacesAPI.setAvailability(space, { status, note: mine?.availabilityNote || undefined }); qc.invalidateQueries({ queryKey: ['workload', space] }); } catch { /* shown again on refresh */ } };
  const s = data.summary;

  return (
    <div className="wl" data-testid="workload">
      <section className="wl-card" aria-label="Open tasks per person">
        <h2 className="wl-h">Workload this week</h2>
        <p className="wl-sub">Open tasks per person</p>
        <ul className="wl-rows">
          {data.people.map((p) => (
            <li key={p.id} className="wl-row" data-testid="workload-row">
              <Initial name={p.name} size={32} />
              <b className="wl-name">{p.id === team.me ? 'You' : p.name.split(' ')[0]}</b>
              <span className="wl-bar" role="img" aria-label={`${p.open} open`}><i style={{ width: `${(p.open / max) * 100}%` }} className={p.overdue ? 'late' : ''} /></span>
              <span className="wl-n">{p.open}</span>
              {p.availability !== 'available' && <span className={`wl-chip ${p.availability}`} data-testid="avail-chip">{p.availability === 'busy' ? 'Busy' : 'Away'}</span>}
            </li>
          ))}
        </ul>
        {busiest && busiest.open > 0 && <p className="wl-note">{busiest.id === team.me ? 'You have' : `${busiest.name.split(' ')[0]} has`} the most open work. Drag a card on the Kanban board to rebalance.</p>}
        {mine && (
          <div className="wl-me" role="radiogroup" aria-label="Your availability">
            <span>You are</span>
            {AVAIL.map(([v, name]) => <button key={v} type="button" role="radio" aria-checked={mine.availability === v} className={mine.availability === v ? 'on' : ''} data-testid={`avail-${v}`} onClick={() => setAvail(v)}>{name}</button>)}
          </div>
        )}
      </section>

      <section className="wl-card" aria-label="Overdue and stuck">
        <h2 className="wl-h">Overdue and stuck</h2>
        {data.overdue.length === 0 ? <p className="wl-note">Nothing is late. Nice.</p> : (
          <ul className="wl-late">
            {data.overdue.map((t) => (
              <li key={t.id}><Link to={`/tasks?task=${t.id}`} data-testid="overdue-row"><b>{t.text}</b><span>{t.assignees.length ? t.assignees.map(nameOf).join(', ') : 'Nobody yet'} - {lateText(t.deadline)}</span></Link></li>
            ))}
          </ul>
        )}
      </section>

      <section className="wl-card" aria-label="Weekly summary">
        <h2 className="wl-h">Weekly summary</h2>
        <p className="wl-sub">The last 7 days</p>
        <dl className="wl-sum" data-testid="week-summary">
          <div><dt>Finished</dt><dd>{s.doneThisWeek}</dd></div>
          <div><dt>Created</dt><dd>{s.createdThisWeek}</dd></div>
          <div><dt>Open now</dt><dd>{s.open}</dd></div>
          <div><dt>Overdue</dt><dd>{s.overdue}</dd></div>
          <div><dt>Nobody yet</dt><dd>{s.unassigned}</dd></div>
        </dl>
        {data.people.some((p) => p.doneThisWeek > 0) && <p className="wl-note">Most active: {nameOf([...data.people].sort((a, b) => b.doneThisWeek - a.doneThisWeek)[0].id)} ({[...data.people].sort((a, b) => b.doneThisWeek - a.doneThisWeek)[0].doneThisWeek} finished).</p>}
      </section>
    </div>
  );
}


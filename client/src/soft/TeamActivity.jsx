// Team activity and "for you" (mockup K05): what happened in the team, and what needs me.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CheckSquare, MessageSquare, UserPlus, Eye, ArrowRight } from 'lucide-react';
import api from '../api/client';
import { workspacesAPI } from '../api';
import { useCurrentSpace, useSpaceName } from './spaces';
import { Initial } from './TaskThread';
import './teamshare.css';

const FILTERS = [['all', 'Everything'], ['tasks', 'Tasks'], ['comments', 'Comments']];
const TEXT = {
  comment: (a) => ['commented on', a.detail],
  status: (a) => [`moved to ${{ todo: 'To do', doing: 'In progress', review: 'In review' }[a.detail] || a.detail}:`, null],
  done: () => ['finished', null],
  review: (a) => ['asked for a review of', a.detail && a.detail !== 'asked for a review' ? a.detail : null],
  assign: () => ['changed who is on', null],
};
const ICON = { comment: MessageSquare, status: CheckSquare, done: CheckSquare, review: Eye, assign: UserPlus };
const dayLabel = (d) => {
  const x = new Date(d); const t = new Date(); t.setHours(0, 0, 0, 0);
  const diff = Math.round((t - new Date(x.getFullYear(), x.getMonth(), x.getDate())) / 864e5);
  return diff <= 0 ? 'Today' : diff === 1 ? 'Yesterday' : x.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' });
};
const clock = (d) => new Date(d).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

export default function TeamActivity() {
  const space = useCurrentSpace();
  const name = useSpaceName();
  const [filter, setFilter] = useState('all');
  const { data, isLoading } = useQuery({ queryKey: ['feed', space], enabled: !!space, queryFn: () => workspacesAPI.feed(space).then((r) => r.data.items || []), refetchInterval: 20000 });
  const { data: notes = [] } = useQuery({ queryKey: ['notifications'], queryFn: () => api.get('/collab/notifications').then((r) => r.data.notifications || []), refetchInterval: 60000 });
  if (!space) return <div className="ts-page"><h1 className="ts-h">Team activity</h1><p className="s-empty">Switch to a team to see what is happening.</p></div>;
  const items = (data || []).filter((i) => filter === 'all' || (filter === 'comments' ? i.kind === 'comment' : i.kind !== 'comment'));
  const mine = notes.filter((n) => n.spaceId === space && n.todoId && !n.read);
  const groups = [['Assigned', mine.filter((n) => n.kind === 'assigned')], ['Mentions', mine.filter((n) => n.kind === 'mention')], ['Reviews and updates', mine.filter((n) => ['review', 'comment', 'status', 'done'].includes(n.kind))]];
  const days = [];
  for (const i of items) { const l = dayLabel(i.createdAt); (days.find((d) => d[0] === l) || (days.push([l, []]), days[days.length - 1]))[1].push(i); }

  return (
    <div className="ts-page ta" data-testid="team-activity">
      <header className="ta-head">
        <div><h1 className="ts-h">Team activity</h1><p className="ts-sub">{name}</p></div>
        <div className="kb-filters" role="group" aria-label="Filter activity">
          {FILTERS.map(([k, label]) => <button key={k} type="button" className={filter === k ? 'on' : ''} aria-pressed={filter === k} data-testid={`ta-${k}`} onClick={() => setFilter(k)}>{label}</button>)}
        </div>
      </header>
      <div className="ta-grid">
        <section className="ta-feed" aria-label="Activity">
          {isLoading && <p className="s-empty">Loading...</p>}
          {!isLoading && items.length === 0 && <p className="s-empty" data-testid="ta-empty">Nothing yet. Comments, status changes and reviews show up here.</p>}
          {days.map(([label, list]) => (
            <div key={label}>
              <h2 className="ta-day">{label}</h2>
              <ul className="ta-list">
                {list.map((i) => { const [verb, extra] = (TEXT[i.kind] || (() => [i.kind, null]))(i); const Ic = ICON[i.kind] || CheckSquare; return (
                  <li key={i.id} data-testid="feed-item">
                    <Initial name={i.name} size={32} />
                    <Link to={`/tasks?task=${i.todoId}`}><span><b>{i.name}</b> {verb} <b>{i.text}</b></span>{extra && <em>{extra}</em>}</Link>
                    <Ic size={15} aria-hidden /><time>{clock(i.createdAt)}</time>
                  </li>
                ); })}
              </ul>
            </div>
          ))}
        </section>
        <aside className="ta-you" aria-label="For you">
          <h2 className="ts-h2">For you</h2>
          {mine.length === 0 && <p className="s-empty small" data-testid="for-you-empty">You are all caught up.</p>}
          {groups.filter(([, l]) => l.length).map(([label, list]) => (
            <div key={label}>
              <h3 className="ta-day">{label} <span>{list.length}</span></h3>
              <ul className="ta-list">
                {list.map((n) => <li key={n.id} data-testid="for-you-item"><Link to={`/tasks?task=${n.todoId}`}><span><b>{n.from}</b> {n.kind === 'assigned' ? 'assigned you' : n.kind === 'mention' ? 'mentioned you on' : n.kind === 'review' ? 'asked you to review' : 'updated'} <b>{n.title}</b></span></Link><ArrowRight size={14} aria-hidden /></li>)}
              </ul>
            </div>
          ))}
          <Link className="ta-all" to="/notifications">All notifications <ArrowRight size={14} aria-hidden /></Link>
        </aside>
      </div>
    </div>
  );
}

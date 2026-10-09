import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Sparkles, ArrowUp } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { dashboardAPI, todosAPI, notesAPI, hubAPI } from '../api';
import { stripMarkdown, formatRelativeDate } from '../utils/helpers';
import '../styles/home.css';

const SUGGESTIONS = [
  'Plan my day from my tasks',
  'What did I write about this week?',
  "What's overdue, and what should I do first?",
];

function dayKey(d) {
  const x = new Date(d);
  return `${x.getFullYear()}-${x.getMonth()}-${x.getDate()}`;
}

function timeOf(t) {
  if (t.startTime) return t.startTime;
  if (!t.deadline) return '';
  const d = new Date(t.deadline);
  if (d.getHours() === 23 && d.getMinutes() === 59) return '';
  return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });
}

export default function HomePage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [ask, setAsk] = useState('');

  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const firstName = (user?.name || '').split(' ')[0];

  const { data: briefing } = useQuery({ queryKey: ['dashboard', 'briefing'], queryFn: () => dashboardAPI.dailyBriefing().then((r) => r.data) });
  const { data: insights } = useQuery({ queryKey: ['dashboard', 'insights'], queryFn: () => dashboardAPI.insights().then((r) => r.data) });
  const { data: weekly } = useQuery({ queryKey: ['dashboard', 'weekly'], queryFn: () => dashboardAPI.weeklyReport().then((r) => r.data) });
  const { data: today } = useQuery({ queryKey: ['todos', 'today'], queryFn: () => todosAPI.getToday().then((r) => r.data) });
  const { data: notes = [] } = useQuery({
    queryKey: ['notes', 'sidebar'],
    queryFn: () => notesAPI.getAll({ sort: 'updated' }).then((r) => r.data.notes || []),
  });
  const { data: models } = useQuery({ queryKey: ['hub-models'], queryFn: () => hubAPI.models().then((r) => r.data), staleTime: 30000 });

  const rangeStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const rangeEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 3, 23, 59, 59);
  const { data: range = [] } = useQuery({
    queryKey: ['todos', 'range', 'home', dayKey(rangeStart)],
    queryFn: () => todosAPI.getRange(rangeStart.toISOString(), rangeEnd.toISOString()).then((r) => r.data.todos || []),
  });

  const todayList = useMemo(() => {
    const list = [...(today?.overdueTasks || []).map((t) => ({ ...t, overdue: true })), ...(today?.todayTasks || [])];
    return list.slice(0, 6);
  }, [today]);

  const agenda = useMemo(() => {
    const days = [];
    for (let i = 0; i < 4; i++) {
      const d = new Date(rangeStart);
      d.setDate(d.getDate() + i);
      const items = range.filter((t) => !t.completed && t.deadline && dayKey(t.deadline) === dayKey(d));
      if (items.length) days.push({ label: i === 0 ? 'TODAY' : d.toLocaleDateString('en-IN', { weekday: 'short' }).toUpperCase(), items: items.slice(0, 3) });
    }
    return days.slice(0, 3);
  }, [range]); // eslint-disable-line react-hooks/exhaustive-deps

  const heat = useMemo(() => {
    const weeks = (insights?.activityHeatmap || []).slice(-18);
    return weeks.flatMap((w) => w.map((d) => (d.total === 0 ? 0 : d.total < 2 ? 1 : d.total < 4 ? 2 : d.total < 7 ? 3 : 4)));
  }, [insights]);

  const stats = briefing?.stats || {};
  const subtitle = [
    stats.dueToday ? `${stats.dueToday} task${stats.dueToday === 1 ? '' : 's'} due today` : 'Nothing due today',
    stats.overdue ? `${stats.overdue} overdue` : null,
    weekly?.stats?.notesEdited ? `${weekly.stats.notesEdited} notes edited this week` : null,
  ].filter(Boolean).join(' · ');

  const local = models?.local;
  const cloud = (models?.cloud || []).find((c) => c.configured);
  const routing = models?.routing;
  const modelPill = local?.enabled && local?.ok
    ? { name: local.chatModel, kind: 'local', label: 'Local' }
    : cloud && routing !== 'ollama'
      ? { name: cloud.model, kind: 'cloud', label: 'Cloud' }
      : { name: 'Set up AI', kind: 'off', label: '' };

  const toggleTask = async (t) => {
    await todosAPI.update(t.id, { completed: !t.completed });
    queryClient.invalidateQueries({ queryKey: ['todos'] });
    queryClient.invalidateQueries({ queryKey: ['dashboard'] });
  };

  const askAI = (q) => {
    const text = (q ?? ask).trim();
    if (text) navigate(`/ai?q=${encodeURIComponent(text)}`);
  };

  const brief = [];
  if (stats.overdue) brief.push({ text: `${stats.overdue} task${stats.overdue === 1 ? ' is' : 's are'} overdue`, strong: briefing?.overdueTasks?.[0]?.text });
  if (stats.dueToday) brief.push({ text: `${stats.dueToday} due today`, strong: briefing?.todayTasks?.[0]?.text });
  if (stats.completedYesterday) brief.push({ text: `You finished ${stats.completedYesterday} task${stats.completedYesterday === 1 ? '' : 's'} yesterday` });
  if (insights?.topTags?.[0]) brief.push({ text: `Your most-used tag is #${insights.topTags[0].name}` });
  if (!brief.length) brief.push({ text: 'A clear day. Capture something with Ctrl+Shift+Space.' });

  return (
    <div className="pb-scroll home">
      <header className="pb-topbar">
        <span className="title">Home</span>
        <span className="grow" />
        <span className="pb-muted" style={{ fontSize: 12.5 }}>{now.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}</span>
        <span className="home-capture-hint">Quick capture <span className="pb-kbd">Ctrl Shift Space</span></span>
      </header>

      <div className="home-body">
        <section className="home-hero">
          <div className="home-hero-text">
            <span className="home-eyebrow">{now.toLocaleDateString('en-IN', { weekday: 'long' })} {hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening'}</span>
            <h1 className="pb-display">{greeting}{firstName && firstName !== 'You' ? `, ${firstName}` : ''}.</h1>
            <p>{subtitle}</p>
          </div>
          <div className="home-stats">
            <div className="home-stat"><span className="pb-display">{insights?.streakStats?.current ?? '–'}</span><span>day streak</span></div>
            <div className="home-stat"><span className="pb-display">{weekly?.stats?.completionRate != null ? `${weekly.stats.completionRate}%` : '–'}</span><span>tasks done this week</span></div>
          </div>
        </section>

        <section className="home-ask">
          <form className="home-ask-row" onSubmit={(e) => { e.preventDefault(); askAI(); }}>
            <Sparkles size={18} color="var(--pb-accent)" />
            <label htmlFor="home-ask" className="sr-only">Ask Peblo</label>
            <input id="home-ask" value={ask} onChange={(e) => setAsk(e.target.value)} placeholder="Ask anything about your notes, tasks and calendar…" autoComplete="off" />
            <Link to="/ai/connections" className="pb-chip" title="AI model">
              <span className={`pb-dot ${modelPill.kind}`} />
              {modelPill.name}
              {modelPill.label && <span style={{ fontSize: 11, fontWeight: 600, color: modelPill.kind === 'local' ? 'var(--pb-local)' : 'var(--pb-cloud)' }}>{modelPill.label}</span>}
            </Link>
            <button type="submit" className="home-ask-send" aria-label="Ask" disabled={!ask.trim()}><ArrowUp size={16} strokeWidth={2.4} /></button>
          </form>
          <div className="home-suggestions">
            {SUGGESTIONS.map((s) => (
              <button key={s} type="button" className="pb-chip" onClick={() => askAI(s)}>{s}</button>
            ))}
          </div>
        </section>

        <section className="home-grid-3">
          <article className="pb-card">
            <div className="pb-card-head">
              <h2>Today</h2>
              <Link to="/tasks">All tasks</Link>
            </div>
            {todayList.length === 0 ? (
              <div className="pb-empty">Nothing due today. Add a task with Ctrl+Shift+Space.</div>
            ) : (
              <div className="home-tasklist">
                {todayList.map((t) => (
                  <label key={t.id} className="home-task">
                    <input type="checkbox" className="pb-check" checked={!!t.completed} onChange={() => toggleTask(t)} />
                    <span className="home-task-text">
                      <span className={`home-task-title${t.completed ? ' done' : ''}`}>{t.text}</span>
                      <span className="pb-muted home-task-meta">
                        {[t.overdue ? 'Overdue' : timeOf(t), ...(Array.isArray(t.todoTags) ? t.todoTags.slice(0, 1).map((x) => '#' + x) : []), t.note?.title ? `linked to ${t.note.title}` : null].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                    {t.priority === 'high' && <span className="pb-badge danger">High</span>}
                  </label>
                ))}
              </div>
            )}
          </article>

          <article className="pb-card">
            <div className="pb-card-head">
              <h2>Next few days</h2>
              <Link to="/calendar">Calendar</Link>
            </div>
            {agenda.length === 0 ? (
              <div className="pb-empty">No deadlines in the next three days.</div>
            ) : (
              <div className="home-agenda">
                {agenda.map((day) => (
                  <div key={day.label} className="home-agenda-day">
                    <span className="home-agenda-label">{day.label}</span>
                    <div className="home-agenda-items">
                      {day.items.map((t) => (
                        <div key={t.id} className={`home-agenda-item ${t.priority === 'high' ? 'high' : ''}`}>
                          <span className="t">{t.text}</span>
                          <span className="pb-muted m">{timeOf(t) || 'Any time'}{t.priority === 'high' ? ' · high priority' : ''}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </article>

          <article className="pb-card">
            <div className="pb-card-head">
              <h2>Daily brief</h2>
              <span className="pb-badge">From your data</span>
            </div>
            <ul className="home-brief">
              {brief.slice(0, 4).map((b, i) => (
                <li key={i}>{b.text}{b.strong ? <>: <strong>{b.strong}</strong></> : null}</li>
              ))}
            </ul>
            <div style={{ flex: 1 }} />
            <div className="home-brief-foot">
              <span className="pb-muted">{briefing?.tip || ''}</span>
              <button type="button" className="pb-btn primary sm" onClick={() => askAI('Plan my day from my tasks and deadlines')}>Plan with AI</button>
            </div>
          </article>
        </section>

        <section className="home-grid-3">
          <article className="pb-card" style={{ gridColumn: 'span 2' }}>
            <div className="pb-card-head">
              <h2>Recently edited</h2>
              <Link to="/notes">All notes</Link>
            </div>
            {notes.length === 0 ? (
              <div className="pb-empty">No notes yet. Create one, or import from Notion in Settings → Your Data.</div>
            ) : (
              <div className="home-notes">
                {notes.slice(0, 3).map((n) => (
                  <Link key={n.id} to={`/notes/${n.id}`} className="home-note">
                    <span className="home-note-title">{n.title || 'Untitled'}</span>
                    <span className="home-note-snip">{stripMarkdown(n.content || '').slice(0, 110) || 'Empty note'}</span>
                    <span className="pb-muted home-note-meta">{[(n.tags || [])[0] && `#${n.tags[0]}`, formatRelativeDate(n.updatedAt)].filter(Boolean).join(' · ')}</span>
                  </Link>
                ))}
              </div>
            )}
          </article>

          <article className="pb-card">
            <div className="pb-card-head">
              <h2>Momentum</h2>
              <span className="pb-muted" style={{ fontSize: 12 }}>Last 18 weeks</span>
            </div>
            <div className="home-heat" aria-label="Activity over the last 18 weeks">
              {heat.map((lvl, i) => <span key={i} style={{ background: `var(--pb-heat-${lvl})` }} />)}
            </div>
            <div className="home-heat-legend pb-muted">
              <span style={{ flex: 1 }}>{insights ? `${insights.totalNotes} notes · longest streak ${insights.streakStats?.longest ?? 0} days` : ''}</span>
              <span>Less</span>
              <i style={{ background: 'var(--pb-heat-0)' }} />
              <i style={{ background: 'var(--pb-heat-2)' }} />
              <i style={{ background: 'var(--pb-heat-4)' }} />
              <span>More</span>
            </div>
          </article>
        </section>
      </div>
    </div>
  );
}

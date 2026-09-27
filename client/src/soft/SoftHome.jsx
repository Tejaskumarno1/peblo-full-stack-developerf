import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Sparkles, ArrowUp, Plus, Lock } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { dashboardAPI, todosAPI, notesAPI, hubAPI } from '../api';
import { timeOf, startOfDay, addDays, sameDay, daysFromToday, weekdayShort, weekdayLong, numberWord, snippetOf, firstNameOf, toneOf, toneVar, tagsOf } from './softUtils';

const TILT = [
  { cls: 'a', rot: -2.5 },
  { cls: 'b', rot: 2 },
  { cls: 'c', rot: -0.8 },
];

/** Soft Studio · Home (mockup: SoftStudio / SoftHome). */
export default function SoftHome() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [ask, setAsk] = useState('');

  const today = startOfDay();
  const { data: todayData } = useQuery({ queryKey: ['todos', 'today'], queryFn: () => todosAPI.getToday().then((r) => r.data) });
  const { data: week = [] } = useQuery({
    queryKey: ['todos', 'range', 'soft-home', today.toDateString()],
    queryFn: () => todosAPI.getRange(addDays(today, 1).toISOString(), addDays(today, 8).toISOString()).then((r) => r.data.todos || []),
  });
  const { data: notes = [] } = useQuery({
    queryKey: ['notes', 'sidebar'],
    queryFn: () => notesAPI.getAll({ sort: 'updated' }).then((r) => r.data.notes || []),
  });
  const { data: insights } = useQuery({ queryKey: ['dashboard', 'insights'], queryFn: () => dashboardAPI.insights().then((r) => r.data) });
  const { data: models } = useQuery({ queryKey: ['hub-models'], queryFn: () => hubAPI.models().then((r) => r.data), staleTime: 30000 });

  const todayTasks = useMemo(() => {
    const list = [...(todayData?.todayTasks || [])].filter((t) => !t.completed);
    const rank = { high: 0, medium: 1, low: 2 };
    return list.sort((a, b) => (rank[a.priority] - rank[b.priority]) || String(timeOf(a)).localeCompare(String(timeOf(b))));
  }, [todayData]);
  const overdue = todayData?.overdueTasks || [];

  const upcoming = useMemo(() => week.filter((t) => !t.completed && t.deadline), [week]);
  const nextBig = upcoming.find((t) => t.priority === 'high');

  // Headline and one helpful line, written from today's tasks
  const first = firstNameOf(user);
  const hey = first ? `Hey ${first}` : 'Hey there';
  const n = todayTasks.length;
  const headline = n === 0
    ? `${hey}, nothing is due today.`
    : n <= 5
      ? `${hey}, ${numberWord(n)} small thing${n === 1 ? '' : 's'} and you're free.`
      : `${hey}, ${n} things on today's list.`;
  const lead = [];
  if (todayTasks[0]) lead.push(`${todayTasks[0].text} first.`);
  if (nextBig) {
    const d = daysFromToday(nextBig.deadline);
    lead.push(`${nextBig.text} is ${d === 1 ? 'tomorrow' : `on ${weekdayLong(nextBig.deadline)}`}.`);
  } else if (overdue.length) {
    lead.push(`${overdue.length} task${overdue.length === 1 ? ' is' : 's are'} still waiting from before.`);
  }
  if (!lead.length) lead.push('A calm day. Capture anything that comes up with the Capture button.');

  // Coming up: next days that have something, up to three
  const days = useMemo(() => {
    const out = [];
    for (let i = 1; i <= 7 && out.length < 3; i++) {
      const d = addDays(today, i);
      const items = upcoming.filter((t) => sameDay(t.deadline, d));
      if (items.length) out.push({ d, items, big: false });
    }
    // Only the first day with something important gets the white "big" card
    const first = out.find((x) => x.items.some((t) => t.priority === 'high'));
    if (first) first.big = true;
    return out;
  }, [upcoming]); // eslint-disable-line react-hooks/exhaustive-deps

  // Streak: last seven days of writing activity
  const lastWeek = (insights?.activityHeatmap || []).flat().slice(-7);
  const streak = insights?.streakStats?.current ?? 0;

  const local = models?.local;
  const cloudReady = (models?.cloud || []).some((c) => c.configured);
  const aiLine = local?.enabled && local.ok ? 'AI runs on this computer' : cloudReady && models?.routing !== 'ollama' ? 'Cloud AI · you choose when' : 'Set up AI in Your AI';

  const toggle = async (t) => {
    queryClient.setQueryData(['todos', 'today'], (old) => old && ({ ...old, todayTasks: old.todayTasks.map((x) => (x.id === t.id ? { ...x, completed: !x.completed } : x)) }));
    await todosAPI.update(t.id, { completed: !t.completed });
    queryClient.invalidateQueries({ queryKey: ['todos'] });
    queryClient.invalidateQueries({ queryKey: ['dashboard'] });
  };
  const askAI = (q) => {
    const text = (q ?? ask).trim();
    if (text) navigate(`/ai?q=${encodeURIComponent(text)}`);
  };
  const topTag = insights?.topTags?.[0]?.name;

  return (
    <div className="soft-page s-home">
      <div className="s-home-hero">
        <div className="s-home-hero-text">
          <span className="s-date-pill">{new Date().toLocaleDateString('en-GB', { weekday: 'long' })} · {new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })}</span>
          <h1 className="s-home-title">{headline}</h1>
          <p className="s-home-lead">{lead.join(' ')}</p>
        </div>
        <form className="s-home-ask" onSubmit={(e) => { e.preventDefault(); askAI(); }}>
          <label htmlFor="s-home-ask" className="s-ask-label"><Sparkles size={18} /> Ask Peblo about your notes</label>
          <div className="s-ask-row">
            <input id="s-home-ask" value={ask} onChange={(e) => setAsk(e.target.value)} placeholder={nextBig ? `What should I revise before ${weekdayLong(nextBig.deadline)}?` : 'What did I write about this week?'} autoComplete="off" />
            <button type="submit" className="s-send" aria-label="Ask" disabled={!ask.trim()}><ArrowUp size={18} strokeWidth={2.4} /></button>
          </div>
          <div className="s-chips">
            <button type="button" className="s-chip" onClick={() => askAI('Plan my day from my tasks and deadlines')}>Plan my day</button>
            <button type="button" className="s-chip" onClick={() => askAI(topTag ? `Quiz me on my #${topTag} notes` : 'Quiz me on my latest note')}>{topTag ? `Quiz me on #${topTag}` : 'Quiz me'}</button>
            <button type="button" className="s-chip" onClick={() => askAI('Sum up my week: what I wrote, finished and what is left')}>Sum up my week</button>
          </div>
        </form>
      </div>

      <div className="s-home-tiles">
        <section className="s-tile" style={{ background: 'var(--s-peach)' }} aria-labelledby="s-today">
          <div className="s-tile-head">
            <h2 id="s-today" className="s-h2">Today</h2>
            <span className="s-count">{n} left</span>
          </div>
          {todayTasks.length === 0 && <p className="s-empty">Nothing due today. Press Capture to add something.</p>}
          {todayTasks.slice(0, 3).map((t, i) => (
            <label key={t.id} className="s-home-task">
              <input type="checkbox" className="s-check" checked={!!t.completed} onChange={() => toggle(t)} />
              <span className={`t${t.priority === 'high' || i === 0 ? ' strong' : ''}`}>{t.text}</span>
              {timeOf(t) && <span className={`time${t.priority === 'high' ? ' hot' : ''}`}>{timeOf(t)}</span>}
            </label>
          ))}
          {todayTasks.length > 3 && <Link to="/tasks" className="s-more">+ {todayTasks.length - 3} more today</Link>}
          <span className="grow" />
          {overdue[0] ? (
            <Link to="/tasks" className="s-leftover">
              <span className="dot" aria-hidden="true" />
              Left over from {daysFromToday(overdue[0].deadline) === -1 ? 'yesterday' : weekdayLong(overdue[0].deadline)}: {overdue[0].text}
            </Link>
          ) : (
            <button type="button" className="s-leftover" onClick={() => window.dispatchEvent(new Event('peblo:capture'))}>
              <Plus size={15} strokeWidth={2.6} /> Add a task for today
            </button>
          )}
        </section>

        <section className="s-tile" style={{ background: 'var(--s-mint)' }} aria-labelledby="s-coming">
          <h2 id="s-coming" className="s-h2" style={{ marginBottom: 4 }}>Coming up</h2>
          {days.length === 0 && <p className="s-empty">Nothing planned for the next few days.</p>}
          {days.map(({ d, items, big }) => {
            const [a, b] = items;
            return (
              <Link key={d.toISOString()} to="/calendar" className={`s-day${big ? ' big' : ''}`}>
                <span className="s-day-date"><span className="dow">{weekdayShort(d).toUpperCase()}</span><span className="num">{d.getDate()}</span></span>
                <span className="s-day-body">
                  <span className="t">{a.text}</span>
                  <span className="m">{[timeOf(a), b ? `then ${b.text.toLowerCase()}${timeOf(b) ? ` ${timeOf(b)}` : ''}` : (tagsOf(a)[0] ? `#${tagsOf(a)[0]}` : '')].filter(Boolean).join(' · ') || 'Any time'}</span>
                </span>
              </Link>
            );
          })}
        </section>

        <section className="s-tile" style={{ background: 'var(--s-butter)', gap: 12 }} aria-labelledby="s-notes">
          <div className="s-tile-head">
            <h2 id="s-notes" className="s-h2">Notes</h2>
            <button type="button" className="s-round-sm" aria-label="New note" onClick={() => navigate('/notes?new=1')}><Plus size={18} strokeWidth={2.4} /></button>
          </div>
          <div className="s-stack">
            {notes.length === 0 && <p className="s-empty">Your latest notes will pile up here.</p>}
            {notes.slice(0, 3).map((note, i) => (
              <Link key={note.id} to={`/notes/${note.id}`} className={`s-paper ${TILT[i].cls}`} style={{ transform: `rotate(${TILT[i].rot}deg)` }}>
                <span className="t">
                  <span className="title">{note.title || 'Untitled'}</span>
                  {i === 2 && note.tags?.[0] && <span className="tag" style={{ background: toneVar(toneOf(note.tags[0])) }}>#{note.tags[0]}</span>}
                </span>
                <span className="m">{snippetOf(note.content, 70) || 'Empty note'}</span>
              </Link>
            ))}
          </div>
        </section>

        <section className="s-tile" style={{ background: 'var(--s-sky)', gap: 6 }} aria-labelledby="s-streak">
          <h2 id="s-streak" className="s-h2">Streak</h2>
          <span className="s-streak-num">{streak}</span>
          <span className="s-streak-label">{streak === 1 ? 'day' : 'days'} in a row</span>
          <div className="s-streak-dots" aria-label={`Wrote on ${lastWeek.filter((d) => d.total > 0).length} of the last 7 days`}>
            {Array.from({ length: 7 }, (_, i) => lastWeek[i]).map((d, i) => (
              <span key={i} title={d?.date} style={{ background: d && d.total > 0 ? 'var(--s-fg)' : 'var(--s-item)' }} />
            ))}
          </div>
          <span className="grow" />
          <Link to="/ai/connections" className="s-privacy"><Lock size={16} /> {aiLine}</Link>
        </section>
      </div>
    </div>
  );
}

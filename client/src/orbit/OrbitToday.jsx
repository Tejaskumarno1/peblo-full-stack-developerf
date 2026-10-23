import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useOrbit } from './OrbitShell';
import { orbitPrefs } from './orbitPrefs';
import { metaOf, minutesLabel } from './taskMeta';
import { topicName, tagsOfNote, tagsOfTodo, agoText } from './orbitUtils';
import { startOfDay, sameDay, clock, isAllDay } from '../river/riverUtils';

const DAY = 86400000;
export const daysUntil = (iso, now = new Date()) => Math.round((startOfDay(iso) - startOfDay(now)) / DAY);

/** Today on one screen: tasks due, notes edited today, the next quiz, exam countdowns and time logged. */
export default function OrbitToday({ onToggle }) {
  const { todos, notes, mastery } = useOrbit();
  const { settings, updateSettings } = useAuth();
  const exams = orbitPrefs(settings).exams || {};
  const [topic, setTopic] = useState('');
  const [date, setDate] = useState('');
  const [err, setErr] = useState('');
  const now = new Date();
  const due = todos.filter((t) => t.deadline && sameDay(t.deadline, now));
  const edited = notes.filter((n) => n.updatedAt && sameDay(n.updatedAt, now)).slice(0, 6);
  const topics = useMemo(() => [...new Set(notes.flatMap(tagsOfNote))].sort(), [notes]);
  const weakest = useMemo(() => topics.map((t) => ({ t, s: mastery.get(t)?.score })).filter((x) => x.s !== undefined && x.s !== null).sort((a, b) => a.s - b.s)[0], [topics, mastery]);
  const quizTopic = weakest?.t || topics[0];
  const examList = Object.entries(exams).map(([t, d]) => ({ t, d, left: daysUntil(d) })).sort((a, b) => a.left - b.left);

  const saveExams = async (next) => {
    setErr('');
    const ok = await updateSettings({ orbit: { ...orbitPrefs(settings), exams: next } });
    if (!ok) setErr('Could not save. Check your connection and try again.');
  };
  const addExam = (e) => {
    e.preventDefault();
    if (!topic || !date) return;
    saveExams({ ...exams, [topic]: date });
    setTopic(''); setDate('');
  };

  return (
    <div className="o-today" aria-label="Today">
      <section>
        <h3 className="o-day-head">Due today · {due.filter((t) => !t.completed).length} left</h3>
        {due.length === 0 && <p className="o-quiet">Nothing is due today.</p>}
        {due.map((t) => (
          <div key={t.id} className={`o-task${t.completed ? ' done' : ''}`}>
            <input type="checkbox" checked={!!t.completed} onChange={() => onToggle(t)} aria-label={`Done today: ${t.text}`} />
            <span className="t">{t.text}</span>
            {!isAllDay(t) && <span className="m">{clock(t.deadline)}</span>}
          </div>
        ))}
      </section>
      <section>
        <h3 className="o-day-head">Notes edited today · {edited.length}</h3>
        {edited.length === 0 && <p className="o-quiet">No notes edited yet today.</p>}
        {edited.map((n) => <Link key={n.id} to={`/notes/${n.id}`} className="o-chip">{n.meta?.emoji ? `${n.meta.emoji} ` : ''}{n.title || 'Untitled'} · {agoText(n.updatedAt)}</Link>)}
      </section>
      <section>
        <h3 className="o-day-head">Next quiz</h3>
        {quizTopic ? (
          <p>
            <Link className="o-btn small" to={`/quiz/${encodeURIComponent(quizTopic)}`}>Quiz {topicName(quizTopic)}</Link>
            <span className="o-quiet"> {weakest ? `your weakest topic (${weakest.s}%)` : 'not quizzed yet'}</span>
          </p>
        ) : <p className="o-quiet">Add a note with a topic to get a quiz.</p>}
      </section>
      <section>
        <h3 className="o-day-head">Exams</h3>
        {examList.length === 0 && <p className="o-quiet">No exams set. Add a date to count the days down.</p>}
        {examList.map((x) => (
          <div key={x.t} className="o-exam">
            <b>{topicName(x.t)}</b>
            <span className={x.left <= 3 ? 'o-planned hot' : ''}>{x.left < 0 ? `${-x.left} days ago` : x.left === 0 ? 'Today' : `${x.left} ${x.left === 1 ? 'day' : 'days'} left`}</span>
            {x.left >= 0 && mastery.get(x.t) && <span className="o-quiet">mastery {mastery.get(x.t).score}%</span>}
            <button type="button" className="o-chip" aria-label={`Remove exam ${topicName(x.t)}`} onClick={() => { const n = { ...exams }; delete n[x.t]; saveExams(n); }}>Remove</button>
          </div>
        ))}
        <form className="o-exam-add" onSubmit={addExam}>
          <select aria-label="Exam topic" value={topic} onChange={(e) => setTopic(e.target.value)}>
            <option value="">Topic…</option>
            {topics.map((t) => <option key={t} value={t}>{topicName(t)}</option>)}
          </select>
          <input type="date" aria-label="Exam date" value={date} onChange={(e) => setDate(e.target.value)} />
          <button type="submit" className="o-btn small" disabled={!topic || !date}>Set exam</button>
        </form>
        {err && <p className="o-err" role="alert">{err}</p>}
      </section>
    </div>
  );
}

/** Focus time logged on tasks, added up by topic. */
export function TimeReport({ todos }) {
  const rows = new Map();
  let total = 0;
  for (const t of todos) {
    const m = metaOf(t).spentMin || 0;
    if (!m) continue;
    const k = tagsOfTodo(t)[0] || '(no topic)';
    rows.set(k, (rows.get(k) || 0) + m);
    total += m;
  }
  const list = [...rows].sort((a, b) => b[1] - a[1]);
  if (!list.length) return <p className="o-quiet">No focus time logged yet. Open a task’s details and press “Focus 25 min”.</p>;
  return (
    <div className="o-time" aria-label="Time per topic">
      <p><b>{minutesLabel(total)}</b> logged in total</p>
      {list.map(([k, m]) => (
        <div key={k} className="o-time-row">
          <span>{k === '(no topic)' ? k : topicName(k)}</span>
          <span className="bar"><i style={{ width: `${Math.round((m / list[0][1]) * 100)}%` }} /></span>
          <span className="m">{minutesLabel(m)}</span>
        </div>
      ))}
    </div>
  );
}

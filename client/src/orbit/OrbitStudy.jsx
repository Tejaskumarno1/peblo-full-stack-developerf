import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Info, X, Flame } from 'lucide-react';
import { studyAPI } from '../api';
import { useOrbit, useDismiss } from './OrbitShell';
import { tagCounts, topicName, levelOf, LEVEL_LABEL, minutesText, agoText } from './orbitUtils';

/** A little "i" next to a mastery figure that says how the number is worked out (PEB-159). */
export function MasteryInfo({ mastery, overall }) {
  const [open, setOpen] = useState(false);
  const ref = useDismiss(open, () => setOpen(false));
  return (
    <span ref={ref} className="o-info-wrap">
      <button type="button" className="o-info" aria-label="How is this calculated?" aria-expanded={open} onClick={() => setOpen((v) => !v)}><Info size={14} strokeWidth={2.4} /></button>
      {open && (
        <span className="o-info-pop" role="note">
          {overall ? (
            <>
              <b>Overall = the average of your quizzed topics</b>
              <span>Topics you have not quizzed yet are left out until you take a quiz on them.</span>
            </>
          ) : mastery ? (
            <>
              <b>{mastery.score}% = how well you know this topic</b>
              <span>
                Last quiz: {mastery.lastCorrect} of {mastery.lastTotal} right ({mastery.lastTotal ? Math.round((mastery.lastCorrect / mastery.lastTotal) * 100) : 0}%), taken {agoText(mastery.updatedAt)}.
                You have taken {mastery.quizzes} quiz{mastery.quizzes === 1 ? '' : 'zes'} on it. Each new quiz counts 60% and everything before it 40%, so the score moves as you learn.
              </span>
            </>
          ) : (
            <>
              <b>Not quizzed yet</b>
              <span>Take a quiz on this topic. The score is the share of questions you answer right; later quizzes blend in.</span>
            </>
          )}
          <span className="o-quiet">Rings: under 50% Weak, 50 to 79% Getting there, 80% and over Strong.</span>
        </span>
      )}
    </span>
  );
}

const dayKey = (d) => {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};
const addDays = (key, n) => {
  const [y, m, d] = key.split('-').map(Number);
  return dayKey(new Date(y, m - 1, d + n));
};

/** Streak and the week so far, worked out on this device from notes, finished tasks and quizzes (PEB-162). */
export function useProgress() {
  const { notes, todos } = useOrbit();
  const { data: quizzes = [] } = useQuery({
    queryKey: ['study', 'activity'],
    queryFn: () => studyAPI.activity().then((r) => r.data.quizzes || []),
  });
  return useMemo(() => {
    const today = dayKey(new Date());
    const active = new Set();
    const week = new Set(Array.from({ length: 7 }, (_, i) => addDays(today, -i)));
    const sum = { tasks: 0, notes: 0, quizzes: 0 };
    for (const n of notes) {
      active.add(dayKey(n.createdAt)); active.add(dayKey(n.updatedAt));
      if (week.has(dayKey(n.createdAt))) sum.notes++;
    }
    for (const t of todos) {
      if (!t.completed) continue;
      const k = dayKey(t.updatedAt);
      active.add(k);
      if (week.has(k)) sum.tasks++;
    }
    for (const q of quizzes) {
      const k = dayKey(q);
      active.add(k);
      if (week.has(k)) sum.quizzes++;
    }
    let streak = 0;
    let cursor = active.has(today) ? today : addDays(today, -1);
    while (active.has(cursor)) { streak++; cursor = addDays(cursor, -1); }
    const days = Array.from({ length: 7 }, (_, i) => { const k = addDays(today, i - 6); return { key: k, on: active.has(k), label: new Date(`${k}T12:00:00`).toLocaleDateString('en', { weekday: 'short' }).slice(0, 1) }; });
    return { streak, days, week: sum };
  }, [notes, todos, quizzes]);
}

/** "Study today": an ordered, time-boxed list from due tasks and weak topics, plus streak and week (PEB-161, PEB-162). */
export default function OrbitStudy() {
  const { notes, todos, mastery } = useOrbit();
  const [open, setOpen] = useState(false);
  const ref = useDismiss(open, () => setOpen(false));
  const progress = useProgress();

  const plan = useMemo(() => {
    const endToday = new Date();
    endToday.setHours(23, 59, 59, 999);
    const items = [];
    const due = todos
      .filter((t) => !t.completed && t.deadline && new Date(t.deadline) <= endToday)
      .sort((a, b) => new Date(a.deadline) - new Date(b.deadline))
      .slice(0, 3);
    for (const t of due) {
      items.push({ id: `task-${t.id}`, kind: 'task', title: t.text, minutes: 20, meta: new Date(t.deadline) < new Date(new Date().setHours(0, 0, 0, 0)) ? 'overdue' : 'due today', to: '/tasks' });
    }
    const topics = tagCounts(notes)
      .map(([tag, n]) => ({ tag, n, score: mastery.get(tag)?.score ?? null }))
      .filter((t) => t.score === null || t.score < 80)
      .sort((a, b) => (a.score ?? 45) - (b.score ?? 45) || b.n - a.n)
      .slice(0, 3);
    for (const t of topics) {
      items.push({ id: `topic-${t.tag}`, kind: 'topic', tag: t.tag, title: topicName(t.tag), minutes: t.score === null || t.score < 50 ? 35 : 20, score: t.score, meta: t.score === null ? 'not quizzed yet' : `${t.score}% · ${LEVEL_LABEL[levelOf(t.score)].toLowerCase()}` });
    }
    return items;
  }, [notes, todos, mastery]);
  const total = plan.reduce((m, i) => m + i.minutes, 0);

  return (
    <>
      <button type="button" className="o-pill o-study-btn" onClick={() => setOpen(true)}>
        <Flame size={16} strokeWidth={2.4} aria-hidden="true" />
        <span>Study today</span>
        <span className="o-streak" title="Days in a row with something done">{progress.streak} day{progress.streak === 1 ? '' : 's'}</span>
      </button>
      {open && (
        <div className="o-modal-wrap">
          <section ref={ref} className="o-pill o-modal" role="dialog" aria-label="Study today">
            <div className="head">
              <div>
                <span className="o-eyebrow">STUDY TODAY</span>
                <h2>{plan.length ? `${minutesText(total)} to stay on track` : 'Nothing urgent today'}</h2>
              </div>
              <button type="button" className="o-x" aria-label="Close" onClick={() => setOpen(false)}><X size={18} strokeWidth={2.2} /></button>
            </div>

            {plan.length === 0 && <p className="o-quiet">No tasks are due and every topic is strong. Quiz one anyway to keep it that way.</p>}
            <ol className="o-plan">
              {plan.map((it, i) => (
                <li key={it.id}>
                  <span className="n">{i + 1}</span>
                  <span className="t"><b>{it.kind === 'task' ? it.title : `Revise ${it.title}`}</b><span className="o-quiet">{it.meta} · about {it.minutes} min</span></span>
                  {it.kind === 'task'
                    ? <Link to={it.to} className="o-btn ghost small" onClick={() => setOpen(false)}>Open</Link>
                    : (
                      <span className="acts">
                        <Link to={`/notes?topic=${encodeURIComponent(it.tag)}`} className="o-btn ghost small" onClick={() => setOpen(false)}>Notes</Link>
                        <Link to={`/quiz/${encodeURIComponent(it.tag)}`} className="o-btn small" onClick={() => setOpen(false)}>Quiz</Link>
                      </span>
                    )}
                </li>
              ))}
            </ol>

            <div className="o-week" aria-label="Your week">
              <div className="row">
                <b><Flame size={15} strokeWidth={2.4} /> {progress.streak}-day streak</b>
                <span className="o-quiet">This week: {progress.week.tasks} task{progress.week.tasks === 1 ? '' : 's'} done · {progress.week.notes} note{progress.week.notes === 1 ? '' : 's'} written · {progress.week.quizzes} quiz{progress.week.quizzes === 1 ? '' : 'zes'}</span>
              </div>
              <div className="dots" role="img" aria-label={`Active on ${progress.days.filter((d) => d.on).length} of the last 7 days`}>
                {progress.days.map((d) => <span key={d.key} className={d.on ? 'on' : ''} title={d.key}>{d.label}</span>)}
              </div>
            </div>
          </section>
        </div>
      )}
    </>
  );
}

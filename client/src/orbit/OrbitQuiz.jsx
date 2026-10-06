import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2, Network } from 'lucide-react';
import { studyAPI } from '../api';
import { useOrbit } from './OrbitShell';
import { topicName, levelOf, levelVar, LEVEL_LABEL } from './orbitUtils';

const LETTERS = ['A', 'B', 'C', 'D'];

/**
 * Orbit · Quiz: ten questions written from one topic's notes, on a sheet over the map.
 * Marking happens on this computer's server; the score moves the topic's ring.
 */
export default function OrbitQuiz() {
  const { topic: raw } = useParams();
  const topic = decodeURIComponent(raw || '');
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { mastery, notes } = useOrbit();
  const [quiz, setQuiz] = useState(null);
  const [error, setError] = useState('');
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState([]);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(true);
  const started = useRef('');

  const before = mastery.get(topic)?.score ?? null;
  const count = notes.filter((n) => (n.tags || []).includes(topic)).length;

  const start = async () => {
    setLoading(true);
    setError('');
    setQuiz(null);
    setIndex(0);
    setAnswers([]);
    setResult(null);
    try {
      const { data } = await studyAPI.quiz(topic, 10);
      setQuiz(data);
    } catch (err) {
      setError(err.response?.data?.error || 'Peblo could not write the quiz. Check Your AI.');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    if (started.current === topic) return;
    started.current = topic;
    start();
  }, [topic]); // eslint-disable-line react-hooks/exhaustive-deps

  const q = quiz?.questions[index];
  const picked = answers[index];
  const answered = picked !== undefined;

  const choose = (i) => { if (!answered) setAnswers((a) => { const n = [...a]; n[index] = i; return n; }); };
  const next = async () => {
    if (index < quiz.questions.length - 1) { setIndex(index + 1); return; }
    const { data } = await studyAPI.answer(quiz.id, answers);
    setResult(data);
    queryClient.invalidateQueries({ queryKey: ['study'] });
  };

  // Number keys pick an answer, Enter goes on
  useEffect(() => {
    const key = (e) => {
      if (!quiz || result) return;
      if (/^[1-4]$/.test(e.key)) choose(Number(e.key) - 1);
      else if (e.key === 'Enter' && answered) next();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });

  const back = () => navigate('/');

  return (
    <>
      <div className="o-scrim" onMouseDown={back} />
      <article className="o-sheet" style={{ top: 92, width: 876 }} aria-label={`Quiz on ${topicName(topic)}`}>
        <header className="o-sheet-head">
          <span className="crumb">Quiz</span>
          <span className="topic"><i style={{ borderColor: levelVar(levelOf(before)) }} />{topicName(topic)}</span>
          <span className="grow" />
          <span className="status">{before !== null ? `${before}% MASTERED BEFORE` : 'FIRST QUIZ'}</span>
          <button type="button" className="o-btn ghost small" style={{ height: 44 }} onClick={back}><Network size={16} strokeWidth={2.2} /> Back to map</button>
        </header>

        <div className="o-quiz">
          {loading && (
            <div className="o-loading">
              <Loader2 size={28} className="o-spin" />
              <h2 className="o-q" style={{ fontSize: 24 }}>Writing 10 questions from your {count} note{count === 1 ? '' : 's'} on {topicName(topic)}…</h2>
              <p className="o-quiet">Only notes on this topic are used. #private notes are left out.</p>
            </div>
          )}

          {!loading && error && (
            <div className="o-loading">
              <h2 className="o-q" style={{ fontSize: 24 }}>No quiz this time</h2>
              <p className="o-err">{error}</p>
              <div className="o-btns">
                <button type="button" className="o-btn" onClick={start}>Try again</button>
                <Link to="/ai/connections" className="o-btn ghost">Check Your AI</Link>
              </div>
            </div>
          )}

          {!loading && quiz && !result && q && (
            <>
              <div className="o-quiz-top">
                <span className="o-eyebrow">QUESTION {index + 1} OF {quiz.questions.length} · {q.concept}</span>
                <span className="grow" />
                <div className="o-dots" aria-hidden="true">
                  {quiz.questions.map((qq, i) => (
                    <i key={i} className={i === index && answers[i] === undefined ? 'now' : answers[i] === undefined ? '' : answers[i] === qq.answer ? 'right' : 'wrong'} />
                  ))}
                </div>
              </div>
              <h2 className="o-q">{q.q}</h2>
              <div className="o-options" role="group" aria-label="Answers">
                {q.options.map((o, i) => {
                  const cls = !answered ? '' : i === q.answer ? ' right' : i === picked ? ' wrong' : '';
                  return (
                    <button key={i} type="button" className={`o-option${cls}`} onClick={() => choose(i)} disabled={answered}>
                      <span className="l">{LETTERS[i]}</span>{o}
                    </button>
                  );
                })}
              </div>
              {answered && (
                <div className="o-explain" role="status">
                  <b>{picked === q.answer ? 'Right.' : `Not quite. It's ${LETTERS[q.answer]}.`}</b>
                  {q.explain && <span>{q.explain}</span>}
                  {q.noteId && <Link to={`/notes/${q.noteId}`} style={{ fontSize: 13, fontWeight: 700, color: 'var(--o-path-ink)' }}>From your note: {q.noteTitle}</Link>}
                </div>
              )}
              <div className="o-btns" style={{ justifyContent: 'flex-end' }}>
                <span className="o-quiet" style={{ fontSize: 13, alignSelf: 'center', marginRight: 'auto' }}>Keys 1–4 answer · Enter goes on</span>
                <button type="button" className="o-btn" disabled={!answered} onClick={next}>{index < quiz.questions.length - 1 ? 'Next question' : 'See my score'}</button>
              </div>
            </>
          )}

          {result && (
            <>
              <span className="o-eyebrow">DONE · {topicName(topic)}</span>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 18 }}>
                <span className="o-score">{result.correct}/{result.total}</span>
                <span className="o-quiet" style={{ paddingBottom: 8 }}>{result.pct}% this time</span>
              </div>
              <div className="o-mastery" style={{ maxWidth: 520 }}>
                <div className="row">
                  <b>{result.mastery.score}% mastered · {LEVEL_LABEL[levelOf(result.mastery.score)].toLowerCase()}</b>
                  <span>{before !== null ? `was ${before}%` : 'first quiz'}</span>
                </div>
                <div className="o-bar"><div style={{ width: `${result.mastery.score}%`, background: levelVar(levelOf(result.mastery.score)) }} /></div>
              </div>
              {result.mastery.missed.length > 0 && (
                <div className="o-explain">
                  <b>What to look at again</b>
                  <span>{result.mastery.missed.map((m) => `${m.concept}${m.n > 1 ? ` (${m.n} missed)` : ''}`).join(', ')}</span>
                </div>
              )}
              <div className="o-btns">
                <button type="button" className="o-btn" onClick={back}>Back to the map</button>
                <button type="button" className="o-btn ghost" onClick={start}>Another quiz</button>
                <Link to={`/notes?topic=${encodeURIComponent(topic)}`} className="o-btn ghost">Open its notes</Link>
              </div>
            </>
          )}
        </div>
      </article>
    </>
  );
}

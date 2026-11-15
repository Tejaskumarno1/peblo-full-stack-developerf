import { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { todosAPI } from '../api';
import { reviewBuckets, triageDate } from './reviewUtils';
import { dayChip, tagsOf } from './softUtils';
import './taskreview.css';

const STEPS = [
  { key: 'overdue', name: 'Overdue', lead: 'These slipped past their day. Give each one a new day, or mark it done.' },
  { key: 'undated', name: 'No date', lead: 'These have no day yet. Pick one, or leave them for later.' },
  { key: 'upcoming', name: 'Next 7 days', lead: 'This is what is coming. Move anything that will not fit.' },
  { key: 'wrap', name: 'Wrap up', lead: '' },
];

/** Weekly review wizard (mockup: Weekly review wizard). Nothing changes until you press a button on a task. */
export default function TaskReview({ todos, onClose, onSay }) {
  const qc = useQueryClient();
  const [step, setStep] = useState(0);
  const [handled, setHandled] = useState(() => new Set());
  const [counts, setCounts] = useState({ moved: 0, done: 0 });
  const buckets = useMemo(() => reviewBuckets(todos), [todos]);
  useEffect(() => {
    const k = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  }, [onClose]);

  const cur = STEPS[step];
  const list = (buckets[cur.key] || []).filter((t) => !handled.has(t.id));
  const left = (k) => (buckets[k] || []).filter((t) => !handled.has(t.id)).length;

  const act = async (t, kind) => {
    const before = { deadline: t.deadline || null, completed: !!t.completed };
    const patch = kind === 'done' ? { completed: true } : { deadline: triageDate(kind).toISOString() };
    setHandled((h) => new Set(h).add(t.id));
    try {
      await todosAPI.update(t.id, patch);
      setCounts((c) => (kind === 'done' ? { ...c, done: c.done + 1 } : { ...c, moved: c.moved + 1 }));
      qc.invalidateQueries({ queryKey: ['todos'] });
    } catch {
      setHandled((h) => { const n = new Set(h); n.delete(t.id); return n; });
      onSay?.('Could not save that. Nothing changed.');
    }
    return before;
  };

  return (
    <div className="s-rv-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="s-rv" role="dialog" aria-label="Weekly review">
        <nav className="s-rv-steps" aria-label="Steps">
          <div className="head"><b>Weekly review</b><button type="button" aria-label="Close" onClick={onClose}><X size={16} /></button></div>
          {STEPS.map((s, i) => (
            <button key={s.key} type="button" className={i === step ? 'on' : ''} aria-current={i === step ? 'step' : undefined} onClick={() => setStep(i)}>
              <b>{i + 1}</b><span>{s.name}</span>{s.key !== 'wrap' && <em>{left(s.key)}</em>}
            </button>
          ))}
          <p>Esc to leave. Nothing changes until you press a button.</p>
        </nav>
        <section className="s-rv-main">
          <div className="head"><h2>Step {step + 1}: {cur.name}</h2>{cur.key !== 'wrap' && <span className="count">{list.length} left</span>}</div>
          {cur.key === 'wrap' ? (
            <div className="wrap">
              <p><b>{counts.done}</b> done and <b>{counts.moved}</b> moved in this review.</p>
              <p><b>{buckets.doneRecently}</b> finished in the last 7 days.</p>
              <p><b>{left('overdue')}</b> overdue, <b>{left('undated')}</b> without a day, <b>{left('upcoming')}</b> coming up.</p>
            </div>
          ) : (
            <>
              <p className="lead">{cur.lead}</p>
              <div className="rows">
                {list.length === 0 && <p className="empty">All clear here.</p>}
                {list.slice(0, 8).map((t) => (
                  <div key={t.id} className="row" data-task={t.text}>
                    <div className="what"><b>{t.text}</b><small>{[t.deadline ? dayChip(t.deadline) : 'No date', tagsOf(t)[0] && `#${tagsOf(t)[0]}`].filter(Boolean).join(' · ')}</small></div>
                    <button type="button" onClick={() => act(t, 'today')}>Today</button>
                    <button type="button" onClick={() => act(t, 'tomorrow')}>Tomorrow</button>
                    <button type="button" onClick={() => act(t, 'nextweek')}>Next week</button>
                    <button type="button" className="ghost" onClick={() => act(t, 'done')}>Done</button>
                  </div>
                ))}
                {list.length > 8 && <p className="empty">{list.length - 8} more after these.</p>}
              </div>
            </>
          )}
          <div className="foot">
            <button type="button" className="ghost" disabled={step === 0} onClick={() => setStep(step - 1)}>Back</button>
            <span className="grow" />
            {step < STEPS.length - 1 ? <button type="button" className="go" onClick={() => setStep(step + 1)}>Next: {STEPS[step + 1].name}</button> : <button type="button" className="go" onClick={onClose}>Finish</button>}
          </div>
        </section>
      </div>
    </div>
  );
}

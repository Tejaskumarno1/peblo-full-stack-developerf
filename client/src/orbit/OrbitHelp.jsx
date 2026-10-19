import { useEffect, useRef, useState } from 'react';
import { CircleHelp, X } from 'lucide-react';
import { LEVEL_LABEL, levelVar } from './orbitUtils';

// PEB-147 / PEB-148 / PEB-150: a "?" on the map, a 4-step walkthrough you can skip and replay,
// and a plain explanation of the rings and the dashed revision path.
const SEEN_KEY = 'peblo-orbit-help-seen';
const seen = () => { try { return localStorage.getItem(SEEN_KEY) === '1'; } catch { return true; } };
const markSeen = () => { try { localStorage.setItem(SEEN_KEY, '1'); } catch { /* ignore */ } };

const Dot = ({ level }) => <i className="o-help-dot" style={{ borderColor: levelVar(level) }} />;

const STEPS = [
  {
    title: 'Every circle is a topic',
    body: (
      <>
        <p>Peblo makes topics from the tags on your notes. Write <b>#dbms</b> in a note and a <b>dbms</b> circle appears. A bigger circle means more notes on that topic.</p>
        <p>Click a circle to see its notes, its tasks and how well you know it.</p>
      </>
    ),
  },
  {
    title: 'Notes and tasks live on topics',
    body: (
      <>
        <p>Notes that share a tag sit close together. Use the tools at the bottom left to start a <b>note</b>, add a <b>task</b>, put a note on a topic, or make a <b>new topic</b>.</p>
        <p>Tasks with a topic show on that topic's card, and every one with a date also shows in <b>Due</b>.</p>
      </>
    ),
  },
  {
    title: 'The ring colour shows how well you know it',
    body: (
      <>
        <p>The colour comes from your quiz answers on that topic.</p>
        <ul className="o-help-legend">
          {['weak', 'ok', 'strong', 'none'].map((l) => (<li key={l}><Dot level={l} />{LEVEL_LABEL[l]}</li>))}
        </ul>
        <p>Take a quiz on a topic to colour it in. Weak topics are the ones to revise first.</p>
      </>
    ),
  },
  {
    title: 'The dashed line is your revision path',
    body: (
      <>
        <p>The dashed line joins your weakest topics in the order to revise them, with the time it should take. Use the switch at the bottom to hide or show it.</p>
        <p>You can open this guide again any time with the <b>?</b> button.</p>
      </>
    ),
  },
];

export default function OrbitHelp() {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [hint, setHint] = useState(() => !seen());
  const btn = useRef(null);

  const close = () => { setOpen(false); setHint(false); markSeen(); btn.current?.focus(); };
  const start = () => { setStep(0); setOpen(true); setHint(false); markSeen(); };

  useEffect(() => {
    if (!open) return undefined;
    const key = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    document.addEventListener('keydown', key, true);
    return () => document.removeEventListener('keydown', key, true);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const last = step === STEPS.length - 1;
  const s = STEPS[step];
  return (
    <>
      <button ref={btn} type="button" className="o-tool" aria-label="Help: how the map works" title="How the map works" aria-haspopup="dialog" onClick={start}>
        <CircleHelp size={18} strokeWidth={2.2} />
      </button>
      {hint && !open && (
        <div className="o-pill o-help-hint" role="note">
          <span>New here? A 30-second tour shows how the map works.</span>
          <button type="button" className="o-btn small" onClick={start}>Show me</button>
          <button type="button" className="o-btn small ghost" onClick={() => { setHint(false); markSeen(); }}>No thanks</button>
        </div>
      )}
      {open && (
        <div className="o-help-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
          <div className="o-pill o-help" role="dialog" aria-modal="true" aria-labelledby="o-help-title">
            <div className="o-help-top">
              <span className="o-eyebrow">STEP {step + 1} OF {STEPS.length}</span>
              <button type="button" className="o-x" aria-label="Close help" onClick={close}><X size={18} strokeWidth={2.2} /></button>
            </div>
            <h2 id="o-help-title" className="o-help-title">{s.title}</h2>
            <div className="o-help-body">{s.body}</div>
            <div className="o-help-dots" aria-hidden="true">
              {STEPS.map((_, i) => <span key={i} className={i === step ? 'on' : ''} />)}
            </div>
            <div className="o-btns">
              {step > 0 ? <button type="button" className="o-btn ghost" onClick={() => setStep(step - 1)}>Back</button> : <button type="button" className="o-btn ghost" onClick={close}>Skip</button>}
              <button type="button" className="o-btn wide" autoFocus onClick={() => (last ? close() : setStep(step + 1))}>{last ? 'Got it' : 'Next'}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

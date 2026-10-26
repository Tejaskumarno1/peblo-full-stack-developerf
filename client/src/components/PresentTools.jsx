import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, CircleHelp, Download, Eye, EyeOff, Hand, Heart, Lightbulb, ListChecks, Pause, Play, Route, Send, SkipForward, StickyNote, ThumbsUp, Timer, Users, X, Presentation, Plus } from 'lucide-react';
import { Ic } from '../utils/icons';

/*
 * Everything a presenter and their audience get on top of "follow me": a dark dock, an audience list,
 * private notes and a timer, hands and questions, a guided tour and a recap. Nothing here is stored on the server:
 * it travels through the live room's awareness, and notes stay in this browser.
 */

export const peerKey = (p) => `${p.name}|${p.color}`;
const mmss = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
const ago = (t) => { const s = Math.max(0, Math.round((Date.now() - t) / 1000)); return s < 10 ? 'just now' : s < 60 ? `${s}s` : `${Math.round(s / 60)} min`; };
const recapMarkdown = (recap) => {
  const r = recap.reacts || { up: 0, idea: 0, heart: 0 };
  return [`# Session recap`, '', `Presented for ${recap.minutes} min. ${recap.joined} joined, ${recap.stayed} stayed to the end.`, '', '## Who was there', ...recap.people.map((p) => `- ${p.name}: ${p.min} min${p.stayed ? '' : ' (left early)'}`), '', '## Questions', ...(recap.questions.length ? recap.questions.map((q) => `- ${q.who}: ${q.text} (${q.state === 'open' ? 'not answered' : q.state})`) : ['- none']), '',
    '## Polls', ...((recap.polls || []).length ? recap.polls.flatMap((p) => [`- ${p.q}`, ...p.opts.map((o, i) => `  - ${o}: ${p.counts[i] || 0}`)]) : ['- none']), '',
    '## Reactions', `- Like: ${r.up}, Got it: ${r.idea}, Love it: ${r.heart}`, ''].join('\n');
};
const typingTarget = (t) => !!t?.closest?.('input, textarea, select, [contenteditable="true"], .bn-editor');

/** Where to draw overlays: inside the full-screen element when there is one, so they stay visible. */
export function useHost() {
  const [, bump] = useState(0);
  useEffect(() => {
    const on = () => bump((n) => n + 1);
    document.addEventListener('fullscreenchange', on);
    return () => document.removeEventListener('fullscreenchange', on);
  }, []);
  return document.fullscreenElement || document.body;
}

/** The small "Present to the room" card: how the room follows, and which extras are on. */
export function PresentStart({ mode, setMode, qOn, setQOn, notesOn, setNotesOn, count, onStart, onCancel }) {
  const host = useHost();
  const Opt = ({ id, icon, title, sub }) => (
    <button type="button" className={`opt${mode === id ? ' on' : ''}`} data-testid={`mode-${id}`} onClick={() => setMode(id)}>
      {icon}<span><strong>{title}</strong><small>{sub}</small></span>{mode === id && <Check size={16} />}
    </button>
  );
  const Tog = ({ on, set, label, id }) => (
    <label className="tog-row"><span>{label}</span><input type="checkbox" role="switch" data-testid={id} checked={on} onChange={(e) => set(e.target.checked)} /></label>
  );
  return createPortal(
    <div className="pb-pstart" role="dialog" aria-label="Present to the room" data-testid="present-start">
      <h4><Presentation size={16} />Present to the room<span className="pill">{count} here now</span></h4>
      <Opt id="follow" icon={<Users size={18} />} title="Everyone follows me" sub="Their page scrolls with yours. They can step out and return." />
      <Opt id="tour" icon={<Route size={18} />} title="Guided tour" sub="You set the stops and move through them." />
      <Opt id="point" icon={<Eye size={18} />} title="I point, they browse" sub="Laser and ping only. Nobody is moved." />
      <hr />
      <Tog on={qOn} set={setQOn} label="Raise hand and questions" id="opt-q" />
      <Tog on={notesOn} set={setNotesOn} label="Private notes and timer" id="opt-notes" />
      <div className="row"><button type="button" className="go" data-testid="present-go" onClick={onStart}><Play size={15} />Start presenting</button><button type="button" onClick={onCancel}>Cancel</button></div>
    </div>,
    host,
  );
}

/**
 * The presenter's dock and its side panel.
 * `state` is kept by the parent (it must survive the panel closing); this component owns the notes, timer and tour.
 */
export function PresenterKit({ aw, me, peers, mode, qOn, notesOn, laser, setLaser, spot, setSpot, getAnchor, goToBlock, onEnd }) {
  const host = useHost();
  const [panel, setPanel] = useState(null); // 'room' | 'notes' | 'q' | 'tour'
  const [clock, setClock] = useState({ acc: 0, since: Date.now() });
  const [, tick] = useState(0);
  const [plan, setPlan] = useState(20);
  const [done, setDone] = useState({}); // question id -> 'answered' | 'dismissed'
  const [stops, setStops] = useState([]);
  const [stopI, setStopI] = useState(-1);
  const noteKey = `peblo-pres-notes:${location.pathname}`;
  const [notes, setNotes] = useState(() => { try { return JSON.parse(localStorage.getItem(noteKey) || '[]'); } catch { return []; } });
  const [draft, setDraft] = useState('');
  const [poll, setPoll] = useState(null);
  const [pq, setPq] = useState('');
  const [popts, setPopts] = useState(['', '']);
  const pollLog = useRef(new Map());
  const reactSeen = useRef(new Map());
  const seen = useRef(new Map()); // person -> minutes in the room while presenting
  const asked = useRef(new Map()); // question id -> { who, text, at }
  const t0 = useRef(Date.now());
  const last = useRef(Date.now());

  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 1000); return () => clearInterval(t); }, []);
  const elapsed = clock.acc + (clock.since ? Date.now() - clock.since : 0);
  const others = peers.filter((p) => !p.me);

  // who is in the room, and for how long, for the recap
  useEffect(() => {
    const now = Date.now(); const dt = now - last.current; last.current = now;
    others.forEach((p) => {
      const k = peerKey(p);
      const e = seen.current.get(k) || { name: p.name, color: p.color, ms: 0, first: now, here: true };
      e.ms += Math.min(dt, 5000); e.here = true; e.last = now; seen.current.set(k, e);
    });
    seen.current.forEach((e, k) => { if (!others.some((p) => peerKey(p) === k)) e.here = false; });
  });

  const hands = others.filter((p) => p.hand).sort((a, b) => a.hand - b.hand);
  const questions = others.flatMap((p) => (p.asks || []).map((a) => ({ id: `${peerKey(p)}#${a.id}`, who: p.name, key: peerKey(p), text: a.text, at: a.at })));
  questions.forEach((q) => { if (!asked.current.has(q.id)) asked.current.set(q.id, { who: q.who, text: q.text, at: q.at }); });
  const open = questions.filter((q) => !done[q.id]);
  const following = others.filter((p) => p.follows === me).length;
  // reactions from the room (each person's running count; people who left still count) and the live poll tally
  others.forEach((p) => {
    if (!p.reacts) return;
    const k = peerKey(p); const e = reactSeen.current.get(k) || { up: 0, idea: 0, heart: 0 };
    ['up', 'idea', 'heart'].forEach((x) => { e[x] = Math.max(e[x], Number(p.reacts[x]) || 0); });
    reactSeen.current.set(k, e);
  });
  const reactTotals = { up: 0, idea: 0, heart: 0 };
  reactSeen.current.forEach((e) => { reactTotals.up += e.up; reactTotals.idea += e.idea; reactTotals.heart += e.heart; });
  const reactSum = reactTotals.up + reactTotals.idea + reactTotals.heart;
  const votes = poll ? others.map((p) => p.vote).filter((v) => v && v.id === poll.id) : [];
  const counts = poll ? poll.opts.map((_, i) => votes.filter((v) => v.i === i).length) : [];
  const countsKey = counts.join(',');
  if (poll) pollLog.current.set(poll.id, { q: poll.q, opts: poll.opts, counts });
  useEffect(() => { try { aw.setLocalStateField('poll', poll ? { ...poll, counts } : null); } catch { /* gone */ } }, [aw, poll, countsKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const startPoll = () => {
    const o = popts.map((x) => x.trim()).filter(Boolean);
    if (!pq.trim() || o.length < 2) return;
    setPoll({ id: Math.random().toString(36).slice(2, 8), q: pq.trim().slice(0, 140), opts: o.slice(0, 4).map((x) => x.slice(0, 60)), open: true });
    setPq(''); setPopts(['', '']);
  };
  const closePoll = () => setPoll((p) => (p ? { ...p, open: false } : p));

  // what the room needs to know about me
  useEffect(() => {
    try {
      aw.setLocalStateField('answered', Object.keys(done));
      aw.setLocalStateField('tour', stops.length ? { n: stops.length, i: stopI } : null);
    } catch { /* gone */ }
  }, [aw, done, stops.length, stopI]);
  useEffect(() => () => { try { aw.setLocalStateField('shown', null); aw.setLocalStateField('answered', []); aw.setLocalStateField('tour', null); aw.setLocalStateField('called', null); aw.setLocalStateField('poll', null); } catch { /* gone */ } }, [aw]);

  const saveNotes = (next) => { setNotes(next); try { localStorage.setItem(noteKey, JSON.stringify(next)); } catch { /* not kept */ } };
  const addNote = () => { const t = draft.trim(); if (!t) return; saveNotes([...notes, { t, at: Date.now() }]); setDraft(''); };
  const show = (q) => { try { aw.setLocalStateField('shown', { id: q.id, who: q.who, text: q.text }); } catch { /* gone */ } };
  const finish = (q, how) => {
    setDone((d) => ({ ...d, [q.id]: how }));
    try { const sh = aw.getLocalState()?.shown; if (sh?.id === q.id) aw.setLocalStateField('shown', null); } catch { /* gone */ }
  };
  const call = (p) => { try { aw.setLocalStateField('called', { key: peerKey(p), at: Date.now() }); } catch { /* gone */ } };

  const addStop = () => {
    const a = getAnchor(); if (!a) return;
    const el = document.querySelector(`.bn-block-outer[data-id="${CSS.escape(a.b)}"]`);
    const text = (el?.textContent || '').trim().slice(0, 60) || 'This spot';
    setStops((s) => s.some((x) => x.b === a.b) ? s : [...s, { b: a.b, t: text }]);
  };
  const goStop = (i) => { if (!stops[i]) return; setStopI(i); goToBlock(stops[i].b); };
  const nextStop = () => goStop(stops.length ? (stopI + 1) % stops.length : 0);

  const end = () => {
    const now = Date.now();
    const people = [...seen.current.values()].map((e) => ({ name: e.name, color: e.color, min: Math.max(1, Math.round(e.ms / 60000)), stayed: !!e.here }));
    const qs = [...asked.current.entries()].map(([id, q]) => ({ ...q, state: done[id] || 'open' }));
    onEnd({ minutes: Math.max(1, Math.round((now - t0.current) / 60000)), people, joined: people.length, stayed: people.filter((p) => p.stayed).length, questions: qs, notes, reacts: reactTotals, polls: [...pollLog.current.values()] });
  };

  useEffect(() => {
    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey || typingTarget(e.target)) return;
      const k = e.key.toLowerCase();
      if (k === 'n' && notesOn) setPanel((p) => (p === 'notes' ? null : 'notes'));
      else if (k === 'q' && qOn) setPanel((p) => (p === 'q' ? null : 'q'));
      else if (k === 'p') setPanel((p) => (p === 'poll' ? null : 'poll'));
      else if (k === 't' && mode === 'tour') setPanel((p) => (p === 'tour' ? null : 'tour'));
      else if (k === ' ' && stops.length) { e.preventDefault(); nextStop(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  const Btn = ({ id, icon, label, on, onClick, badge, tid, hint }) => (
    <button type="button" className={`pd-b${on ? ' on' : ''}`} data-testid={tid} aria-pressed={on} title={hint || label} onClick={onClick}>{icon}<span>{label}</span>{badge > 0 && <i className="pd-n">{badge}</i>}</button>
  );

  const timerRow = (
    <div className="pd-timer">
      <Timer size={20} /><div><strong>{mmss(elapsed)}</strong><small>of <input type="number" min="1" max="240" value={plan} aria-label="Planned minutes" onChange={(e) => setPlan(Math.max(1, Number(e.target.value) || 1))} />:00 planned</small></div>
      <button type="button" data-testid="timer-toggle" onClick={() => setClock((c) => c.since ? { acc: c.acc + Date.now() - c.since, since: null } : { acc: c.acc, since: Date.now() })}>{clock.since ? <Pause size={14} /> : <Play size={14} />}{clock.since ? 'Pause' : 'Resume'}</button>
      <div className="bar"><i style={{ width: `${Math.min(100, (elapsed / (plan * 60000)) * 100)}%` }} /></div>
    </div>
  );

  return createPortal(
    <>
      {panel && (
        <aside className="pb-ppanel" data-testid={`panel-${panel}`} aria-label="Presenter panel">
          <header><h3>{{ room: 'Audience', notes: 'Notes', q: 'Questions', tour: 'Tour', poll: 'Poll' }[panel]}</h3><button type="button" aria-label="Close panel" onClick={() => setPanel(null)}><X size={16} /></button></header>
          {panel === 'room' && <div className="pp-body">
            <div className="pp-sub">{others.length} here, {following} following</div>
            {others.length === 0 && <p className="pp-empty">Nobody else is here yet.</p>}
            {others.map((p) => (
              <div className="pp-row" key={peerKey(p)} data-testid="aud-row">
                <span className="av" style={{ background: p.color }}>{(p.name[0] || '?').toUpperCase()}</span>
                <div><b>{p.name}</b><small>{p.follows === me ? 'Following you' : p.idle ? 'Away' : 'Browsing on their own'}</small></div>
                {p.hand ? <span className="tag hand"><Hand size={12} />Hand</span> : null}
              </div>
            ))}
          </div>}
          {panel === 'notes' && <div className="pp-body">
            <div className="pp-lock"><EyeOff size={15} />Only you can see this. Never saved to the page.</div>
            {notes.map((n, i) => <div className="pp-note" key={i}>{n.t}<button type="button" aria-label="Remove note" onClick={() => saveNotes(notes.filter((_, j) => j !== i))}><X size={12} /></button></div>)}
            <hr />{timerRow}
            <div className="pp-add"><input value={draft} aria-label="Add a private note" placeholder="Add a private note" data-testid="note-input" onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addNote(); }} /><button type="button" onClick={addNote} data-testid="note-add">Add</button></div>
          </div>}
          {panel === 'q' && <div className="pp-body">
            <div className="pp-sub">Hands up, in order</div>
            {hands.length === 0 && <p className="pp-empty">No hands up.</p>}
            {hands.map((p) => <div className="pp-row" key={peerKey(p)} data-testid="hand-row"><span className="av" style={{ background: p.color }}>{(p.name[0] || '?').toUpperCase()}</span><div><b>{p.name}</b><small>Raised a hand · {ago(p.hand)}</small></div><button type="button" className="go" data-testid="call-on" onClick={() => call(p)}>Call on</button></div>)}
            <hr /><div className="pp-sub">Questions</div>
            {questions.length === 0 && <p className="pp-empty">No questions yet.</p>}
            {questions.map((q) => (
              <div className={`pp-q${done[q.id] ? ' done' : ''}`} key={q.id} data-testid="question">
                <b>{q.who}</b> {q.text}
                {done[q.id] ? <span className="tag ok">{done[q.id] === 'answered' ? 'Answered' : 'Dismissed'}</span> : (
                  <div className="acts">
                    <button type="button" data-testid="q-show" onClick={() => show(q)}><Eye size={13} />Show on page</button>
                    <button type="button" data-testid="q-answered" onClick={() => finish(q, 'answered')}><Check size={13} />Answered</button>
                    <button type="button" onClick={() => finish(q, 'dismissed')}><X size={13} />Dismiss</button>
                  </div>
                )}
              </div>
            ))}
          </div>}
          {panel === 'poll' && <div className="pp-body">
            {!poll ? <>
              <div className="pp-sub">Ask the room</div>
              <input className="pp-in" aria-label="Poll question" data-testid="poll-q" placeholder="Your question" maxLength={140} value={pq} onChange={(e) => setPq(e.target.value)} />
              {popts.map((o, i) => <input className="pp-in" key={i} aria-label={`Option ${i + 1}`} data-testid={`poll-in-${i}`} placeholder={`Option ${i + 1}`} maxLength={60} value={o} onChange={(e) => setPopts((l) => l.map((x, j) => (j === i ? e.target.value : x)))} />)}
              {popts.length < 4 && <button type="button" className="pp-link" data-testid="poll-more" onClick={() => setPopts((l) => [...l, ''])}><Plus size={13} />Add an option</button>}
              <button type="button" className="go wide" data-testid="poll-start" onClick={startPoll}><ListChecks size={14} />Start poll</button>
            </> : <>
              <div className="pp-sub">{poll.open ? 'Poll is open' : 'Poll closed'} · {votes.length} vote{votes.length === 1 ? '' : 's'}</div>
              <b>{poll.q}</b>
              {poll.opts.map((o, i) => <div className="pp-bar" key={i} data-testid="poll-result"><i style={{ width: `${votes.length ? (counts[i] / votes.length) * 100 : 0}%` }} /><span>{o}</span><em>{counts[i]}</em></div>)}
              {poll.open ? <button type="button" className="go wide" data-testid="poll-close" onClick={closePoll}>Close poll</button> : <button type="button" className="go wide" data-testid="poll-new" onClick={() => setPoll(null)}>New poll</button>}
            </>}
          </div>}
          {panel === 'tour' && <div className="pp-body">
            <div className="pp-sub">{stops.length} stops. Press Space for the next one.</div>
            {stops.map((s, i) => <button type="button" className={`pp-stop${i === stopI ? ' on' : ''}`} key={s.b} data-testid="tour-stop" onClick={() => goStop(i)}><span>{i + 1}</span>{s.t}</button>)}
            <button type="button" className="go wide" data-testid="tour-add" onClick={addStop}><Plus size={14} />Add this spot as a stop</button>
          </div>}
        </aside>
      )}
      <div className="pb-pdock" role="toolbar" aria-label="Presenter tools" data-testid="presenting-banner">
        <span className="pd-pill"><Presentation size={14} />Presenting · {mmss(elapsed)} · {following} following</span>
        <span className="pd-sep" />
        <button type="button" className={`pd-b${laser ? ' on' : ''}`} aria-pressed={laser} data-testid="tool-laser" title="Laser pointer: your pointer shows as a red dot" onClick={() => setLaser((v) => !v)}><Ic name="laser" size={16} /><span>Laser</span></button>
        <button type="button" className={`pd-b${spot ? ' on' : ''}`} aria-pressed={spot} data-testid="tool-spot" title="Spotlight: dim everything except the block you point at" onClick={() => setSpot((v) => !v)}><Ic name="spotlight" size={16} /><span>Spotlight</span></button>
        <span className="pd-hint" title="Alt + click anywhere in the note to ping that spot for everyone"><Ic name="ping" size={15} />Alt+click</span>
        <span className="pd-sep" />
        {reactSum > 0 && <span className="pd-react" data-testid="react-counts" title="Reactions from the room"><ThumbsUp size={13} />{reactTotals.up}<Lightbulb size={13} />{reactTotals.idea}<Heart size={13} />{reactTotals.heart}</span>}
        <Btn tid="dock-poll" icon={<ListChecks size={16} />} label="Poll" on={panel === 'poll'} onClick={() => setPanel((p) => (p === 'poll' ? null : 'poll'))} badge={poll && poll.open ? votes.length : 0} hint="Poll (P)" />
        <Btn tid="dock-room" icon={<Users size={16} />} label="Audience" on={panel === 'room'} onClick={() => setPanel((p) => (p === 'room' ? null : 'room'))} badge={0} />
        {notesOn && <Btn tid="dock-notes" icon={<StickyNote size={16} />} label="Notes" on={panel === 'notes'} onClick={() => setPanel((p) => (p === 'notes' ? null : 'notes'))} hint="Notes (N)" />}
        {qOn && <Btn tid="dock-q" icon={<CircleHelp size={16} />} label="Questions" on={panel === 'q'} onClick={() => setPanel((p) => (p === 'q' ? null : 'q'))} badge={open.length + hands.length} hint="Questions (Q)" />}
        {mode === 'tour' && <Btn tid="dock-tour" icon={<Route size={16} />} label={stops.length ? `Stop ${Math.max(0, stopI) + 1} of ${stops.length}` : 'Tour'} on={panel === 'tour'} onClick={() => setPanel((p) => (p === 'tour' ? null : 'tour'))} hint="Tour (T)" />}
        {stops.length > 0 && <button type="button" className="pd-b" data-testid="next-stop" title="Next stop (Space)" onClick={nextStop}><SkipForward size={16} /><span>Next</span></button>}
        <span className="pd-sep" />
        <button type="button" className="pd-b end" data-testid="present-end" onClick={end}><X size={16} /><span>End</span></button>
      </div>
    </>,
    host,
  );
}

/** What the room sees: a question the presenter put on the page, and a nudge when called on. */
export function RoomNotices({ presenters, myKey, onClearHand, myVote, onVote }) {
  const host = useHost();
  const shown = presenters.map((p) => p.shown && { ...p.shown, by: p.name }).find(Boolean);
  const called = presenters.find((p) => p.called && p.called.key === myKey && Date.now() - p.called.at < 20000);
  useEffect(() => { if (called) onClearHand(); }, [called?.called?.at]); // eslint-disable-line react-hooks/exhaustive-deps
  const poll = presenters.map((p) => p.poll && { ...p.poll, by: p.name }).find(Boolean);
  if (!shown && !called && !poll) return null;
  return createPortal(
    <div className="pb-rnotes" role="status">
      {shown && <div className="pb-shownq" data-testid="shown-question"><CircleHelp size={16} /><div><small>Question from {shown.who}</small>{shown.text}</div></div>}
      {poll && <div className="pb-pollcard" data-testid="poll-card"><small>Poll from {poll.by}</small><b>{poll.q}</b>
        {poll.opts.map((o, i) => {
          const mine = myVote?.id === poll.id && myVote.i === i;
          const showRes = !poll.open || myVote?.id === poll.id;
          return <button type="button" key={i} className={`pc-opt${mine ? ' on' : ''}`} data-testid={`poll-opt-${i}`} disabled={!poll.open} onClick={() => onVote?.(poll.id, i)}><span>{o}</span>{showRes && <em>{poll.counts?.[i] || 0}</em>}{mine && <Check size={14} />}</button>;
        })}
        {!poll.open && <small>Poll closed</small>}
      </div>}
      {called && <div className="pb-shownq call" data-testid="called-on"><Hand size={16} /><div>{called.name} is calling on you</div></div>}
    </div>,
    host,
  );
}

/** What the room can do: raise a hand, ask something. */
export function AudienceActions({ presenter, hand, onHand, onAsk, sent, qOn = true, reacts, onReact }) {
  const [ask, setAsk] = useState(false);
  const [text, setText] = useState('');
  useEffect(() => {
    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey || typingTarget(e.target)) return;
      const k = e.key.toLowerCase();
      if (!qOn) return;
      if (k === 'h') onHand();
      else if (k === 'q') { e.preventDefault(); setAsk(true); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });
  const send = () => { const t = text.trim(); if (!t) return; onAsk(t); setText(''); setAsk(false); };
  return (
    <div className="pb-aud" data-testid="aud-actions">
      {qOn && <button type="button" className={hand ? 'on' : ''} aria-pressed={!!hand} data-testid="raise-hand" title="Raise hand (H)" onClick={onHand}><Hand size={15} />{hand ? 'Hand up' : 'Raise hand'}</button>}
      {qOn && <button type="button" data-testid="ask-open" title="Ask a question (Q)" onClick={() => setAsk((v) => !v)}><CircleHelp size={15} />Ask</button>}
      {onReact && <span className="pb-reacts">{[['up', 'Like', ThumbsUp], ['idea', 'Got it', Lightbulb], ['heart', 'Love it', Heart]].map(([k, t, I]) => <button key={k} type="button" data-testid={`react-${k}`} title={t} aria-label={t} onClick={() => onReact(k)}><I size={14} />{reacts?.[k] > 0 && <i>{reacts[k]}</i>}</button>)}</span>}
      {ask && <div className="pb-ask"><input autoFocus aria-label={`Ask ${presenter.name} a question`} data-testid="ask-input" placeholder={`Ask ${presenter.name} a question`} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') send(); if (e.key === 'Escape') setAsk(false); }} /><button type="button" data-testid="ask-send" onClick={send}>Send</button><small>Visible to {presenter.name} only until they show it.</small></div>}
      {sent > 0 && !ask && <small className="sent">{sent} question{sent > 1 ? 's' : ''} sent</small>}
    </div>
  );
}

/** The end of the session. */
export function RecapModal({ recap, onClose, onSend, sent }) {
  const host = useHost();
  const download = () => {
    const md = `${recapMarkdown(recap)}\n## Private notes\n${recap.notes.length ? recap.notes.map((n) => `- ${n.t}`).join('\n') : '- none'}\n`;
    const url = URL.createObjectURL(new Blob([md], { type: 'text/markdown' }));
    const a = document.createElement('a'); a.href = url; a.download = 'session-recap.md'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 2000);
  };
  const answered = recap.questions.filter((q) => q.state === 'answered').length;
  const stillOpen = recap.questions.filter((q) => q.state === 'open');
  const rs = recap.reacts || { up: 0, idea: 0, heart: 0 };
  const reactSum = rs.up + rs.idea + rs.heart;
  const stat = useMemo(() => [[recap.joined, `joined, ${recap.stayed} stayed to the end`], [recap.questions.length, `questions, ${answered} answered`], [recap.minutes, 'minutes presented']], [recap, answered]);
  const send = () => onSend?.({ at: Date.now(), md: recapMarkdown(recap), minutes: recap.minutes, joined: recap.joined, questions: recap.questions.length, reactions: reactSum });
  return createPortal(
    <div className="pb-recap-back" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <section className="pb-recap" role="dialog" aria-modal="true" aria-label="Session recap" data-testid="recap">
        <header><h2>Session recap</h2><span className="tag ok">Ended</span></header>
        <p>You presented for {recap.minutes} minute{recap.minutes > 1 ? 's' : ''}.</p>
        <div className="stats">{stat.map(([n, t], i) => <div key={i}><b>{n}</b><small>{t}</small></div>)}</div>
        <div className="cols">
          <div><h5>Who was there</h5>{recap.people.length === 0 ? <p className="pp-empty">Nobody joined.</p> : recap.people.map((p) => <div className="pp-row" key={p.name + p.color}><span className="av" style={{ background: p.color }}>{(p.name[0] || '?').toUpperCase()}</span><div><b>{p.name}</b></div><span className="tag">{p.min} min{p.stayed ? '' : ', left early'}</span></div>)}</div>
          <div><h5>Still open</h5>{stillOpen.length === 0 ? <p className="pp-empty">Every question was dealt with.</p> : stillOpen.map((q, i) => <div className="pp-q" key={i}><b>{q.who}</b> {q.text}</div>)}</div>
        </div>
        {((recap.polls || []).length > 0 || reactSum > 0) && <div className="cols" data-testid="recap-extras">
          <div><h5>Polls</h5>{(recap.polls || []).length === 0 ? <p className="pp-empty">No polls.</p> : recap.polls.map((p, i) => <div className="pp-q" key={i}><b>{p.q}</b>{p.opts.map((o, j) => <div key={j}>{o}: {p.counts[j] || 0}</div>)}</div>)}</div>
          <div><h5>Reactions</h5><div className="pp-q" data-testid="recap-reacts">Like {rs.up}, Got it {rs.idea}, Love it {rs.heart}</div></div>
        </div>}
        <div className="row">{onSend && <button type="button" onClick={send} disabled={sent} data-testid="recap-send"><Send size={15} />{sent ? 'Sent to everyone' : 'Send to everyone'}</button>}<button type="button" onClick={download} data-testid="recap-download"><Download size={15} />Download notes</button><button type="button" className="go" data-testid="recap-done" onClick={onClose}>Done</button></div>
      </section>
    </div>,
    host,
  );
}

/** What someone who stayed in the room sees after the presenter sends the recap. */
export function RecapReceived({ from, rx, onClose }) {
  const host = useHost();
  const download = () => {
    const url = URL.createObjectURL(new Blob([rx.md], { type: 'text/markdown' }));
    const a = document.createElement('a'); a.href = url; a.download = 'session-recap.md'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 2000);
  };
  return createPortal(
    <div className="pb-rx" role="dialog" aria-label="Session recap" data-testid="recap-received">
      <button type="button" className="rx-x" aria-label="Dismiss" data-testid="recapr-dismiss" onClick={onClose}><X size={14} /></button>
      <small>Session recap from {from}</small>
      <b>{rx.minutes} min, {rx.joined} joined</b>
      <p>{rx.questions} question{rx.questions === 1 ? '' : 's'} and {rx.reactions} reaction{rx.reactions === 1 ? '' : 's'}.</p>
      <button type="button" className="rx-go" data-testid="recapr-download" onClick={download}><Download size={14} />Download recap</button>
    </div>,
    host,
  );
}

export const PRESENT_CSS = `
.pb-pstart { pointer-events: auto; position: fixed; left: 50%; bottom: 84px; transform: translateX(-50%); z-index: 1210; max-height: calc(100dvh - 110px); overflow-y: auto; width: min(380px, calc(100vw - 24px)); padding: 16px; border-radius: 20px; background: #fff; color: #241f1a; box-shadow: 0 18px 50px rgba(30,10,70,.28); border: 1px solid #e8e1f5; font: 500 13px 'Figtree', system-ui, sans-serif; text-align: left; }
.pb-pstart h4 { display: flex; align-items: center; gap: 8px; margin: 0 0 10px; font-size: 15px; }
.pb-pstart h4 .pill { margin-left: auto; padding: 2px 10px; border-radius: 999px; background: #dff3e8; font-size: 11px; font-weight: 700; }
.pb-pstart .opt { display: flex; align-items: center; gap: 10px; width: 100%; border: 0; border-radius: 14px; padding: 10px 12px; background: transparent; color: inherit; text-align: left; cursor: pointer; }
.pb-pstart .opt.on { background: #efe9ff; }
.pb-pstart .opt span { flex: 1; display: grid; }
.pb-pstart .opt small { color: #6b6378; font-weight: 500; }
.pb-pstart hr, .pb-ppanel hr, .pb-recap hr { border: 0; border-top: 1px solid rgba(120,100,160,.2); margin: 8px 0; }
.pb-pstart .tog-row { display: flex; align-items: center; justify-content: space-between; padding: 6px 4px; }
.pb-pstart .row, .pb-recap .row { display: flex; gap: 10px; margin-top: 10px; }
.pb-pstart .row button, .pb-recap .row button { display: inline-flex; align-items: center; gap: 7px; border: 1px solid #ddd3f0; border-radius: 999px; padding: 9px 16px; background: #fff; font: 700 13px 'Figtree', system-ui, sans-serif; cursor: pointer; color: inherit; }
.pb-pstart .go, .pb-recap .go, .pb-ppanel .go { background: #7c3aed !important; border-color: #7c3aed !important; color: #fff !important; }
.pb-pdock { position: fixed; left: 50%; bottom: 16px; transform: translateX(-50%); z-index: 1160; display: flex; align-items: center; gap: 4px; max-width: calc(100vw - 20px); overflow-x: auto; padding: 6px; border-radius: 999px; background: #2b1458; color: #f3ecff; box-shadow: 0 16px 44px rgba(30,10,70,.5); font: 700 13px 'Figtree', system-ui, sans-serif; }
.pb-pdock .pd-pill { display: inline-flex; align-items: center; gap: 7px; padding: 8px 12px; border-radius: 999px; background: #7c3aed; color: #fff; white-space: nowrap; }
.pb-pdock .pd-sep { width: 1px; align-self: stretch; margin: 6px 4px; background: rgba(255,255,255,.18); }
.pb-pdock .pd-hint { display: inline-flex; align-items: center; gap: 5px; padding: 0 8px; font-size: 11px; opacity: .8; white-space: nowrap; }
.pb-pdock .pd-b { position: relative; display: inline-flex; align-items: center; gap: 6px; border: 0; border-radius: 999px; padding: 8px 12px; background: transparent; color: inherit; font: inherit; cursor: pointer; white-space: nowrap; }
.pb-pdock .pd-b:hover { background: rgba(255,255,255,.12); }
.pb-pdock .pd-b.on { background: #fff; color: #5b21b6; }
.pb-pdock .pd-b.end { background: #ff6b4a; color: #1b0f0b; }
.pb-pdock .pd-n { min-width: 18px; height: 18px; padding: 0 5px; border-radius: 9px; background: #ff6b4a; color: #1b0f0b; font: 800 11px/18px 'Figtree', system-ui, sans-serif; text-align: center; font-style: normal; }
.pb-ppanel { position: fixed; right: 16px; bottom: 76px; top: 76px; width: min(330px, calc(100vw - 24px)); z-index: 1155; display: flex; flex-direction: column; border-radius: 22px; background: #2b1458; color: #f3ecff; box-shadow: 0 18px 50px rgba(30,10,70,.5); font: 500 13px 'Figtree', system-ui, sans-serif; overflow: hidden; }
.pb-ppanel header { display: flex; align-items: center; justify-content: space-between; padding: 14px 16px 6px; }
.pb-ppanel h3 { margin: 0; font-size: 16px; }
.pb-ppanel header button, .pb-ppanel .pp-note button { border: 0; background: transparent; color: inherit; cursor: pointer; opacity: .8; }
.pp-body { flex: 1; overflow-y: auto; padding: 8px 14px 16px; display: grid; align-content: start; gap: 8px; }
.pp-sub { font-size: 11px; letter-spacing: .06em; text-transform: uppercase; opacity: .7; }
.pp-empty { margin: 0; opacity: .7; }
.pp-lock { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-radius: 14px; background: #3a2766; font-weight: 700; }
.pp-row { display: flex; align-items: center; gap: 10px; }
.pp-row > div { flex: 1; display: grid; min-width: 0; }
.pp-row small { opacity: .7; }
.pp-row .av { width: 30px; height: 30px; border-radius: 50%; display: grid; place-items: center; color: #fff; font-weight: 800; flex: none; }
.tag { display: inline-flex; align-items: center; gap: 4px; padding: 2px 9px; border-radius: 999px; background: rgba(255,255,255,.14); font-size: 11px; font-weight: 700; }
.tag.ok { background: #dff3e8; color: #14532d; }
.tag.hand { background: #ff6b4a; color: #1b0f0b; }
.pp-note, .pp-q { position: relative; padding: 10px 12px; border-radius: 14px; background: #3a2766; line-height: 1.45; }
.pp-note button { position: absolute; top: 6px; right: 6px; }
.pp-q.done { opacity: .6; }
.pp-q .acts { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.pp-q .acts button, .pp-add button, .pp-timer button, .pd-timer button, .pb-ppanel .go { display: inline-flex; align-items: center; gap: 5px; border: 0; border-radius: 999px; padding: 6px 12px; background: rgba(255,255,255,.16); color: inherit; font: 700 12px 'Figtree', system-ui, sans-serif; cursor: pointer; }
.pb-ppanel .go.wide { justify-content: center; padding: 10px; }
.pp-add { display: flex; gap: 8px; }
.pp-add input { flex: 1; min-width: 0; border: 0; border-radius: 12px; padding: 9px 12px; background: #3a2766; color: #fff; font: inherit; }
.pp-stop { display: flex; align-items: center; gap: 10px; border: 0; border-radius: 14px; padding: 10px 12px; background: #3a2766; color: inherit; text-align: left; cursor: pointer; font: 700 13px 'Figtree', system-ui, sans-serif; }
.pp-stop.on { background: #7c3aed; }
.pp-stop span { width: 24px; height: 24px; border-radius: 50%; display: grid; place-items: center; background: rgba(255,255,255,.18); font-size: 12px; flex: none; }
.pd-timer { display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: 4px 10px; }
.pd-timer strong { font-size: 22px; }
.pd-timer small { display: block; opacity: .75; }
.pd-timer small input { width: 40px; border: 0; border-radius: 6px; background: #3a2766; color: #fff; font: inherit; padding: 1px 4px; }
.pd-timer .bar { grid-column: 1 / -1; height: 6px; border-radius: 3px; background: #3a2766; overflow: hidden; }
.pd-timer .bar i { display: block; height: 100%; background: #ff6b4a; }
.pb-rnotes { position: fixed; left: 50%; top: 70px; transform: translateX(-50%); z-index: 1170; display: grid; gap: 8px; width: min(440px, calc(100vw - 24px)); }
.pb-shownq { display: flex; gap: 10px; align-items: flex-start; padding: 14px 16px; border-radius: 18px; background: #2b1458; color: #fff; box-shadow: 0 14px 40px rgba(30,10,70,.45); font: 600 15px/1.45 'Figtree', system-ui, sans-serif; }
.pb-shownq small { display: block; opacity: .75; font-size: 11px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; }
.pb-shownq.call { background: #ff6b4a; color: #1b0f0b; }
.pb-aud { pointer-events: auto; position: relative; display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 6px; }
.pb-aud > button { display: inline-flex; align-items: center; gap: 6px; border: 0; border-radius: 999px; padding: 6px 12px; background: #2b1458; color: #fff; font: 700 12px 'Figtree', system-ui, sans-serif; cursor: pointer; }
.pb-aud > button.on { background: #ff6b4a; color: #1b0f0b; }
.pb-aud .sent { color: #6b6378; font-size: 11px; }
.pb-ask { position: absolute; top: 100%; right: 0; z-index: 5; margin-top: 6px; width: 300px; display: flex; flex-wrap: wrap; gap: 6px; padding: 10px; border-radius: 16px; background: #fff; color: #241f1a; box-shadow: 0 14px 40px rgba(30,10,70,.3); }
.pb-ask input { flex: 1; min-width: 0; border: 1px solid #ddd3f0; border-radius: 12px; padding: 8px 10px; font: inherit; }
.pb-ask button { border: 0; border-radius: 12px; padding: 8px 14px; background: #7c3aed; color: #fff; font-weight: 700; cursor: pointer; }
.pb-ask small { width: 100%; color: #6b6378; }
.pb-recap-back { position: fixed; inset: 0; z-index: 1200; display: grid; place-items: center; background: rgba(20,10,40,.5); }
.pb-recap { width: min(720px, calc(100vw - 24px)); max-height: calc(100dvh - 40px); overflow-y: auto; padding: 22px 24px; border-radius: 26px; background: #fff; color: #241f1a; box-shadow: 0 24px 70px rgba(30,10,70,.4); font: 500 14px 'Figtree', system-ui, sans-serif; }
.pb-recap header { display: flex; align-items: center; gap: 10px; } .pb-recap h2 { margin: 0; font-size: 22px; } .pb-recap header .tag { margin-left: auto; }
.pb-recap .stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin: 12px 0; }
.pb-recap .stats div { padding: 12px 14px; border-radius: 18px; background: #f1ebff; } .pb-recap .stats b { display: block; font-size: 26px; } .pb-recap .stats small { color: #6b6378; }
.pb-recap .cols { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; } .pb-recap h5 { margin: 0 0 6px; font-size: 12px; letter-spacing: .06em; text-transform: uppercase; color: #6b6378; }
.pb-recap .pp-q, .pb-recap .tag { background: #f1ebff; color: inherit; } .pb-recap .pp-row small { color: #6b6378; }
.pb-recap .row { justify-content: flex-end; }
@media (max-width: 640px) { .pb-pdock { bottom: 84px; } .pb-recap .cols, .pb-recap .stats { grid-template-columns: 1fr; } .pb-ppanel { top: 60px; bottom: 140px; } }
html.pb-presenting .pb-shared .dk, html.pb-presenting .pb-shared .dh, html.pb-presenting .pb-shared .dk-edge { display: none; }
.pb-pdock .pd-react { display: inline-flex; align-items: center; gap: 4px; padding: 0 8px; font-size: 12px; white-space: nowrap; }
.pp-in { border: 0; border-radius: 12px; padding: 9px 12px; background: #3a2766; color: #fff; font: inherit; width: 100%; box-sizing: border-box; }
.pp-link { display: inline-flex; align-items: center; gap: 5px; border: 0; background: transparent; color: inherit; font: 700 12px 'Figtree', system-ui, sans-serif; cursor: pointer; opacity: .85; justify-self: start; }
.pp-bar { position: relative; display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 9px 12px; border-radius: 12px; background: #3a2766; overflow: hidden; }
.pp-bar i { position: absolute; left: 0; top: 0; bottom: 0; background: #7c3aed; opacity: .75; }
.pp-bar span, .pp-bar em { position: relative; font-style: normal; font-weight: 700; }
.pb-pollcard { pointer-events: auto; display: grid; gap: 6px; padding: 14px 16px; border-radius: 18px; background: #2b1458; color: #fff; box-shadow: 0 14px 40px rgba(30,10,70,.45); font: 600 14px 'Figtree', system-ui, sans-serif; }
.pb-pollcard small { opacity: .75; font-size: 11px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; }
.pb-pollcard .pc-opt { display: flex; align-items: center; justify-content: space-between; gap: 8px; border: 0; border-radius: 12px; padding: 9px 12px; background: #3a2766; color: inherit; font: inherit; cursor: pointer; text-align: left; }
.pb-pollcard .pc-opt.on { background: #7c3aed; }
.pb-pollcard .pc-opt:disabled { cursor: default; opacity: .9; }
.pb-pollcard em { font-style: normal; opacity: .85; }
.pb-reacts { display: inline-flex; gap: 4px; }
.pb-aud .pb-reacts > button { display: inline-flex; align-items: center; gap: 4px; border: 0; border-radius: 999px; padding: 6px 9px; background: #2b1458; color: #fff; cursor: pointer; font: 700 11px 'Figtree', system-ui, sans-serif; }
.pb-aud .pb-reacts i { font-style: normal; }
.pb-rx { position: fixed; left: 50%; top: 70px; transform: translateX(-50%); z-index: 1200; width: min(360px, calc(100vw - 24px)); display: grid; gap: 4px; padding: 16px 18px; border-radius: 18px; background: #2b1458; color: #fff; box-shadow: 0 14px 40px rgba(30,10,70,.45); font: 600 14px 'Figtree', system-ui, sans-serif; }
.pb-rx small { opacity: .75; font-size: 11px; letter-spacing: .04em; text-transform: uppercase; } .pb-rx p { margin: 0; opacity: .85; font-weight: 500; }
.pb-rx .rx-x { position: absolute; top: 8px; right: 8px; border: 0; background: transparent; color: inherit; cursor: pointer; opacity: .8; }
.pb-rx .rx-go { justify-self: start; display: inline-flex; align-items: center; gap: 6px; margin-top: 6px; border: 0; border-radius: 999px; padding: 8px 14px; background: #fff; color: #2b1458; font: 700 13px 'Figtree', system-ui, sans-serif; cursor: pointer; }
.pb-recap .row button:disabled { opacity: .6; cursor: default; }
`;

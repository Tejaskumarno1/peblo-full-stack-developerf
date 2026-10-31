import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, CircleHelp, Download, Eye, EyeOff, Hand, Heart, Lightbulb, ListChecks, Pause, Play, Route, Send, SkipForward, StickyNote, ThumbsUp, Timer, Users, X, Presentation, Plus, GripVertical, Minimize2, Maximize2, Pencil, Highlighter, Layers, Search, Link2 } from 'lucide-react';
import { Ic } from '../utils/icons';
import api from '../api/client';
import { getToken } from '../api/token';

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

/** "Ready to present?": options on the left, what the room will see on the right (mockups P1b, P1e). */
const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* not kept */ } };
const previewOf = () => {
  const root = document.querySelector('.bn-editor');
  const t = [...(root?.querySelectorAll('.bn-block-content') || [])].map((el) => ({ h: el.getAttribute('data-content-type') === 'heading', lvl: el.getAttribute('data-level') || '1', text: (el.textContent || '').trim() })).filter((x) => x.text).slice(0, 6);
  return t;
};

// The Present dropdown (mockup P1c): four ways to start, options at the foot
export function PresentMenu({ anchor, count, qOn, setQOn, onPick, onOptions, onClose, decks = [], onDeck }) {
  const [deckList, setDeckList] = useState(false);
  const ref = useRef(null);
  const [pos, setPos] = useState({ top: 56, right: 16 });
  const closeRef = useRef(onClose); closeRef.current = onClose;
  useEffect(() => {
    const r = anchor?.getBoundingClientRect?.();
    if (r) { const up = r.bottom + 340 > window.innerHeight; const top = up ? -Math.round(window.innerHeight - r.top + 10) : Math.round(r.bottom + 10), right = Math.max(12, Math.round(window.innerWidth - r.right - 8)); const left = r.left + r.width / 2 < window.innerWidth / 2 ? Math.max(12, Math.round(r.left)) : null; setPos((p) => (p.top === top && p.right === right && p.left === left ? p : { top, right, left })); }
    const off = (e) => { if (ref.current && !ref.current.contains(e.target) && !anchor?.contains(e.target)) closeRef.current(); };
    const key = (e) => { if (e.key === 'Escape') closeRef.current(); };
    document.addEventListener('mousedown', off); document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', off); document.removeEventListener('keydown', key); };
  }, [anchor]);
  // one stable component (a Row made fresh on every render is a new element each time, and a click whose mouse-down and mouse-up straddle a render is lost)
  const rowImpl = useRef(null);
  const Row = useMemo(() => (p) => rowImpl.current(p), []);
  rowImpl.current = ({ tid, icon, title, sub, keys, hot, off, mode }) => (
    <button type="button" role="menuitem" className={`pm-row${hot ? ' hot' : ''}`} data-testid={tid} disabled={off} onClick={() => (mode === 'ppt' ? (decks.length === 1 ? onDeck?.(decks[0]) : setDeckList((v) => !v)) : onPick(mode))}>
      <span className="pm-ic">{icon}</span><span className="pm-tx"><b>{title}</b><small>{sub}</small></span>{keys && <kbd>{keys}</kbd>}
    </button>
  );
  return createPortal(
    <div ref={ref} className="pb-pmenu" role="menu" aria-label="Present" data-testid="present-menu" style={{ ...(pos.top < 0 ? { bottom: -pos.top } : { top: pos.top }), ...(pos.left != null ? { left: pos.left } : { right: pos.right }) }}>
      <Row tid="pm-start" hot mode="follow" icon={<Presentation size={18} />} title="Start now, full screen" sub={`Follow me, questions ${qOn ? 'on' : 'off'}. ${count} ${count === 1 ? 'person is' : 'people'} here.`} keys="Ctrl Shift P" />
      <Row tid="pm-tour" mode="tour" icon={<Route size={18} />} title="Guided tour" sub="Walk everyone through stops you choose" />
      <Row tid="pm-point" mode="point" icon={<Eye size={18} />} title="Point only" sub="Your pointer shows, people read freely" />
      <Row tid="pm-ppt" off={!decks.length} mode="ppt" icon={<Download size={18} />} title="Present a PowerPoint" sub={decks.length ? (decks.length === 1 ? decks[0].name : `${decks.length} decks in this note, pick one`) : 'Add a deck to the note first'} />
      {deckList && decks.length > 1 && <div className="pm-decks">{decks.map((d) => <button key={d.url} type="button" role="menuitem" className="pm-deck" data-testid="pm-deck" onClick={() => onDeck?.(d)}><Presentation size={15} /><span>{d.name}</span></button>)}</div>}
      <div className="pm-foot">
        <button type="button" className="pm-opt" data-testid="present-options" onClick={onOptions}>Options</button>
        <button type="button" className={`pm-chip${qOn ? ' on' : ''}`} data-testid="pm-q" aria-pressed={qOn} onClick={() => setQOn(!qOn)}>{qOn ? <Check size={13} /> : null}Questions {qOn ? 'on' : 'off'}</button>
        <button type="button" className={`pm-chip${qOn ? ' on' : ''}`} aria-pressed={qOn} onClick={() => setQOn(!qOn)}>{qOn ? <Check size={13} /> : null}Reactions {qOn ? 'on' : 'off'}</button>
      </div>
    </div>, document.body);
}

export function PresentStart({ mode, setMode, qOn, setQOn, notesOn, setNotesOn, count, title = '', onStart, onCancel }) {
  const host = useHost();
  const [full, setFull] = useState(() => lsGet('peblo-present-fs', '1') === '1');
  const [left, setLeft] = useState(0); // countdown seconds, 0 = not counting
  const lines = useMemo(previewOf, []);
  const instant = lsGet('peblo-present-instant', '0') === '1';
  const timer = useRef(null);
  const begin = () => { clearInterval(timer.current); lsSet('peblo-present-fs', full ? '1' : '0'); if (full) { try { document.documentElement.requestFullscreen?.().catch(() => {}); } catch { /* not allowed */ } } onStart(); };
  const go = () => {
    if (left > 0 || instant) { begin(); return; } // a second click skips the wait
    setLeft(3);
    timer.current = setInterval(() => setLeft((n) => { if (n <= 1) { clearInterval(timer.current); setTimeout(begin, 0); return 0; } return n - 1; }), 1000);
  };
  useEffect(() => () => clearInterval(timer.current), []);
  useEffect(() => {
    const k = (e) => { if (e.key === 'Escape') { e.stopPropagation(); clearInterval(timer.current); onCancel(); } };
    window.addEventListener('keydown', k, true); return () => window.removeEventListener('keydown', k, true);
  }, [onCancel]);
  const Opt = ({ id, icon, title: t, sub }) => (
    <button type="button" className={`opt${mode === id ? ' on' : ''}`} data-testid={`mode-${id}`} role="radio" aria-checked={mode === id} onClick={() => setMode(id)}>
      {icon}<span><strong>{t}</strong><small>{sub}</small></span>{mode === id && <Check size={16} />}
    </button>
  );
  const Tog = ({ on, set, label, id, kbd }) => (
    <label className="tog-row"><span className="sw-wrap"><input type="checkbox" role="switch" data-testid={id} checked={on} onChange={(e) => set(e.target.checked)} /><span className="sw" /></span><span className="tl">{label}</span>{kbd && <kbd>{kbd}</kbd>}</label>
  );
  const first = lines.find((l) => l.h) || lines[0];
  return createPortal(
    <div className="pb-pback" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) { clearInterval(timer.current); onCancel(); } }}>
      <div className="pb-pstart" role="dialog" aria-label="Ready to present" data-testid="present-start">
        <div className="ps-side">
          <h3>Ready to present?</h3>
          <p className="ps-sub">{title || 'This note'} · <span data-testid="ps-count">{count} {count === 1 ? 'person' : 'people'}</span> here</p>
          <div role="radiogroup" aria-label="How the room follows" className="ps-opts">
            <Opt id="follow" icon={<Users size={18} />} title="Follow me" sub="Everyone scrolls with you" />
            <Opt id="tour" icon={<Route size={18} />} title="Guided tour" sub="Next steps through headings" />
            <Opt id="point" icon={<Eye size={18} />} title="Point only" sub="Pointer shows, free reading" />
          </div>
          <Tog on={full} set={setFull} label="Go full screen" id="opt-full" kbd="F11" />
          <Tog on={qOn} set={setQOn} label="Questions and reactions" id="opt-q" />
          <Tog on={notesOn} set={setNotesOn} label="Edit notes while presenting" id="opt-notes" />
          <button type="button" className="go big" data-testid="present-go" onClick={go}><Play size={16} />{left > 0 ? `Starting in ${left}. Click to start now` : instant ? 'Start' : 'Start in 3 seconds'}</button>
          <button type="button" className="ghost" data-testid="present-cancel" onClick={() => { clearInterval(timer.current); onCancel(); }}>Cancel</button>
        </div>
        <div className="ps-pv">
          <div className="ps-pt"><Maximize2 size={15} />What the room sees, full screen<span className="chip">16:9</span></div>
          <div className="ps-frame" data-testid="ps-frame">
            {left > 0 && <span className="ps-count" aria-live="polite">{left}</span>}
            {lines.length ? lines.slice(0, 5).map((l, i) => (l === first && l.h ? <h1 key={i}>{l.text}</h1> : l.h ? <h2 key={i}>{l.text}</h2> : <p key={i}>{l.text.length > 110 ? `${l.text.slice(0, 107)}…` : l.text}</p>)) : <h1>{title || 'Your note'}</h1>}
          </div>
          <div className="ps-dock" aria-hidden="true"><span><Eye size={15} /></span><span><Pencil size={15} /></span><span><Highlighter size={15} /></span><i /><span><Timer size={15} />00:00</span><span className="acc"><X size={14} />End</span></div>
          <div className="ps-note">Your control bar stays on top of the full screen. Esc or End leaves.</div>
        </div>
      </div>
    </div>,
    host,
  );
}

/**
 * The presenter's dock and its side panel.
 * `state` is kept by the parent (it must survive the panel closing); this component owns the notes, timer and tour.
 */

/* ---- The notes drawer (mockup P3d): a queue of notes to present through ---- */
const QKEY = 'peblo-present-queue';
export const RESUME_KEY = 'peblo-present-resume';
export const FOLLOW_KEY = 'peblo-follow-resume';
const hereNote = () => {
  const p = window.location.pathname;
  let m = p.match(/^\/notes\/([^/?#]+)/); if (m) return { id: m[1] };
  m = p.match(/^\/s\/note\/([^/?#]+)/); return m ? { tok: m[1] } : {};
};
export const gotoPath = (path) => { window.history.pushState({}, '', path); window.dispatchEvent(new PopStateEvent('popstate')); };
const whenShort = (t) => {
  const d = new Date(t); const days = Math.floor((Date.now() - +d) / 864e5);
  if (days < 1) return 'today'; if (days < 2) return 'Yesterday'; if (days < 7) return d.toLocaleDateString(undefined, { weekday: 'short' });
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};
function useNoteQueue() {
  const [all, setAll] = useState(null); // null until the owner's notes load (a guest never gets them)
  const [ids, setIds] = useState(() => { try { const v = JSON.parse(localStorage.getItem(QKEY) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } });
  useEffect(() => {
    let off = false;
    (async () => {
      try {
        const [n, s] = await Promise.all([api.get('/notes', { params: { limit: 80 } }), api.get('/share').catch(() => ({ data: { links: [] } }))]);
        const toks = new Map(((s.data && s.data.links) || []).filter((l) => l.kind === 'note').map((l) => [l.id, l.token]));
        const rows = (n.data && n.data.notes) || n.data || [];
        if (!off && Array.isArray(rows)) setAll(rows.map((x) => ({ id: x.id, title: x.title || 'Untitled', updatedAt: x.updatedAt, token: toks.get(x.id) || null })));
      } catch { /* not the owner: no drawer */ }
    })();
    return () => { off = true; };
  }, []);
  const here = hereNote();
  const byId = new Map((all || []).map((n) => [n.id, n]));
  const cur = (all || []).find((n) => n.id === here.id || (here.tok && n.token === here.tok)) || null;
  let order = ids.filter((id) => byId.has(id));
  if (cur && !order.includes(cur.id)) order = [cur.id, ...order];
  const save = (next) => { setIds(next); try { localStorage.setItem(QKEY, JSON.stringify(next)); } catch { /* not kept */ } };
  return { all, byId, cur, order, save };
}

function QueueDrawer({ q, keepRoom, setKeepRoom, onGo, onClose }) {
  const [find, setFind] = useState('');
  const [over, setOver] = useState(null);
  const dragId = useRef(null);
  const term = find.trim().toLowerCase();
  const hit = (n) => !term || n.title.toLowerCase().includes(term);
  const rows = q.order.map((id) => q.byId.get(id)).filter(Boolean);
  const more = q.all.filter((n) => !q.order.includes(n.id) && hit(n)).sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt)).slice(0, term ? 8 : 5);
  const move = (id, to) => {
    const from = q.order.indexOf(id); if (from < 0 || to < 0 || to >= q.order.length || from === to) return;
    const next = q.order.slice(); next.splice(from, 1); next.splice(to, 0, id); q.save(next);
  };
  const add = (n) => q.save([...q.order, n.id]);
  const chipOf = (n) => (n.id === q.cur?.id ? <span className="qd-chip ok">Live</span> : n.token ? <span className="qd-chip pub" title="Everyone on the link can follow you to this note">Public</span> : <span className="qd-chip priv" title="Only you see this note: the room cannot follow you into it yet">Private</span>);
  return (
    <aside className="pb-qd" role="complementary" aria-label="Notes to present" data-testid="queue-drawer">
      <h3><Layers size={18} />Notes to present<button type="button" className="qd-x" aria-label="Close" data-testid="queue-close" onClick={onClose}><X size={16} /></button></h3>
      <label className="qd-srch"><Search size={15} /><input data-testid="queue-search" value={find} onChange={(e) => setFind(e.target.value)} placeholder="Jump to a note" aria-label="Jump to a note"
        onKeyDown={(e) => { if (e.key === 'Enter') { const n = rows.filter(hit)[0] || more[0]; if (n) { if (!q.order.includes(n.id)) add(n); onGo(n); } } }} /></label>
      <div className="qd-list">
        <div className="qd-note"><Link2 size={13} /> Link A follows the note you are on. Private notes show only while you present.</div>
        <div className="qd-lab">Up next, drag to reorder</div>
        {rows.filter(hit).map((n, i) => (
          <div key={n.id} className={`qd-n${n.id === q.cur?.id ? ' on' : ''}${over === n.id ? ' over' : ''}`} data-testid="queue-row" draggable
            onDragStart={() => { dragId.current = n.id; }} onDragOver={(e) => { e.preventDefault(); setOver(n.id); }} onDragLeave={() => setOver(null)}
            onDrop={(e) => { e.preventDefault(); setOver(null); if (dragId.current && dragId.current !== n.id) move(dragId.current, q.order.indexOf(n.id)); dragId.current = null; }}>
            <button type="button" className="qd-go" onClick={() => onGo(n)} title={n.id === q.cur?.id ? 'Presenting now' : 'Present this note'}>
              <span className="no">{q.order.indexOf(n.id) + 1}</span>
              <span className="tx"><b>{n.title}</b><small>{n.id === q.cur?.id ? 'Presenting now' : `Edited ${whenShort(n.updatedAt)}`}</small></span>
            </button>
            {chipOf(n)}
            <button type="button" className="qd-grip" aria-label={`Move ${n.title}. Arrow keys reorder`} data-testid="queue-grip" onKeyDown={(e) => { if (e.key === 'ArrowUp') { e.preventDefault(); move(n.id, q.order.indexOf(n.id) - 1); } if (e.key === 'ArrowDown') { e.preventDefault(); move(n.id, q.order.indexOf(n.id) + 1); } }}><GripVertical size={16} /></button>
          </div>
        ))}
        <div className="qd-lab">{term ? 'Results' : 'Recent'}</div>
        {more.length === 0 && <p className="qd-empty">{term ? 'No note matches.' : 'Nothing else yet.'}</p>}
        {more.map((n) => (
          <button type="button" key={n.id} className="qd-n qd-add" data-testid="queue-recent" onClick={() => add(n)} title="Add to the queue">
            <span className="no"><Plus size={13} /></span><span className="tx"><b>{n.title}</b><small>{whenShort(n.updatedAt)}</small></span>
          </button>
        ))}
      </div>
      <div className="qd-foot"><kbd>N</kbd>next note<kbd>P</kbd>previous
        <label className="qd-sw" title="Keep the room following"><input type="checkbox" role="switch" data-testid="queue-keep" checked={keepRoom} onChange={(e) => setKeepRoom(e.target.checked)} /><span className="sw" /><span className="sr">Keep the room following</span></label></div>
    </aside>
  );
}

const defaultRail = () => typeof window !== 'undefined' && window.innerWidth > 720; // side rail on wide screens, bottom bar on phones
export function PresenterKit({ aw, me, peers, mode, qOn, notesOn, laser, setLaser, spot, setSpot, getAnchor, goToBlock, onEnd, startedAt, startPanel }) {
  const host = useHost();
  const [panel, setPanel] = useState(startPanel || null); // 'room' | 'notes' | 'q' | 'tour' | 'queue'
  const q = useNoteQueue();
  const [keepRoom, setKeepRoomS] = useState(() => { try { return localStorage.getItem('peblo-present-keep') !== '0'; } catch { return true; } });
  const setKeepRoom = (v) => { setKeepRoomS(v); try { localStorage.setItem('peblo-present-keep', v ? '1' : '0'); } catch { /* not kept */ } };
  // the dock can be dragged anywhere, snaps to the screen edges (vertical on the left and right), and folds down to a small pill
  const dockRef = useRef(null);
  const [dock, setDock] = useState(() => { try { const d = JSON.parse(localStorage.getItem('peblo-dock') || 'null'); return d && typeof d.x === 'number' ? d : { x: null, y: null, v: defaultRail(), c: false }; } catch { return { x: null, y: null, v: defaultRail(), c: false }; } });
  const saveDock = (d) => { setDock(d); try { localStorage.setItem('peblo-dock', JSON.stringify(d)); } catch { /* not kept */ } };
  const dragging = useRef(null);
  const fit = (d) => {
    const el = dockRef.current; if (!el || d.x === null) return d;
    const r = el.getBoundingClientRect();
    return { ...d, x: Math.min(Math.max(8, d.x), Math.max(8, window.innerWidth - r.width - 8)), y: Math.min(Math.max(8, d.y), Math.max(8, window.innerHeight - r.height - 8)) };
  };
  useEffect(() => { const f = () => setDock((d) => fit(d)); window.addEventListener('resize', f); return () => window.removeEventListener('resize', f); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const gripDown = (e) => {
    if (e.button !== 0) return;
    const el = dockRef.current; if (!el) return;
    const r = el.getBoundingClientRect();
    dragging.current = { dx: e.clientX - r.left, dy: e.clientY - r.top, moved: false };
    e.currentTarget.setPointerCapture?.(e.pointerId);
    e.preventDefault();
  };
  const gripMove = (e) => {
    const g = dragging.current; if (!g) return;
    g.moved = true;
    setDock((d) => fit({ ...d, x: e.clientX - g.dx, y: e.clientY - g.dy }));
  };
  const gripUp = (e) => {
    const g = dragging.current; dragging.current = null;
    if (!g?.moved) return;
    const el = dockRef.current; if (!el) return;
    const r = el.getBoundingClientRect(); const EDGE = 28;
    const px = e?.clientX ?? r.left; // the side edges are judged by where the pointer was let go, so a wide toolbar is not turned on its side just by being clamped
    const side = px < EDGE + 20 || window.innerWidth - px < EDGE + 20;
    let { x, y, v } = { x: r.left, y: r.top, v: side ? true : false };
    saveDock({ ...dock, x, y, v });
    requestAnimationFrame(() => {
      const el2 = dockRef.current; if (!el2) return;
      const r2 = el2.getBoundingClientRect(); let nx = r2.left; let ny = r2.top;
      if (side) { if (px < window.innerWidth / 2) nx = 12; else nx = window.innerWidth - r2.width - 12; }
      if (ny < EDGE) ny = 12; else if (window.innerHeight - (ny + r2.height) < EDGE) ny = window.innerHeight - r2.height - 12;
      saveDock(fit({ ...dock, x: nx, y: ny, v }));
    });
  };
  const resetDock = () => saveDock({ x: null, y: null, v: defaultRail(), c: dock.c });
  const onRight = dock.x !== null && dock.v && dock.x > window.innerWidth / 2;
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
  const t0 = useRef(startedAt || Date.now());
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

  const goNote = (n) => {
    if (!n || n.id === q.cur?.id) return;
    try { sessionStorage.setItem(RESUME_KEY, JSON.stringify({ t: Date.now(), mode, qOn, notesOn, t0: t0.current, drawer: panel === 'queue' })); } catch { /* private mode */ }
    const room = keepRoom && n.token;
    if (room) { try { aw.setLocalStateField('next', n.token); } catch { /* gone */ } }
    setTimeout(() => gotoPath('/notes/' + n.id), room ? 450 : 0);
  };
  const stepNote = (d) => { const i = q.order.indexOf(q.cur?.id); const id = q.order[i + d]; if (i >= 0 && id) goNote(q.byId.get(id)); };
  useEffect(() => {
    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey || typingTarget(e.target)) return;
      const k = e.key.toLowerCase();
      if (panel === 'queue' && q.order.length > 1 && (k === 'n' || k === 'p')) { stepNote(k === 'n' ? 1 : -1); return; }
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
    <button type="button" className={`pd-t pd-b${on ? ' on' : ''}`} data-testid={tid} aria-pressed={on} title={hint || label} data-tip={hint || label} onClick={onClick}>{icon}<span>{label}</span>{badge > 0 && <i className="pd-n">{badge}</i>}</button>
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
      {panel === 'queue' && q.all && <QueueDrawer q={q} keepRoom={keepRoom} setKeepRoom={setKeepRoom} onGo={goNote} onClose={() => setPanel(null)} />}
      {panel && panel !== 'queue' && (
        <aside className="pb-ppanel" style={onRight ? { right: 88 } : undefined} data-testid={`panel-${panel}`} aria-label="Presenter panel">
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
      <div ref={dockRef} className={`pb-pdock${dock.v ? ' v' : ''}${dock.c ? ' c' : ''}${dock.x !== null ? ' free' : ''}`} style={dock.x !== null ? { left: dock.x, top: dock.y, bottom: 'auto', transform: 'none' } : undefined} role="toolbar" aria-label="Presenter tools" data-testid="presenting-banner">
        <button type="button" className="pd-grip" data-testid="dock-grip" aria-label="Drag the toolbar. Double-click to put it back" title="Drag to move. Double-click to reset" onPointerDown={gripDown} onPointerMove={gripMove} onPointerUp={gripUp} onPointerCancel={gripUp} onDoubleClick={resetDock}><GripVertical size={16} /></button>
        <span className="pd-pill" title={`${following} following`}><Presentation size={14} />{dock.v ? <>{mmss(elapsed)}<span className="pd-sr">{` · ${following} following`}</span></> : `Presenting · ${mmss(elapsed)} · ${following} following`}</span>
        <button type="button" className="pd-b pd-fold" data-testid="dock-fold" aria-label={dock.c ? 'Show all tools' : 'Fold the toolbar'} title={dock.c ? 'Show all tools' : 'Fold the toolbar'} onClick={() => saveDock({ ...dock, c: !dock.c })}>{dock.c ? <Maximize2 size={15} /> : <Minimize2 size={15} />}</button>
        <span className="pd-sep" />
        <button type="button" className={`pd-t pd-b${laser ? ' on' : ''}`} aria-pressed={laser} data-testid="tool-laser" title="Laser pointer: your pointer shows as a red dot" onClick={() => setLaser((v) => !v)}><Ic name="laser" size={16} /><span>Laser</span></button>
        <button type="button" className={`pd-t pd-b${spot ? ' on' : ''}`} aria-pressed={spot} data-testid="tool-spot" title="Spotlight: dim everything except the block you point at" onClick={() => setSpot((v) => !v)}><Ic name="spotlight" size={16} /><span>Spotlight</span></button>
        <span className="pd-t pd-hint" title="Alt + click anywhere in the note to ping that spot for everyone"><Ic name="ping" size={15} />Alt+click</span>
        <span className="pd-t pd-sep" />
        {reactSum > 0 && <span className="pd-t pd-react" data-testid="react-counts" title="Reactions from the room"><ThumbsUp size={13} />{reactTotals.up}<Lightbulb size={13} />{reactTotals.idea}<Heart size={13} />{reactTotals.heart}</span>}
        <Btn tid="dock-poll" icon={<ListChecks size={16} />} label="Poll" on={panel === 'poll'} onClick={() => setPanel((p) => (p === 'poll' ? null : 'poll'))} badge={poll && poll.open ? votes.length : 0} hint="Poll (P)" />
        <Btn tid="dock-room" icon={<Users size={16} />} label="Audience" on={panel === 'room'} onClick={() => setPanel((p) => (p === 'room' ? null : 'room'))} badge={0} />
        {q.all && q.order.length > 0 && <Btn tid="dock-queue" icon={<Layers size={16} />} label={`Notes ${Math.max(0, q.order.indexOf(q.cur?.id)) + 1} of ${q.order.length}`} on={panel === 'queue'} onClick={() => setPanel((p) => (p === 'queue' ? null : 'queue'))} hint={`Notes ${Math.max(0, q.order.indexOf(q.cur?.id)) + 1} of ${q.order.length}`} />}
        {notesOn && <Btn tid="dock-notes" icon={<StickyNote size={16} />} label="My notes" on={panel === 'notes'} onClick={() => setPanel((p) => (p === 'notes' ? null : 'notes'))} hint="Notes (N)" />}
        {qOn && <Btn tid="dock-q" icon={<CircleHelp size={16} />} label="Questions" on={panel === 'q'} onClick={() => setPanel((p) => (p === 'q' ? null : 'q'))} badge={open.length + hands.length} hint="Questions (Q)" />}
        {mode === 'tour' && <Btn tid="dock-tour" icon={<Route size={16} />} label={stops.length ? `Stop ${Math.max(0, stopI) + 1} of ${stops.length}` : 'Tour'} on={panel === 'tour'} onClick={() => setPanel((p) => (p === 'tour' ? null : 'tour'))} hint="Tour (T)" />}
        {stops.length > 0 && <button type="button" className="pd-t pd-b" data-testid="next-stop" title="Next stop (Space)" onClick={nextStop}><SkipForward size={16} /><span>Next</span></button>}
        <span className="pd-t pd-sep" />
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
  const [saved, setSaved] = useState('');
  const saveNote = async () => {
    setSaved('busy');
    try {
      const md = `${recapMarkdown(recap)}\n## Private notes\n${recap.notes.length ? recap.notes.map((n) => `- ${n.t}`).join('\n') : '- none'}\n`;
      const { data } = await api.post('/notes', { title: `Session recap, ${new Date().toLocaleDateString()}`, content: md, tags: [] });
      setSaved(data?.note?.id || 'done');
    } catch { setSaved('fail'); }
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
        <div className="row">{onSend && <button type="button" onClick={send} disabled={sent} data-testid="recap-send"><Send size={15} />{sent ? 'Sent to everyone' : 'Send to everyone'}</button>}{getToken() && <button type="button" onClick={saveNote} disabled={saved === 'busy' || (saved !== '' && saved !== 'fail')} data-testid="recap-save"><StickyNote size={15} />{saved === 'busy' ? 'Saving' : saved === 'fail' ? 'Try again' : saved ? 'Saved to your notes' : 'Save as a note'}</button>}<button type="button" onClick={download} data-testid="recap-download"><Download size={15} />Download notes</button><button type="button" className="go" data-testid="recap-done" onClick={onClose}>Done</button></div>
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
.pb-pback { pointer-events: auto; position: fixed; inset: 0; z-index: 1210; display: grid; place-items: center; padding: 16px; background: rgba(58, 42, 26, .42); }
.pb-pstart { width: min(1060px, 100%); max-height: calc(100dvh - 32px); display: grid; grid-template-columns: 360px minmax(0, 1fr); overflow: hidden; border-radius: 34px; background: #fff; color: #241f1a; box-shadow: 0 30px 70px rgba(60, 40, 20, .35); font: 500 13px 'Figtree', system-ui, sans-serif; text-align: left; }
.pb-pstart .ps-side { padding: 28px; display: grid; gap: 14px; align-content: start; border-right: 1px solid #eadfd0; overflow-y: auto; }
.pb-pstart h3 { margin: 0; font: 800 26px/1.1 'Bricolage Grotesque', 'Figtree', system-ui, sans-serif; }
.pb-pstart .ps-sub { margin: 0; color: #564d43; font-size: 14px; }
.pb-pstart .ps-opts { display: grid; gap: 14px; }
.pb-pstart .opt { display: flex; align-items: center; gap: 12px; width: 100%; padding: 12px; border: 1.5px solid #eadfd0; border-radius: 18px; background: transparent; color: inherit; text-align: left; font: 700 14px 'Figtree', system-ui, sans-serif; cursor: pointer; }
.pb-pstart .opt.on { border-color: #241f1a; background: #ffe9a6; }
.pb-pstart .opt span { flex: 1; display: grid; }
.pb-pstart .opt small { color: #564d43; font-weight: 500; font-size: 12px; }
.pb-pstart .tog-row { display: flex; align-items: center; gap: 10px; font-weight: 700; font-size: 14px; cursor: pointer; }
.pb-pstart .tog-row .tl { flex: 1; } .pb-pstart kbd { padding: 2px 8px; border: 1px solid #eadfd0; border-radius: 8px; background: #f4eee5; font: 700 11px inherit; }
.pb-pstart .sw-wrap { position: relative; display: inline-flex; } .pb-pstart .sw-wrap input { position: absolute; opacity: 0; inset: 0; width: 100%; height: 100%; margin: 0; cursor: pointer; }
.pb-pstart .sw { width: 36px; height: 21px; border-radius: 999px; background: #d9cdbb; position: relative; transition: background .15s; }
.pb-pstart .sw::after { content: ''; position: absolute; top: 2px; left: 2px; width: 17px; height: 17px; border-radius: 50%; background: #fff; box-shadow: 0 1px 3px rgba(0,0,0,.3); transition: left .15s; }
.pb-pstart input:checked + .sw { background: #241f1a; } .pb-pstart input:checked + .sw::after { left: 17px; }
.pb-pstart input:focus-visible + .sw { outline: 2px solid #c4441c; outline-offset: 2px; }
.pb-pstart button.go.big { display: inline-flex; align-items: center; justify-content: center; gap: 8px; height: 48px; margin-top: 6px; border: 0; border-radius: 999px; font: 800 15px 'Figtree', system-ui, sans-serif; cursor: pointer; background: #c4441c !important; color: #fff !important; }
.pb-pstart button.ghost { height: 34px; border: 0; border-radius: 999px; background: transparent; font: 700 13px 'Figtree', system-ui, sans-serif; color: #564d43; cursor: pointer; }
.pb-pstart .ps-pv { background: #2b2420; padding: 28px; display: grid; grid-template-rows: auto minmax(0, 1fr) auto auto; gap: 16px; color: #e8e0d6; min-width: 0; }
.pb-pstart .ps-pt { display: flex; align-items: center; gap: 10px; font-weight: 700; } .pb-pstart .ps-pt .chip { margin-left: auto; padding: 2px 10px; border-radius: 999px; background: rgba(255,255,255,.12); color: #fff; font-size: 12px; }
.pb-pstart .ps-frame { position: relative; overflow: hidden; min-height: 180px; padding: 22px 30px; border-radius: 14px; background: #fbf6ee; color: #241f1a; box-shadow: 0 20px 50px rgba(0,0,0,.4); }
.pb-pstart .ps-frame h1 { margin: 0; font: 800 34px/1.1 'Bricolage Grotesque', 'Figtree', system-ui, sans-serif; } .pb-pstart .ps-frame h2 { margin: 18px 0 6px; font-size: 20px; } .pb-pstart .ps-frame p { margin: 8px 0 0; font-size: 14px; color: #564d43; }
.pb-pstart .ps-count { position: absolute; right: 16px; top: 14px; width: 52px; height: 52px; border-radius: 50%; display: grid; place-items: center; background: #c4441c; color: #fff; font: 800 24px 'Bricolage Grotesque', 'Figtree', sans-serif; }
.pb-pstart .ps-dock { justify-self: center; display: inline-flex; align-items: center; gap: 6px; padding: 6px; border-radius: 999px; background: #17120f; }
.pb-pstart .ps-dock span { display: inline-flex; align-items: center; gap: 5px; height: 30px; padding: 0 10px; border-radius: 999px; color: #fff; font-weight: 700; font-size: 12px; } .pb-pstart .ps-dock span.acc { background: #c4441c; } .pb-pstart .ps-dock i { width: 1px; height: 18px; background: rgba(255,255,255,.25); }
.pb-pstart .ps-note { text-align: center; font-size: 12.5px; color: #bdb1a4; }
@media (max-width: 800px) { .pb-pstart { grid-template-columns: 1fr; overflow-y: auto; } .pb-pstart .ps-pv { display: none; } }
.pb-pstart hr, .pb-ppanel hr, .pb-recap hr { border: 0; border-top: 1px solid rgba(120,100,160,.2); margin: 8px 0; }
.pb-recap .row { display: flex; gap: 10px; margin-top: 10px; }
.pb-recap .row button { display: inline-flex; align-items: center; gap: 7px; border: 1px solid #ddd3f0; border-radius: 999px; padding: 9px 16px; background: #fff; font: 700 13px 'Figtree', system-ui, sans-serif; cursor: pointer; color: inherit; }
.pb-pstart .go, .pb-recap .go, .pb-ppanel .go { background: #7c3aed !important; border-color: #7c3aed !important; color: #fff !important; }
.pb-pdock { position: fixed; left: 50%; bottom: 16px; transform: translateX(-50%); z-index: 1160; display: flex; align-items: center; gap: 4px; max-width: calc(100vw - 20px); overflow-x: auto; padding: 6px; border-radius: 999px; background: #2b1458; color: #f3ecff; box-shadow: 0 16px 44px rgba(30,10,70,.5); font: 700 13px 'Figtree', system-ui, sans-serif; }
.pb-pdock .pd-pill { display: inline-flex; align-items: center; gap: 7px; padding: 8px 12px; border-radius: 999px; background: #7c3aed; color: #fff; white-space: nowrap; }
.pb-pdock .pd-sep { width: 1px; align-self: stretch; margin: 6px 4px; background: rgba(255,255,255,.18); }
.pb-pdock .pd-hint { display: inline-flex; align-items: center; gap: 5px; padding: 0 8px; font-size: 11px; opacity: .8; white-space: nowrap; }
.pb-pdock .pd-b { position: relative; display: inline-flex; align-items: center; gap: 6px; border: 0; border-radius: 999px; padding: 8px 12px; background: transparent; color: inherit; font: inherit; cursor: pointer; white-space: nowrap; }
.pb-pdock .pd-b:hover { background: rgba(255,255,255,.12); }
.pb-pdock .pd-b.on { background: #fff; color: #5b21b6; }
.pb-pdock { touch-action: none; }
.pb-pdock .pd-grip { display: inline-grid; place-items: center; width: 26px; height: 34px; border: 0; border-radius: 999px; background: transparent; color: rgba(255,255,255,.65); cursor: grab; flex: none; padding: 0; }
.pb-pdock .pd-grip:hover { background: rgba(255,255,255,.12); color: #fff; }
.pb-pdock .pd-grip:active { cursor: grabbing; }
.pb-pdock.free { transition: none; }
.pb-pdock.c .pd-t { display: none; }
.pb-pdock.v { flex-direction: column; align-items: stretch; border-radius: 26px; max-height: calc(100vh - 24px); overflow-y: auto; overflow-x: hidden; width: 68px; }
.pb-pdock.v .pd-sep { width: auto; height: 1px; margin: 4px 8px; align-self: auto; }
.pb-pdock.v .pd-b { flex-direction: column; gap: 2px; padding: 8px 4px; border-radius: 14px; font-size: 10.5px; justify-content: center; }
.pb-pdock.v .pd-pill { flex-direction: column; gap: 2px; padding: 8px 4px; border-radius: 16px; font-size: 11px; justify-content: center; }
.pb-pdock.v .pd-grip { width: 100%; height: 26px; }
.pb-pdock.v .pd-hint, .pb-pdock.v .pd-react { display: none; }
.pb-pdock.v .pd-n { position: absolute; top: 2px; right: 6px; }
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
@media (max-width: 640px) { .pb-aud-wrap { left: 12px !important; right: 12px !important; bottom: calc(92px + env(safe-area-inset-bottom, 0px)) !important; } .pb-aud > button, .pb-aud .pb-reacts > button { min-height: 40px; min-width: 40px; padding: 8px 14px; justify-content: center; } .pb-aud .pb-reacts { display: inline-flex; gap: 6px; } }
.pb-rx { position: fixed; left: 50%; top: 70px; transform: translateX(-50%); z-index: 1200; width: min(360px, calc(100vw - 24px)); display: grid; gap: 4px; padding: 16px 18px; border-radius: 18px; background: #2b1458; color: #fff; box-shadow: 0 14px 40px rgba(30,10,70,.45); font: 600 14px 'Figtree', system-ui, sans-serif; }
.pb-rx small { opacity: .75; font-size: 11px; letter-spacing: .04em; text-transform: uppercase; } .pb-rx p { margin: 0; opacity: .85; font-weight: 500; }
.pb-rx .rx-x { position: absolute; top: 8px; right: 8px; border: 0; background: transparent; color: inherit; cursor: pointer; opacity: .8; }
.pb-rx .rx-go { justify-self: start; display: inline-flex; align-items: center; gap: 6px; margin-top: 6px; border: 0; border-radius: 999px; padding: 8px 14px; background: #fff; color: #2b1458; font: 700 13px 'Figtree', system-ui, sans-serif; cursor: pointer; }
.pb-recap .row button:disabled { opacity: .6; cursor: default; }

/* The presenting control bar in the Soft look (mockups P2a, P2b): dark bar, butter for what is on, accent for End; default is the side rail */
.pb-pdock { background: #241f1a; color: #e8e0d6; box-shadow: 0 18px 40px rgba(0, 0, 0, .35); }
.pb-pdock .pd-pill { background: transparent; color: #bdb1a4; padding: 2px 4px; font-weight: 700; font-size: 11px; }
.pb-pdock .pd-b.on { background: #ffe9a6; color: #241f1a; }
.pb-pdock .pd-b.end { background: #c4441c; color: #fff; }
.pb-pdock .pd-n { background: #c4441c; color: #fff; }
.pb-pdock .pd-b:hover { background: rgba(255, 255, 255, .14); } .pb-pdock .pd-b.on:hover { background: #ffe9a6; }
.pb-pdock.v:not(.free) { left: 22px; top: 50%; bottom: auto; transform: translateY(-50%); }
.pb-pdock.v { width: 62px; padding: 8px; gap: 4px; border-radius: 999px; overflow: visible; max-height: none; align-items: center; }
.pb-pdock.v .pd-b { width: 46px; height: 46px; padding: 0; border-radius: 50%; justify-content: center; font-size: 0; }
.pb-pdock.v .pd-b > span:not(.pd-n) { display: none; }
.pb-pdock.v .pd-b.end { margin-top: 4px; }
.pb-pdock.v .pd-b svg { width: 20px; height: 20px; }
.pb-pdock.v .pd-pill { width: auto; padding: 2px 0; }
.pb-pdock.v .pd-pill svg { display: none; }
.pb-pdock .pd-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.pb-pdock.v .pd-sep { width: 22px; height: 1px; margin: 3px 0; }
.pb-pdock.v .pd-grip { width: 46px; height: 22px; }
.pb-pdock .pd-b[data-tip]:hover::after { content: attr(data-tip); position: absolute; z-index: 5; white-space: nowrap; background: #241f1a; color: #fff; border-radius: 12px; padding: 7px 12px; font: 700 13px 'Figtree', system-ui, sans-serif; box-shadow: 0 8px 20px rgba(0, 0, 0, .3); }
.pb-pdock.v .pd-b[data-tip]:hover::after { left: calc(100% + 14px); top: 50%; transform: translateY(-50%); }

.pb-pmenu .pm-decks { display: grid; gap: 2px; padding: 0 6px 6px 54px; } .pb-pmenu .pm-deck { display: flex; align-items: center; gap: 8px; height: 34px; padding: 0 10px; border: 0; border-radius: 10px; background: transparent; font: 700 13px inherit; color: inherit; cursor: pointer; text-align: left; } .pb-pmenu .pm-deck:hover { background: #f4ede0; } .pb-pmenu .pm-deck span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pb-pmenu { position: fixed; z-index: 1300; width: min(380px, calc(100vw - 24px)); background: #fffdf8; color: #241f1a; border: 1.5px solid #e6dccb; border-radius: 22px; padding: 8px; box-shadow: 0 24px 60px rgba(36, 31, 26, .25); font: 500 14px 'Figtree', system-ui, sans-serif; }
.pm-row { display: flex; align-items: center; gap: 12px; width: 100%; text-align: left; padding: 11px 12px; border: 0; border-radius: 16px; background: transparent; color: inherit; cursor: pointer; font: inherit; }
.pm-row:hover:not(:disabled) { background: #f4ede0; }
.pm-row.hot { background: #fde3d6; } .pm-row.hot:hover { background: #fbd6c4; }
.pm-row:disabled { opacity: .5; cursor: not-allowed; }
.pm-ic { width: 38px; height: 38px; border-radius: 12px; background: #f4ede0; display: grid; place-items: center; flex: none; } .pm-row.hot .pm-ic { background: #c4441c; color: #fff; }
.pm-tx { display: flex; flex-direction: column; min-width: 0; flex: 1; } .pm-tx b { font-weight: 800; font-size: 14.5px; } .pm-tx small { color: #6f6557; font-size: 12.5px; margin-top: 1px; }
.pm-row kbd { font: 700 11px 'Figtree', system-ui, sans-serif; background: #fffdf8; border: 1.5px solid #e6dccb; border-radius: 8px; padding: 3px 7px; color: #6f6557; white-space: nowrap; }
.pm-foot { display: flex; align-items: center; gap: 8px; padding: 10px 8px 4px; border-top: 1.5px dashed #e6dccb; margin-top: 6px; flex-wrap: wrap; }
.pm-opt { border: 0; background: transparent; font: 800 13px 'Figtree', system-ui, sans-serif; color: #241f1a; cursor: pointer; padding: 6px 8px; border-radius: 10px; margin-right: auto; } .pm-opt:hover { background: #f4ede0; }
.pm-chip { display: inline-flex; align-items: center; gap: 4px; border: 1.5px solid #e6dccb; background: #fffdf8; color: #6f6557; font: 700 12px 'Figtree', system-ui, sans-serif; padding: 5px 10px; border-radius: 999px; cursor: pointer; } .pm-chip.on { background: #ffe9a6; border-color: #ecd079; color: #241f1a; }

.pb-qd { position: fixed; right: 16px; top: 16px; bottom: 16px; width: min(310px, calc(100vw - 24px)); z-index: 1160; display: grid; grid-template-rows: auto auto 1fr auto; gap: 12px; padding: 18px; background: #fffdf8; color: #241f1a; border: 1px solid #e6dccb; border-radius: 28px; box-shadow: 0 24px 60px rgba(36, 31, 26, .22); font: 500 14px 'Figtree', system-ui, sans-serif; }
.pb-qd h3 { margin: 0; font: 800 20px 'Bricolage Grotesque', 'Figtree', system-ui, sans-serif; display: flex; align-items: center; gap: 8px; }
.qd-x { margin-left: auto; width: 32px; height: 32px; border: 0; border-radius: 50%; background: transparent; color: inherit; cursor: pointer; display: grid; place-items: center; } .qd-x:hover { background: #f4ede0; }
.qd-srch { display: flex; align-items: center; gap: 8px; height: 40px; padding: 0 14px; border: 1px solid #e6dccb; border-radius: 999px; color: #8a7f70; background: #fff; }
.qd-srch input { flex: 1; min-width: 0; border: 0; outline: 0; background: transparent; font: inherit; color: #241f1a; }
.qd-list { display: grid; gap: 6px; align-content: start; overflow: auto; min-height: 0; }
.qd-note { display: flex; gap: 6px; align-items: flex-start; background: #dff3e4; padding: 7px 12px; border-radius: 12px; font-size: 12px; font-weight: 600; } .qd-note svg { flex: none; margin-top: 2px; }
.qd-lab { padding: 6px 4px 0; font: 800 11px 'Figtree', system-ui, sans-serif; letter-spacing: .06em; text-transform: uppercase; color: #8a7f70; }
.qd-empty { margin: 0; padding: 4px 6px; color: #8a7f70; font-size: 12.5px; }
.qd-n { display: flex; align-items: center; gap: 8px; padding: 6px 8px 6px 6px; border-radius: 18px; border: 0; background: transparent; text-align: left; font: inherit; color: inherit; }
.qd-n.on { background: #ffe9a6; } .qd-n.over { outline: 2px dashed #c4441c; outline-offset: -2px; }
.qd-go { display: flex; align-items: center; gap: 10px; flex: 1; min-width: 0; border: 0; background: transparent; font: inherit; color: inherit; text-align: left; cursor: pointer; padding: 4px; border-radius: 14px; }
.qd-add { width: 100%; cursor: pointer; padding: 10px 12px 10px 6px; } .qd-add:hover, .qd-n:not(.on):hover { background: #f4ede0; }
.qd-n .no { width: 22px; height: 22px; border-radius: 8px; background: #f4ede0; display: grid; place-items: center; font-weight: 800; font-size: 12px; flex: none; } .qd-n.on .no { background: #241f1a; color: #fff; }
.qd-n .tx { display: flex; flex-direction: column; min-width: 0; } .qd-n b { font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; } .qd-n small { font-size: 12px; color: #8a7f70; }
.qd-chip { font: 700 11px 'Figtree', system-ui, sans-serif; padding: 3px 8px; border-radius: 999px; background: #f4ede0; flex: none; } .qd-chip.ok { background: #cdeed7; color: #14532d; } .qd-chip.pub { background: #dff3e4; } .qd-chip.priv { background: #ffe9a6; }
.qd-grip { border: 0; background: transparent; color: #8a7f70; cursor: grab; padding: 4px; border-radius: 8px; display: grid; place-items: center; } .qd-grip:focus-visible { outline: 2px solid #c4441c; }
.qd-foot { display: flex; gap: 8px; align-items: center; font-size: 12.5px; color: #6f6557; font-weight: 600; }
.qd-foot kbd { font: 800 11px 'Figtree', system-ui, sans-serif; background: #f4ede0; border: 1.5px solid #e6dccb; border-radius: 7px; padding: 2px 7px; color: #241f1a; } .qd-foot kbd + kbd { margin-left: 6px; }
.qd-sw { margin-left: auto; position: relative; display: inline-flex; cursor: pointer; } .qd-sw input { position: absolute; inset: 0; opacity: 0; cursor: pointer; margin: 0; }
.qd-sw .sw { width: 38px; height: 22px; border-radius: 999px; background: #d9cfbd; position: relative; transition: background .15s; } .qd-sw .sw::after { content: ''; position: absolute; top: 3px; left: 3px; width: 16px; height: 16px; border-radius: 50%; background: #fff; transition: transform .15s; }
.qd-sw input:checked + .sw { background: #c4441c; } .qd-sw input:checked + .sw::after { transform: translateX(16px); } .qd-sw .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
@media (max-width: 640px) { .pb-qd { top: 8px; bottom: 90px; right: 8px; } }
`;


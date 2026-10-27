import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Ic } from '../utils/icons';
import { usePresence } from '../utils/presencePref';
import DeckStage from './DeckPresent';
import { baseOf, extOf } from '../utils/docFiles';
import { AudienceActions, PRESENT_CSS, PresenterKit, PresentStart, PresentMenu, RecapModal, RecapReceived, RoomNotices, useHost, RESUME_KEY, FOLLOW_KEY, gotoPath } from './PresentTools';

/*
 * Who is in this note, drawn from the live document's awareness (temporary, never stored):
 *  - avatars with a typing / away state, click one to follow that person's cursor around the note
 *  - "edited by" on hover, from a small map of block id -> last editor kept in the shared document
 */

// a minute without touching anything counts as away (a test can shorten it with localStorage peblo-idle-ms)
const IDLE_MS = (() => { try { const v = Number(localStorage.getItem('peblo-idle-ms')); return v >= 500 ? v : 60000; } catch { return 60000; } })();
const TYPING_MS = 2500;

const initial = (n) => (String(n || '?').trim()[0] || '?').toUpperCase();
const ago = (t) => {
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 10) return 'just now';
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
};
const keyOf = (p) => `${p.name}|${p.color}`;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/** The element that scrolls the note (the page itself when nothing inside does). */
const scrollerOf = (root) => {
  for (let p = root; p && p !== document.body; p = p.parentElement) {
    const oy = getComputedStyle(p).overflowY;
    if ((oy === 'auto' || oy === 'scroll') && p.scrollHeight > p.clientHeight + 2) return p;
  }
  return document.scrollingElement || document.documentElement;
};
const topOf = (sc) => (sc === document.scrollingElement || sc === document.documentElement ? 0 : sc.getBoundingClientRect().top);

/** Where I am in the note: the block at the top of my screen and how far through it. Sent to others so they can follow my view. */
const anchorOf = (root) => {
  const top = topOf(scrollerOf(root)) + 8;
  let hit = null;
  let first = null;
  root.querySelectorAll('.bn-editor .bn-block-outer').forEach((el) => {
    const r = el.getBoundingClientRect();
    if (!r.height) return;
    if (r.top <= top && top < r.bottom) hit = { el, r };
    else if (!first && r.bottom > top) first = { el, r };
  });
  const h = hit || first;
  if (!h) return null;
  return { b: h.el.getAttribute('data-id'), f: Math.round(clamp((top - h.r.top) / h.r.height, 0, 1) * 1000) / 1000 };
};

/** The people in the note now. The same person in two tabs counts once. */
export function usePeers(rt) {
  const [peers, setPeers] = useState([]);
  useEffect(() => {
    if (!rt) { setPeers([]); return undefined; }
    const aw = rt.provider.awareness;
    const read = () => {
      const byKey = new Map();
      aw.getStates().forEach((st, id) => {
        if (!st?.user) return;
        const p = { id, name: st.user.name || 'Someone', color: st.user.color || '#2563eb', idle: !!st.idle, typingAt: st.typingAt || 0, presenting: !!st.presenting, next: st.next || null, deck: st.deck || null, dp: st.dp || null, mode: st.mode || 'follow', qOn: st.qOn !== false, hand: st.hand || 0, asks: st.asks || [], shown: st.shown || null, called: st.called || null, reacts: st.reacts || null, poll: st.poll || null, vote: st.vote || null, recapMd: st.recapMd || null, answered: st.answered || [], tour: st.tour || null, follows: st.follows || null, view: st.view || null, me: id === aw.clientID };
        const k = keyOf(p);
        const old = byKey.get(k);
        if (!old || (p.me && !old.me) || (old.idle && !p.idle && !old.me)) byKey.set(k, { ...p, me: p.me || !!old?.me });
      });
      const list = [...byKey.values()].sort((a, b) => Number(b.me) - Number(a.me) || a.name.localeCompare(b.name));
      setPeers(list);
    };
    read();
    aw.on('change', read);
    return () => aw.off('change', read);
  }, [rt]);
  return peers;
}

/** A thin map of the whole note on the right edge: where everyone is reading, and where I am. Click a dot to go there. */
function ReadingRail({ root, peers, tick }) {
  const [, bump] = useState(0);
  useEffect(() => {
    let raf = 0;
    const again = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => bump((n) => n + 1)); };
    window.addEventListener('scroll', again, true);
    window.addEventListener('resize', again);
    const t = setInterval(again, 1200);
    return () => { cancelAnimationFrame(raf); clearInterval(t); window.removeEventListener('scroll', again, true); window.removeEventListener('resize', again); };
  }, []);
  void tick;
  if (!root) return null;
  const blocks = [...root.querySelectorAll('.bn-editor .bn-block-outer')];
  if (blocks.length < 8) return null;
  const sc = scrollerOf(root);
  const isDoc = sc === document.scrollingElement || sc === document.documentElement;
  const box = isDoc ? { top: 70, bottom: window.innerHeight - 16, right: 5 } : (() => { const r = sc.getBoundingClientRect(); return { top: r.top + 12, bottom: r.bottom - 12, right: Math.max(2, Math.round(window.innerWidth - r.right + 3)) }; })();
  const index = new Map(blocks.map((el, i) => [el.getAttribute('data-id'), i]));
  const at = (v) => (v && index.has(v.b) ? (index.get(v.b) + (v.f || 0)) / blocks.length : null);
  const others = peers.filter((p) => !p.me);
  const mine = at(anchorOf(root));
  const goTo = (frac) => {
    const i = clamp(Math.floor(frac * blocks.length), 0, blocks.length - 1);
    blocks[i].scrollIntoView({ block: 'start', behavior: 'smooth' });
  };
  const span = Math.max(40, box.bottom - box.top);
  const thumb = isDoc ? sc.clientHeight / sc.scrollHeight : sc.clientHeight / sc.scrollHeight;
  return createPortal(
    <div className="pb-rail" data-testid="reading-rail" style={{ top: box.top, height: span, right: box.right }} aria-label="Where everyone is reading">
      {mine !== null && <i className="me" title="You" style={{ top: `${mine * 100}%`, height: `${clamp(thumb, 0.04, 1) * 100}%` }} />}
      {others.map((p) => {
        const f = at(p.view);
        if (f === null) return null;
        return <button key={keyOf(p)} type="button" className="dot" data-testid="rail-dot" data-name={p.name} title={`${p.name} is here. Click to go there`} style={{ top: `${f * 100}%`, '--c': p.color }} onClick={() => goTo(f)}><span>{initial(p.name)}</span></button>;
      })}
      <style>{`
        .pb-rail { position: fixed; right: 5px; width: 10px; z-index: 1050; border-radius: 6px; background: transparent; pointer-events: none; }
        .pb-rail .me { display: none; position: absolute; left: 1px; right: 1px; border-radius: 5px; background: color-mix(in srgb, currentColor 28%, transparent); pointer-events: none; min-height: 6px; }
        .pb-rail .dot { position: absolute; left: -9px; width: 22px; height: 22px; margin-top: -11px; border-radius: 50%; border: 2px solid #fff; background: var(--c); color: #fff; font: 700 10px/1 system-ui, sans-serif; display: grid; place-items: center; cursor: pointer; pointer-events: auto; padding: 0; box-shadow: 0 2px 6px rgba(0,0,0,.25); transition: top .3s ease; }
        .pb-rail .dot:hover { transform: scale(1.18); }
        @media (max-width: 640px) { .pb-rail { display: none; } }
      `}</style>
    </div>,
    document.body,
  );
}

// the PowerPoint files sitting in this note (the ones a browser can draw)
function collectDecks(editor) {
  const out = [];
  const walk = (bs) => (bs || []).forEach((b) => { if (b.type === 'docfile' && b.props?.url && extOf(b.props.name) === 'pptx') out.push({ url: baseOf(b.props.url), name: b.props.name }); if (b.children?.length) walk(b.children); });
  try { walk(editor?.document); } catch { /* editor not ready */ }
  return out.filter((d, i) => out.findIndex((x) => x.url === d.url) === i);
}

export default function PresenceBar({ rt, editor, rootRef, ready }) {
  const peers = usePeers(rt);
  const [following, setFollowing] = useState(null); // keyOf(peer)
  const [tick, setTick] = useState(0);
  const [tip, setTip] = useState(null);
  const [presenting, setPresenting] = useState(false);
  const [laser, setLaser] = useState(false);
  const [spot, setSpot] = useState(false);
  const host = useHost();
  const [showPresence] = usePresence();
  const [startOpen, setStartOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [deckSel, setDeckSel] = useState(null); // the PowerPoint being presented
  const presentBtn = useRef(null);
  const resumeRef = useRef(null);
  useEffect(() => { // I switched notes while presenting: carry on presenting here
    if (!ready || resumeRef.current) return;
    try {
      const r = JSON.parse(sessionStorage.getItem(RESUME_KEY) || 'null');
      if (!r) return;
      sessionStorage.removeItem(RESUME_KEY);
      if (Date.now() - r.t > 20000) return;
      resumeRef.current = r; setMode(r.mode || 'follow'); setQOn(r.qOn !== false); setNotesOn(r.notesOn !== false); setPresenting(true);
    } catch { /* nothing to resume */ }
  }, [ready]);
  const quickStart = (m, deck) => { setMenuOpen(false); setMode(m); setDeckSel(m === 'ppt' ? deck || null : null); try { if (localStorage.getItem('peblo-present-fs') !== '0') document.documentElement.requestFullscreen?.().catch(() => {}); } catch { /* not allowed */ } setPresenting(true); };
  useEffect(() => { const k = (e) => { if (e.ctrlKey && e.shiftKey && (e.key === 'P' || e.key === 'p')) { e.preventDefault(); if (!presenting) quickStart('follow'); } }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); });
  const [mode, setMode] = useState('follow'); // follow | tour | point
  const [qOn, setQOn] = useState(true);
  const [notesOn, setNotesOn] = useState(true);
  const [recap, setRecap] = useState(null);
  const [myHand, setMyHand] = useState(0);
  const [myAsks, setMyAsks] = useState([]);
  const [myReacts, setMyReacts] = useState({ up: 0, idea: 0, heart: 0 });
  const [myVote, setMyVote] = useState(null);
  const [recapSent, setRecapSent] = useState(false);
  const [rxGone, setRxGone] = useState(0);
  const [keep, setKeep] = useState(false);
  const keepRef = useRef(false);
  keepRef.current = keep;
  const [dismissed, setDismissed] = useState({}); // keyOf(peer) -> true while the prompt is closed
  const followRef = useRef(null);
  followRef.current = following;

  // my own state: away after a minute without touching anything; typing while I edit; last editor of each block
  useEffect(() => {
    if (!rt || !ready) return undefined;
    const aw = rt.provider.awareness;
    const doc = rt.doc;
    const editors = doc.getMap('editors');
    let idleTimer;
    const active = () => {
      if (aw.getLocalState()?.idle) aw.setLocalStateField('idle', false);
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => aw.setLocalStateField('idle', true), IDLE_MS);
    };
    active();
    const evs = ['keydown', 'pointerdown', 'pointermove', 'wheel', 'touchstart'];
    evs.forEach((e) => window.addEventListener(e, active, { passive: true }));
    let lastTyping = 0;
    let editTimer;
    const onUpdate = (_u, origin) => {
      if (origin === rt.provider || origin === 'pb-editors') return;
      const now = Date.now();
      if (now - lastTyping > 800) { lastTyping = now; aw.setLocalStateField('typingAt', now); }
      if (followRef.current) setFollowing(null); // typing yourself ends follow mode
      clearTimeout(editTimer);
      editTimer = setTimeout(() => {
        try {
          const id = editor.getTextCursorPosition().block.id;
          if (!id) return;
          doc.transact(() => {
            editors.set(id, { n: rt.user.name, c: rt.user.color, t: Date.now() });
            if (editors.size > 1500) { // keep it small: forget the oldest
              const old = [...editors.entries()].sort((a, b) => (a[1]?.t || 0) - (b[1]?.t || 0)).slice(0, 300);
              old.forEach(([k]) => editors.delete(k));
            }
          }, 'pb-editors');
        } catch { /* no cursor in a block right now */ }
      }, 500);
    };
    doc.on('update', onUpdate);
    return () => {
      clearTimeout(idleTimer); clearTimeout(editTimer);
      evs.forEach((e) => window.removeEventListener(e, active));
      doc.off('update', onUpdate);
      try { aw.setLocalStateField('idle', false); } catch { /* gone */ }
    };
  }, [rt, ready, editor]);

  // typing indicators need a clock while someone is typing
  const anyTyping = peers.some((p) => !p.me && Date.now() - p.typingAt < TYPING_MS);
  useEffect(() => {
    if (!anyTyping) return undefined;
    const t = setInterval(() => setTick((n) => n + 1), 700);
    return () => clearInterval(t);
  }, [anyTyping]);

  // my view: tell the others which block is at the top of my screen (so they can follow me), throttled
  useEffect(() => {
    const root = rootRef?.current;
    if (!rt || !ready || !root) return undefined;
    const aw = rt.provider.awareness;
    let timer = null;
    let lastSig = '';
    const send = () => {
      timer = null;
      const a = anchorOf(root);
      const sig = a ? `${a.b}|${a.f}` : '';
      if (sig === lastSig) return;
      lastSig = sig;
      try { aw.setLocalStateField('view', a); } catch { /* gone */ }
    };
    const queue = () => { if (!timer) timer = setTimeout(send, 120); };
    window.addEventListener('scroll', queue, true);
    window.addEventListener('resize', queue);
    queue();
    return () => { clearTimeout(timer); window.removeEventListener('scroll', queue, true); window.removeEventListener('resize', queue); try { aw.setLocalStateField('view', null); } catch { /* gone */ } };
  }, [rt, ready, rootRef]);

  // presenting: everyone else is offered to follow me
  useEffect(() => {
    if (!rt || !ready) return undefined;
    const aw = rt.provider.awareness;
    try { aw.setLocalStateField('presenting', presenting); aw.setLocalStateField('mode', mode); aw.setLocalStateField('qOn', qOn); } catch { /* gone */ }
    if (!presenting) { setLaser(false); setSpot(false); }
    document.documentElement.classList.toggle('pb-presenting', presenting);
    if (!presenting && document.fullscreenElement === document.documentElement) document.exitFullscreen?.().catch(() => {});
    return () => { document.documentElement.classList.remove('pb-presenting'); try { aw.setLocalStateField('presenting', false); } catch { /* gone */ } };
  }, [rt, ready, presenting, mode, qOn]);
  // the audience: my hand, my questions, who I am following; a question the presenter has dealt with leaves my list
  useEffect(() => {
    if (!rt || !ready) return;
    try { rt.provider.awareness.setLocalStateField('hand', myHand || null); rt.provider.awareness.setLocalStateField('asks', myAsks); rt.provider.awareness.setLocalStateField('reacts', myReacts.up + myReacts.idea + myReacts.heart ? myReacts : null); rt.provider.awareness.setLocalStateField('vote', myVote); } catch { /* gone */ }
  }, [rt, ready, myHand, myAsks, myReacts, myVote]);
  useEffect(() => {
    if (!rt || !ready) return;
    const t = peers.find((p) => keyOf(p) === following);
    try { rt.provider.awareness.setLocalStateField('follows', t ? keyOf(t) : null); } catch { /* gone */ }
  }, [rt, ready, following, peers]);
  useEffect(() => {
    const gone = new Set(peers.filter((p) => !p.me && p.presenting).flatMap((p) => p.answered || []));
    const me = peers.find((p) => p.me);
    if (!me) return;
    setMyAsks((list) => { const next = list.filter((a) => !gone.has(`${keyOf(me)}#${a.id}`)); return next.length === list.length ? list : next; });
  }, [peers]);
  useEffect(() => { if (!peers.some((p) => !p.me && p.presenting)) { setKeep(false); } }, [peers]);
  useEffect(() => {
    if (!rt || !ready) return undefined;
    const aw = rt.provider.awareness;
    try { aw.setLocalStateField('laser', presenting && laser); aw.setLocalStateField('spot', presenting && spot); } catch { /* gone */ }
    return () => { try { aw.setLocalStateField('laser', false); aw.setLocalStateField('spot', false); } catch { /* gone */ } };
  }, [rt, ready, presenting, laser, spot]);
  useEffect(() => { // a prompt comes back the next time that person starts presenting
    setDismissed((d) => {
      const live = new Set(peers.filter((p) => p.presenting).map(keyOf));
      const keep = Object.fromEntries(Object.entries(d).filter(([k]) => live.has(k)));
      return Object.keys(keep).length === Object.keys(d).length ? d : keep;
    });
  }, [peers]);

  // follow mode: keep the person's view on screen, smoothly, and let go the moment I scroll or type myself
  const [freed, setFreed] = useState(null); // { name } after I take over
  useEffect(() => {
    if (!rt || !following) return undefined;
    const aw = rt.provider.awareness;
    const target = peers.find((p) => keyOf(p) === following);
    if (!target) { setFollowing(null); return undefined; }
    const root = rootRef?.current;
    if (!root) return undefined;
    let raf = 0;
    let lastProg = 0;
    const view = () => aw.getStates().get(target.id)?.view || null;
    const step = () => {
      raf = 0;
      const v = view();
      if (!v?.b) return;
      let outer = null;
      try { outer = root.querySelector(`.bn-block-outer[data-id="${CSS.escape(v.b)}"]`); } catch { /* odd id */ }
      if (!outer) return;
      const sc = scrollerOf(root);
      const r = outer.getBoundingClientRect();
      const delta = r.top + v.f * r.height - (topOf(sc) + 8);
      if (Math.abs(delta) < 1.5) return;
      const big = Math.abs(delta) > window.innerHeight * 2;
      lastProg = Date.now();
      sc.scrollTop += big ? delta : (Math.sign(delta) * Math.max(1, Math.abs(delta) * 0.2));
      raf = requestAnimationFrame(step);
    };
    const kick = () => { if (!raf) raf = requestAnimationFrame(step); };
    // the typing caret of someone with no view to follow (an older tab): bring it into view
    const caret = () => {
      if (view()) return;
      const els = [...root.querySelectorAll('.bn-collaboration-cursor__base')];
      const el = els.find((e) => (e.querySelector('.bn-collaboration-cursor__label')?.textContent || '').trim() === target.name);
      if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    };
    const onChange = () => { kick(); caret(); };
    const free = (e) => {
      if (keepRef.current) return;
      if (e.type === 'keydown' && !['PageDown', 'PageUp', 'ArrowDown', 'ArrowUp', 'Home', 'End', ' '].includes(e.key)) return;
      if (e.type === 'wheel' || e.type === 'touchmove' || e.type === 'keydown') { cancelAnimationFrame(raf); raf = 0; setFollowing(null); setFreed({ name: target.name, key: keyOf(target), presenting: !!target.presenting }); }
    };
    aw.on('change', onChange);
    window.addEventListener('wheel', free, { passive: true });
    window.addEventListener('touchmove', free, { passive: true });
    window.addEventListener('keydown', free);
    kick();
    return () => { cancelAnimationFrame(raf); aw.off('change', onChange); window.removeEventListener('wheel', free); window.removeEventListener('touchmove', free); window.removeEventListener('keydown', free); };
  }, [rt, following, peers.length]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { // the notice fades, unless they are presenting: then the way back stays until they stop
    if (!freed) return undefined;
    if (freed.presenting && peers.some((p) => keyOf(p) === freed.key && p.presenting)) return undefined;
    const t = setTimeout(() => setFreed(null), freed.presenting ? 0 : 4000);
    return () => clearTimeout(t);
  }, [freed, peers]);
  useEffect(() => { if (following) setFreed(null); }, [following]);

  // "edited by" on hover
  useEffect(() => {
    const root = rootRef?.current;
    if (!rt || !ready || !root) return undefined;
    const editors = rt.doc.getMap('editors');
    let timer;
    const over = (e) => {
      clearTimeout(timer);
      const outer = e.target?.closest?.('.bn-block-outer');
      const id = outer?.getAttribute('data-id');
      if (!id) { setTip(null); return; }
      const who = editors.get(id);
      if (!who) { setTip(null); return; }
      const x = e.clientX; const y = e.clientY;
      timer = setTimeout(() => setTip({ x, y, name: who.n === rt.user.name && who.c === rt.user.color ? 'You' : who.n, color: who.c, t: who.t }), 500);
    };
    const out = () => { clearTimeout(timer); setTip(null); };
    root.addEventListener('mouseover', over);
    root.addEventListener('mouseleave', out);
    return () => { clearTimeout(timer); root.removeEventListener('mouseover', over); root.removeEventListener('mouseleave', out); };
  }, [rt, ready, rootRef]);

  // the presenter moved to another shared note: follow along, and pick the thread back up over there
  const movedTo = useRef('');
  useEffect(() => {
    const lead = peers.find((x) => !x.me && keyOf(x) === following);
    if (!lead || !lead.next || !window.location.pathname.startsWith('/s/note/') || window.location.pathname.includes(lead.next) || movedTo.current === lead.next) return;
    movedTo.current = lead.next;
    try { sessionStorage.setItem(FOLLOW_KEY, JSON.stringify({ t: Date.now(), name: lead.name, keep: keepRef.current })); } catch { /* private mode */ }
    gotoPath('/s/note/' + lead.next);
  }, [peers, following]);
  const followBack = useRef(null);
  useEffect(() => {
    if (followBack.current === null) { try { followBack.current = JSON.parse(sessionStorage.getItem(FOLLOW_KEY) || 'null') || false; } catch { followBack.current = false; } }
    const f = followBack.current;
    if (!f) return;
    if (Date.now() - f.t > 20000) { followBack.current = false; try { sessionStorage.removeItem(FOLLOW_KEY); } catch { /* ignore */ } return; }
    const lead = peers.find((x) => !x.me && x.presenting && x.name === f.name);
    if (lead) { followBack.current = false; try { sessionStorage.removeItem(FOLLOW_KEY); } catch { /* ignore */ } setFollowing(keyOf(lead)); if (f.keep) setKeep(true); }
  }, [peers]);
  if (!rt || !ready) return null;
  const others = peers.filter((p) => !p.me);
  const me = peers.find((p) => p.me);
  const shown = [...(me ? [me] : []), ...others].slice(0, 6);
  const hidden = peers.length - shown.length;
  const now = Date.now();
  const followed = following && peers.find((p) => keyOf(p) === following);
  const presenters = others.filter((p) => p.presenting && p.mode !== 'point' && keyOf(p) !== following && !dismissed[keyOf(p)]);
  const livePresenters = others.filter((p) => p.presenting);
  const talker = livePresenters.find((p) => p.qOn);
  const myKey = me ? keyOf(me) : '';
  const goToBlock = (b) => { try { rootRef?.current?.querySelector(`.bn-block-outer[data-id="${CSS.escape(b)}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' }); } catch { /* odd id */ } };
  const raise = () => setMyHand((h) => (h ? 0 : Date.now()));
  const ask = (text) => setMyAsks((l) => [...l, { id: Math.random().toString(36).slice(2, 8), text, at: Date.now() }]);
  const endSession = (r) => { setPresenting(false); setRecapSent(false); setRecap(r); };
  const react = (k) => setMyReacts((r) => ({ ...r, [k]: (r[k] || 0) + 1 }));
  const sendRecap = (payload) => { try { rt.provider.awareness.setLocalStateField('recapMd', payload); setRecapSent(true); } catch { /* gone */ } };
  const rxPeer = peers.find((p) => !p.me && p.recapMd && p.recapMd.at > rxGone && Date.now() - p.recapMd.at < 30 * 60000);
  void tick;

  return (
    <>
      {others.length > 0 && (
        <div className="pb-presence-wrap" data-testid="presence">
          <div className="pb-presence" role="group" aria-label="People in this note">
            {shown.map((p) => {
              const typing = !p.me && now - p.typingAt < TYPING_MS;
              const state = p.me ? 'you' : typing ? 'typing' : p.idle ? 'away' : 'here';
              return (
                <button
                  key={keyOf(p)}
                  type="button"
                  className={`pb-avatar ${state}${followed && keyOf(p) === following ? ' following' : ''}${p.presenting ? ' presenting' : ''}`}
                  style={{ '--c': p.color }}
                  data-testid="presence-avatar"
                  data-state={state}
                  disabled={p.me}
                  title={p.me ? 'You' : `${p.name}${typing ? ' is typing' : p.idle ? ' is away' : ' is here'}. Click to follow their cursor`}
                  aria-label={p.me ? 'You' : `${p.name}, ${state === 'typing' ? 'typing' : state === 'away' ? 'away' : 'here'}. Follow`}
                  aria-pressed={!p.me && following === keyOf(p)}
                  onClick={() => setFollowing((f) => (f === keyOf(p) ? null : keyOf(p)))}
                >
                  {initial(p.name)}
                  {p.presenting && <span className="badge" aria-hidden="true"><Ic name="presentation" size={9} /></span>}
                  {typing && <span className="dots" aria-hidden="true">…</span>}
                </button>
              );
            })}
            {hidden > 0 && <span className="pb-avatar more" aria-label={`${hidden} more`}>+{hidden}</span>}
            <button type="button" ref={presentBtn} className={`pb-present${presenting ? ' on' : ''}`} data-testid="present-btn" aria-pressed={presenting} title={presenting ? 'Stop presenting' : 'Present: everyone else can follow your view'} aria-label={presenting ? 'Stop presenting' : 'Present to everyone'} onClick={() => { if (presenting) { setPresenting(false); setStartOpen(false); } else { setStartOpen(false); setMenuOpen((v) => !v); } }}><Ic name="presentation" size={15} /></button>
            <button type="button" className="pb-presence-count" data-testid="open-collab" title="Who is here" aria-label="Open live collaboration" aria-live="polite" onClick={() => window.dispatchEvent(new Event('pb-open-collab'))}>{others.length === 1 ? `${others[0].name} is here` : `${others.length} others here`}</button>
          </div>
          {menuOpen && !presenting && <PresentMenu anchor={presentBtn.current} count={others.length} qOn={qOn} setQOn={setQOn} onPick={quickStart} decks={menuOpen ? collectDecks(editor) : []} onDeck={(d) => quickStart('ppt', d)} onOptions={() => { setMenuOpen(false); setStartOpen(true); }} onClose={() => setMenuOpen(false)} />}
          {startOpen && !presenting && <PresentStart mode={mode} setMode={setMode} qOn={qOn} setQOn={setQOn} notesOn={notesOn} setNotesOn={setNotesOn} count={others.length} onStart={() => { setStartOpen(false); setPresenting(true); }} onCancel={() => setStartOpen(false)} />}
          {presenters.map((p) => (
            <div key={keyOf(p)} className="pb-follow offer" role="status" data-testid="present-offer"><Ic name="presentation" size={14} />{p.name} is presenting
              <button type="button" data-testid="present-follow" onClick={() => setFollowing(keyOf(p))}>Follow</button>
              <button type="button" data-testid="present-keep" title={`Keep me with ${p.name}: scrolling will not let go`} onClick={() => { setFollowing(keyOf(p)); setKeep(true); }}>Keep me</button>
              <button type="button" className="quiet" onClick={() => setDismissed((d) => ({ ...d, [keyOf(p)]: true }))}>Not now</button>
            </div>
          ))}
          {freed && !freed.presenting && <div className="pb-follow" role="status" data-testid="follow-freed">You stopped following {freed.name}</div>}
          {followed && (
            <div className="pb-follow" role="status" data-testid="follow-banner">
              <Ic name="follow" size={14} />Following {followed.name}{followed.tour ? ` · stop ${Math.max(0, followed.tour.i) + 1} of ${followed.tour.n}` : ''}
              <button type="button" onClick={() => { setFollowing(null); setKeep(false); }}>Stop</button>
            </div>
          )}
        </div>
      )}
      {others.length > 0 && livePresenters.length > 0 && !presenting && <div className="pb-presence-wrap pb-aud-wrap" style={{ position: 'fixed', right: 82, bottom: 24, zIndex: 1100 }}><AudienceActions presenter={talker || livePresenters[0]} qOn={!!talker} hand={myHand} onHand={raise} onAsk={ask} sent={myAsks.length} reacts={myReacts} onReact={react} /></div>}
      {presenting && <PresenterKit startedAt={resumeRef.current?.t0} startPanel={resumeRef.current?.drawer ? 'queue' : null} aw={rt.provider.awareness} me={myKey} peers={peers} mode={mode} qOn={qOn} notesOn={notesOn} laser={laser} setLaser={setLaser} spot={spot} setSpot={setSpot} getAnchor={() => anchorOf(rootRef.current)} goToBlock={goToBlock} onEnd={endSession} />}
      {presenting && mode === 'ppt' && deckSel && <DeckStage role="presenter" deck={deckSel} aw={rt.provider.awareness} laser={laser} />}
      {!presenting && followed?.deck && <DeckStage key={followed.deck.u} role="follower" lead={followed} onLeave={() => { setFollowing(null); setFreed({ name: followed.name, key: keyOf(followed), presenting: true }); }} />}
      {!presenting && livePresenters.length > 0 && <RoomNotices presenters={livePresenters} myKey={myKey} onClearHand={() => setMyHand(0)} myVote={myVote} onVote={(id, i) => setMyVote({ id, i })} />}
      {recap && <RecapModal recap={recap} sent={recapSent} onSend={sendRecap} onClose={() => setRecap(null)} />}
      {!recap && !presenting && rxPeer && <RecapReceived from={rxPeer.name} rx={rxPeer.recapMd} onClose={() => setRxGone(rxPeer.recapMd.at)} />}
      {freed?.presenting && peers.some((p) => keyOf(p) === freed.key && p.presenting) && createPortal(
        <button type="button" className="pb-return" data-testid="return-presenter" onClick={() => { setFollowing(freed.key); setFreed(null); }}><Ic name="undo" size={15} />Return to {freed.name}</button>,
        host,
      )}
      {others.length > 0 && <ReadingRail root={rootRef?.current} peers={peers} tick={tick} />}
      {tip && showPresence && createPortal(
        <div className="pb-editedby" style={{ left: Math.min(tip.x + 12, window.innerWidth - 190), top: tip.y + 14 }} role="tooltip" data-testid="edited-by">
          <i style={{ background: tip.color }} />Edited by {tip.name} · {ago(tip.t)}
        </div>,
        document.body,
      )}
      <style>{PRESENT_CSS}</style>
      <style>{`
        .pb-presence-count { border: 0; background: transparent; color: inherit; font: inherit; cursor: pointer; padding: 0 4px; }
        .pb-presence-wrap { position: relative; display: flex; flex-direction: column; align-items: flex-end; pointer-events: none; }
        .pb-presence { pointer-events: auto; display: flex; align-items: center; gap: 4px; padding: 4px 10px 4px 6px; border-radius: 999px; background: color-mix(in srgb, var(--pb-bg, #fff) 92%, transparent); border: 1px solid color-mix(in srgb, currentColor 14%, transparent); backdrop-filter: blur(6px); box-shadow: 0 2px 10px rgba(0,0,0,.08); font-size: 12px; }
        .pb-avatar { width: 26px; height: 26px; border-radius: 50%; border: 2px solid var(--c); background: var(--c); color: #fff; font-weight: 700; font-size: 12px; display: inline-flex; align-items: center; justify-content: center; position: relative; padding: 0; cursor: pointer; line-height: 1; }
        .pb-avatar:disabled { cursor: default; }
        .pb-avatar.you { background: transparent; color: var(--c); }
        .pb-avatar.away { opacity: .45; filter: grayscale(.5); }
        .pb-avatar.typing { animation: pb-pulse 1s ease-in-out infinite; }
        .pb-avatar.following { outline: 2px solid var(--c); outline-offset: 2px; }
        .pb-avatar.more { background: transparent; color: inherit; border-color: currentColor; opacity: .7; cursor: default; }
        .pb-avatar .dots { position: absolute; right: -4px; bottom: -6px; font-size: 14px; color: var(--c); }
        .pb-presence-count { margin-left: 4px; opacity: .75; white-space: nowrap; }
        .pb-follow { pointer-events: auto; margin-top: 6px; padding: 4px 10px; border-radius: 8px; background: #111827; color: #fff; font-size: 12px; display: flex; gap: 10px; align-items: center; }
        .pb-follow { max-width: 340px; }
        .pb-follow.presenting { background: #7c3aed; }
        .pb-follow.offer { background: #1f2937; }
        .pb-follow button.quiet { opacity: .7; text-decoration: none; }
        .pb-follow .tools { display: inline-flex; align-items: center; gap: 4px; margin-left: 2px; }
        .pb-follow .tools button { display: grid; place-items: center; width: 26px; height: 26px; border-radius: 8px; background: rgba(255,255,255,.14); text-decoration: none; }
        .pb-follow .tools button.on { background: #fff; color: #7c3aed; }
        .pb-follow .tools .hint { display: inline-flex; gap: 4px; align-items: center; font-size: 11px; opacity: .85; padding: 0 4px; }
        .pb-return { position: fixed; left: 50%; bottom: 84px; transform: translateX(-50%); z-index: 1150; display: inline-flex; gap: 8px; align-items: center; border: 0; border-radius: 999px; padding: 10px 16px; background: #7c3aed; color: #fff; font: 700 13px 'Figtree', system-ui, sans-serif; box-shadow: 0 8px 24px rgba(60, 20, 120, .35); cursor: pointer; animation: pbRise .25s ease-out; }
        @keyframes pbRise { from { transform: translate(-50%, 12px); opacity: 0; } to { transform: translate(-50%, 0); opacity: 1; } }
        .pb-present { width: 26px; height: 26px; border-radius: 50%; border: 1px solid color-mix(in srgb, currentColor 22%, transparent); background: transparent; color: inherit; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; margin-left: 2px; }
        .pb-present:hover { background: color-mix(in srgb, currentColor 10%, transparent); }
        .pb-present.on { background: #7c3aed; border-color: #7c3aed; color: #fff; }
        .pb-avatar .badge { position: absolute; right: -5px; top: -6px; width: 15px; height: 15px; border-radius: 50%; background: #7c3aed; color: #fff; display: grid; place-items: center; border: 1.5px solid var(--pb-bg, #fff); }
        .pb-follow button { background: transparent; border: 0; color: #fff; text-decoration: underline; cursor: pointer; font-size: 12px; }
        .pb-editedby { position: fixed; z-index: 1200; padding: 4px 9px; border-radius: 6px; background: #111827; color: #fff; font-size: 12px; pointer-events: none; display: flex; gap: 6px; align-items: center; white-space: nowrap; }
        .pb-editedby i { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
        @keyframes pb-pulse { 0%,100% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--c) 55%, transparent); } 50% { box-shadow: 0 0 0 5px transparent; } }
        @media (max-width: 640px) { .pb-presence-count { display: none; } }
        @media (prefers-reduced-motion: reduce) { .pb-avatar.typing { animation: none; } }
      `}</style>
    </>
  );
}

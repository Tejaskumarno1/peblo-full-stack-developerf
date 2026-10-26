import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Ic } from '../utils/icons';

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
        const p = { id, name: st.user.name || 'Someone', color: st.user.color || '#2563eb', idle: !!st.idle, typingAt: st.typingAt || 0, presenting: !!st.presenting, me: id === aw.clientID };
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

export default function PresenceBar({ rt, editor, rootRef, ready }) {
  const peers = usePeers(rt);
  const [following, setFollowing] = useState(null); // keyOf(peer)
  const [tick, setTick] = useState(0);
  const [tip, setTip] = useState(null);
  const [presenting, setPresenting] = useState(false);
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
    try { aw.setLocalStateField('presenting', presenting); } catch { /* gone */ }
    return () => { try { aw.setLocalStateField('presenting', false); } catch { /* gone */ } };
  }, [rt, ready, presenting]);
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
      if (e.type === 'keydown' && !['PageDown', 'PageUp', 'ArrowDown', 'ArrowUp', 'Home', 'End', ' '].includes(e.key)) return;
      if (e.type === 'wheel' || e.type === 'touchmove' || e.type === 'keydown') { cancelAnimationFrame(raf); raf = 0; setFollowing(null); setFreed({ name: target.name }); }
    };
    aw.on('change', onChange);
    window.addEventListener('wheel', free, { passive: true });
    window.addEventListener('touchmove', free, { passive: true });
    window.addEventListener('keydown', free);
    kick();
    return () => { cancelAnimationFrame(raf); aw.off('change', onChange); window.removeEventListener('wheel', free); window.removeEventListener('touchmove', free); window.removeEventListener('keydown', free); };
  }, [rt, following, peers.length]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!freed) return undefined; const t = setTimeout(() => setFreed(null), 4000); return () => clearTimeout(t); }, [freed]);
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

  if (!rt || !ready) return null;
  const others = peers.filter((p) => !p.me);
  const me = peers.find((p) => p.me);
  const shown = [...(me ? [me] : []), ...others].slice(0, 6);
  const hidden = peers.length - shown.length;
  const now = Date.now();
  const followed = following && peers.find((p) => keyOf(p) === following);
  const presenters = others.filter((p) => p.presenting && keyOf(p) !== following && !dismissed[keyOf(p)]);
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
            <button type="button" className={`pb-present${presenting ? ' on' : ''}`} data-testid="present-btn" aria-pressed={presenting} title={presenting ? 'Stop presenting' : 'Present: everyone else can follow your view'} aria-label={presenting ? 'Stop presenting' : 'Present to everyone'} onClick={() => setPresenting((v) => !v)}><Ic name="presentation" size={15} /></button>
            <span className="pb-presence-count" aria-live="polite">{others.length === 1 ? `${others[0].name} is here` : `${others.length} others here`}</span>
          </div>
          {presenting && <div className="pb-follow presenting" role="status" data-testid="presenting-banner"><Ic name="presentation" size={14} />You are presenting. Everyone here can follow your view.<button type="button" onClick={() => setPresenting(false)}>Stop</button></div>}
          {presenters.map((p) => (
            <div key={keyOf(p)} className="pb-follow offer" role="status" data-testid="present-offer"><Ic name="presentation" size={14} />{p.name} is presenting
              <button type="button" data-testid="present-follow" onClick={() => setFollowing(keyOf(p))}>Follow</button>
              <button type="button" className="quiet" onClick={() => setDismissed((d) => ({ ...d, [keyOf(p)]: true }))}>Not now</button>
            </div>
          ))}
          {freed && <div className="pb-follow" role="status" data-testid="follow-freed">You stopped following {freed.name}</div>}
          {followed && (
            <div className="pb-follow" role="status" data-testid="follow-banner">
              <Ic name="follow" size={14} />Following {followed.name}
              <button type="button" onClick={() => setFollowing(null)}>Stop</button>
            </div>
          )}
        </div>
      )}
      {tip && createPortal(
        <div className="pb-editedby" style={{ left: Math.min(tip.x + 12, window.innerWidth - 190), top: tip.y + 14 }} role="tooltip" data-testid="edited-by">
          <i style={{ background: tip.color }} />Edited by {tip.name} · {ago(tip.t)}
        </div>,
        document.body,
      )}
      <style>{`
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

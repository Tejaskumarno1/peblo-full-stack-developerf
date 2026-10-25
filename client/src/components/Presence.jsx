import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

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
        const p = { id, name: st.user.name || 'Someone', color: st.user.color || '#2563eb', idle: !!st.idle, typingAt: st.typingAt || 0, me: id === aw.clientID };
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

  // follow mode: keep the person's cursor in view
  useEffect(() => {
    if (!rt || !following) return undefined;
    const aw = rt.provider.awareness;
    const target = peers.find((p) => keyOf(p) === following);
    if (!target) { setFollowing(null); return undefined; }
    let timer;
    let last = 0;
    const go = () => {
      const root = rootRef?.current;
      if (!root) return;
      const els = [...root.querySelectorAll('.bn-collaboration-cursor__base')];
      const el = els.find((e) => (e.querySelector('.bn-collaboration-cursor__label')?.textContent || '').trim() === target.name);
      if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    };
    const onChange = () => {
      clearTimeout(timer);
      const wait = Math.max(150, 450 - (Date.now() - last));
      timer = setTimeout(() => { last = Date.now(); go(); }, wait);
    };
    aw.on('change', onChange);
    go();
    return () => { clearTimeout(timer); aw.off('change', onChange); };
  }, [rt, following, peers.length]); // eslint-disable-line react-hooks/exhaustive-deps

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
                  className={`pb-avatar ${state}${followed && keyOf(p) === following ? ' following' : ''}`}
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
                  {typing && <span className="dots" aria-hidden="true">…</span>}
                </button>
              );
            })}
            {hidden > 0 && <span className="pb-avatar more" aria-label={`${hidden} more`}>+{hidden}</span>}
            <span className="pb-presence-count" aria-live="polite">{others.length === 1 ? `${others[0].name} is here` : `${others.length} others here`}</span>
          </div>
          {followed && (
            <div className="pb-follow" role="status" data-testid="follow-banner">
              Following {followed.name}
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

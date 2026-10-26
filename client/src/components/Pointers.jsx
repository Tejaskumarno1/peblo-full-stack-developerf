import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Ic } from '../utils/icons';
import { createPortal } from 'react-dom';

/*
 * Live mouse pointers: where the other people's mouse is over the note, with their name.
 * Shared through the live document's awareness (temporary, never stored).
 *
 * The position is anchored to the block of text under the mouse (its id, how far across the
 * editor column, how far down the block), so it lands on the same words whatever the window size,
 * wrapping or scroll position of each person. A person who is out of view shows as a small marker
 * on the top or bottom edge; click it to scroll to them. Turn pointers off with localStorage
 * peblo-pointers = off (the share page's Appearance menu does this).
 */
const SEND_MS = 40;
const FADE_MS = 6000;

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const inkOn = (hex) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
  if (!m) return '#fff';
  const n = parseInt(m[1], 16);
  const l = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return l > 0.62 ? '#14141a' : '#fff';
};
/** The part of the screen the note can actually be seen in (inside every scrolling parent). */
const visibleBox = (el) => {
  let top = 0; let bottom = window.innerHeight; let left = 0; let right = window.innerWidth;
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
    const oy = getComputedStyle(p).overflowY;
    if (oy === 'auto' || oy === 'scroll' || oy === 'hidden') {
      const r = p.getBoundingClientRect();
      top = Math.max(top, r.top); bottom = Math.min(bottom, r.bottom); left = Math.max(left, r.left); right = Math.min(right, r.right);
    }
  }
  return { top, bottom, left, right };
};
const prefOn = () => { try { return localStorage.getItem('peblo-pointers') !== 'off'; } catch { return true; } };

export default function Pointers({ rt, rootRef, ready }) {
  const [pts, setPts] = useState([]); // { key, name, color, b, x, y }
  const [spot, setSpot] = useState(null); // block id someone is spotlighting
  const [rings, setRings] = useState([]); // pings on show
  const pinged = useRef(new Set());
  const [, bump] = useState(0);
  const [on, setOn] = useState(prefOn);
  const seen = useRef(new Map()); // key -> { sig, at } last time its pointer moved
  const snap = useRef(false); // set while the page scrolls: pointers move with the page instead of gliding
  const cur = useRef(new Map()); // key -> { x, y } where the pointer is drawn right now

  useEffect(() => {
    const f = () => setOn(prefOn());
    window.addEventListener('pb-pointers-pref', f);
    window.addEventListener('storage', f);
    return () => { window.removeEventListener('pb-pointers-pref', f); window.removeEventListener('storage', f); };
  }, []);

  // publish my pointer
  useEffect(() => {
    const root = rootRef?.current;
    if (!rt || !ready || !root) return undefined;
    const aw = rt.provider.awareness;
    let last = 0;
    let pending;
    let timer = null;
    let shown = false;
    const send = (v) => { try { aw.setLocalStateField('pointer', v); } catch { /* gone */ } };
    const flush = () => { timer = null; if (pending !== undefined) { send(pending); shown = pending !== null; pending = undefined; last = Date.now(); } };
    const queue = (v) => {
      pending = v;
      const wait = SEND_MS - (Date.now() - last);
      if (wait <= 0) flush(); else if (!timer) timer = setTimeout(flush, wait);
    };
    /** Where the mouse is, as "this block, this far across, this far down"; null outside the note. */
    const where = (e) => {
      const ed = root.querySelector('.bn-editor');
      if (!ed) return null;
      const er = ed.getBoundingClientRect();
      const rr = root.getBoundingClientRect();
      const inside = er.width > 0 && e.clientX >= er.left - 80 && e.clientX <= er.right + 80 && e.clientY >= Math.max(rr.top, 0) && e.clientY <= Math.min(rr.bottom, window.innerHeight);
      if (!inside) return null;
      // the block under the mouse (or beside it, in the margins), whatever floats above it
      const px = clamp(e.clientX, er.left + 4, er.right - 4);
      const hit = document.elementsFromPoint(px, e.clientY).find((el) => el.closest?.('.bn-editor') === ed && el.closest('.bn-block-outer'));
      const outer = hit?.closest('.bn-block-outer');
      const id = outer?.getAttribute('data-id');
      if (!outer || !id) return null;
      const br = outer.getBoundingClientRect();
      return {
        b: id,
        x: Math.round(((e.clientX - er.left) / er.width) * 1000) / 1000,
        y: br.height ? Math.round(clamp((e.clientY - br.top) / br.height, 0, 1) * 1000) / 1000 : 0,
        // exact pixels, used by anyone whose column and block are the same size as mine (the same layout), so it is pixel-true there
        dx: Math.round(e.clientX - er.left), dy: Math.round(e.clientY - br.top), w: Math.round(er.width), h: Math.round(br.height),
      };
    };
    const move = (e) => {
      if (e.pointerType === 'touch') return;
      const w = where(e);
      if (!w) { if (shown || pending !== undefined) queue(null); return; }
      queue(w);
    };
    // Alt + click pings that spot for everyone: a ripple that says "look here"
    const ping = (e) => {
      if (!e.altKey || e.button !== 0) return;
      const w = where(e);
      if (!w) return;
      e.preventDefault();
      try { aw.setLocalStateField('ping', { ...w, n: Date.now() }); } catch { /* gone */ }
      window.dispatchEvent(new CustomEvent('pb-ping', { detail: { ...w, color: rt.user.color, name: rt.user.name } }));
    };
    window.addEventListener('pointerdown', ping, true);
    const gone = () => queue(null);
    const out = (e) => { if (!e.relatedTarget) queue(null); };
    window.addEventListener('pointermove', move, { passive: true });
    window.addEventListener('blur', gone);
    document.addEventListener('mouseout', out);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerdown', ping, true);
      window.removeEventListener('blur', gone);
      document.removeEventListener('mouseout', out);
      clearTimeout(timer);
      send(null);
    };
  }, [rt, ready, rootRef]);

  const addRing = (r) => {
    const id = `${r.n || Date.now()}-${Math.random()}`;
    setRings((cur) => [...cur.slice(-4), { ...r, id }]);
    setTimeout(() => setRings((cur) => cur.filter((x) => x.id !== id)), 1700);
  };
  useEffect(() => {
    const f = (e) => addRing(e.detail);
    window.addEventListener('pb-ping', f);
    return () => window.removeEventListener('pb-ping', f);
  }, []);

  // read everyone else's
  useEffect(() => {
    if (!rt || !ready) { setPts([]); return undefined; }
    const aw = rt.provider.awareness;
    const read = () => {
      const out = [];
      const live = new Set();
      let spotted = null;
      aw.getStates().forEach((st, id) => {
        if (st?.spot && st.pointer?.b) spotted = st.pointer.b;
        if (id !== aw.clientID && st?.ping?.n && !pinged.current.has(`${id}:${st.ping.n}`) && Date.now() - st.ping.n < 4000) {
          pinged.current.add(`${id}:${st.ping.n}`);
          addRing({ ...st.ping, color: st.user?.color || '#2563eb', name: st.user?.name || '' });
        }
        if (id === aw.clientID || !st?.user || !st.pointer || typeof st.pointer.x !== 'number' || !st.pointer.b) return;
        live.add(id);
        const prev = seen.current.get(id);
        const sig = `${st.pointer.b}|${st.pointer.dx ?? st.pointer.x}|${st.pointer.dy ?? st.pointer.y}`;
        if (!prev || prev.sig !== sig) seen.current.set(id, { sig, at: Date.now() });
        out.push({ key: id, name: st.user.name || 'Someone', color: st.user.color || '#2563eb', b: st.pointer.b, x: st.pointer.x, y: st.pointer.y, dx: st.pointer.dx, dy: st.pointer.dy, w: st.pointer.w, h: st.pointer.h, presenting: !!st.presenting, laser: !!st.laser });
      });
      [...seen.current.keys()].forEach((k) => { if (!live.has(k)) seen.current.delete(k); });
      setSpot(spotted);
      setPts(out);
    };
    read();
    aw.on('change', read);
    return () => aw.off('change', read);
  }, [rt, ready]);

  // follow the page when it scrolls or resizes, and let idle pointers fade
  useEffect(() => {
    if (!pts.length) return undefined;
    let raf = 0;
    const again = () => { snap.current = true; cancelAnimationFrame(raf); raf = requestAnimationFrame(() => bump((n) => n + 1)); };
    window.addEventListener('scroll', again, true);
    window.addEventListener('resize', again);
    const t = setInterval(again, 1500);
    return () => { cancelAnimationFrame(raf); clearInterval(t); window.removeEventListener('scroll', again, true); window.removeEventListener('resize', again); };
  }, [pts.length]);

  // glide: every frame each pointer moves a share of the way to where it should be, so network gaps never show as jumps
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      document.querySelectorAll('.pb-pointer[data-key]').forEach((el) => {
        const k = el.getAttribute('data-key');
        const tx = Number(el.getAttribute('data-tx'));
        const ty = Number(el.getAttribute('data-ty'));
        let c = cur.current.get(k);
        if (!c || el.getAttribute('data-snap') === '1') { c = { x: tx, y: ty }; el.setAttribute('data-snap', '0'); }
        else {
          const dx = tx - c.x; const dy = ty - c.y;
          c = Math.abs(dx) + Math.abs(dy) > 900 ? { x: tx, y: ty } : { x: Math.abs(dx) < 0.3 ? tx : c.x + dx * 0.32, y: Math.abs(dy) < 0.3 ? ty : c.y + dy * 0.32 };
        }
        cur.current.set(k, c);
        el.style.transform = `translate3d(${c.x}px, ${c.y}px, 0)`;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  useLayoutEffect(() => { snap.current = false; });

  const root = rootRef?.current;
  const ed = root?.querySelector('.bn-editor');
  if (!ed || (!pts.length && !spot && !rings.length)) return null;
  const er = ed.getBoundingClientRect();
  const vis = visibleBox(root);
  const now = Date.now();
  const marks = [];
  const edges = [];
  const placeOf = (p) => {
    let outer = null;
    try { outer = ed.querySelector(`.bn-block-outer[data-id="${CSS.escape(p.b)}"]`); } catch { /* odd id */ }
    if (!outer) return null;
    const br = outer.getBoundingClientRect();
    return { outer, br, left: er.left + (p.dx != null && Math.abs(er.width - p.w) <= 8 ? p.dx : p.x * er.width), top: br.top + (p.dy != null && Math.abs(br.height - p.h) <= 6 ? p.dy : p.y * br.height) };
  };
  (on ? pts : []).forEach((p) => {
    let outer = null;
    try { outer = ed.querySelector(`.bn-block-outer[data-id="${CSS.escape(p.b)}"]`); } catch { /* odd id */ }
    if (!outer) return;
    const br = outer.getBoundingClientRect();
    // same-size layout: exact pixels; different layout: the same share of the column and of the block
    const left = er.left + (p.dx != null && Math.abs(er.width - p.w) <= 8 ? p.dx : p.x * er.width);
    const top = br.top + (p.dy != null && Math.abs(br.height - p.h) <= 6 ? p.dy : p.y * br.height);
    const idle = now - (seen.current.get(p.key)?.at || now) > FADE_MS;
    const ink = inkOn(p.color);
    if (top < vis.top + 6 || top > vis.bottom - 14 || left < vis.left - 10 || left > vis.right + 10) {
      edges.push({ ...p, up: top < vis.top + 6, ink, outer, left: clamp(left, vis.left + 24, vis.right - 120), edgeTop: vis.top + 12, edgeBottom: window.innerHeight - vis.bottom + 12 });
    } else {
      marks.push({ ...p, left, top, idle, ink });
    }
  });
  const spotBox = (() => {
    if (!spot) return null;
    let outer = null;
    try { outer = ed.querySelector(`.bn-block-outer[data-id="${CSS.escape(spot)}"]`); } catch { /* odd id */ }
    if (!outer) return null;
    const r = (outer.querySelector('.bn-block-content') || outer).getBoundingClientRect();
    if (r.bottom < vis.top || r.top > vis.bottom) return null;
    return { left: r.left - 12, top: r.top - 6, width: r.width + 24, height: r.height + 12 };
  })();
  const ringPlaces = rings.map((g) => ({ g, at: placeOf(g) })).filter((x) => x.at && x.at.top > vis.top && x.at.top < vis.bottom);
  if (!marks.length && !edges.length && !spotBox && !ringPlaces.length) return null;
  const goTo = (outer) => { try { outer.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch { /* gone */ } };
  return createPortal(
    <div className="pb-pointers" aria-hidden="true">
      {spotBox && <div className="pb-spot" data-testid="spotlight" style={spotBox} />}
      {ringPlaces.map(({ g, at }) => <div key={g.id} className="pb-ping" data-testid="ping-ring" style={{ left: at.left, top: at.top, '--c': g.color }}><i /><i /><i /></div>)}
      {marks.map((p) => (
        <div key={p.key} className={`pb-pointer${p.idle ? ' idle' : ''}${p.presenting ? ' presenter' : ''}${p.laser ? ' laser' : ''}`} data-testid="peer-pointer" data-name={p.name} ref={(el) => { if (el && !el.style.transform) el.style.transform = `translate3d(${p.left}px, ${p.top}px, 0)`; }} data-key={p.key} data-tx={p.left} data-ty={p.top} data-snap={snap.current ? '1' : '0'} style={{ '--c': p.color, '--ink': p.ink }}>
          {p.laser && <i className="dot" />}
          <svg width="20" height="24" viewBox="0 0 20 24" fill="none"><path d="M3 2.2l13.2 10.4-5.7 1.1 3.6 7.1-3 1.5-3.6-7.2L3 19.2z" fill="var(--c)" stroke="#fff" strokeWidth="1.6" strokeLinejoin="round" /></svg>
          <span className="tag">{p.presenting && <Ic name="presentation" size={12} style={{ marginRight: 5, verticalAlign: '-2px' }} />}{p.name}</span>
        </div>
      ))}
      {edges.map((p) => (
        <button key={p.key} type="button" className={`pb-pointer-edge ${p.up ? 'up' : 'down'}`} data-testid="peer-pointer-edge" data-name={p.name} onClick={() => goTo(p.outer)} style={{ left: p.left, [p.up ? 'top' : 'bottom']: p.up ? p.edgeTop : p.edgeBottom, '--c': p.color, '--ink': p.ink }} title={`Go to ${p.name}`}>
          <Ic name={p.up ? 'arrowUp' : 'arrowDown'} size={13} />{p.name}
        </button>
      ))}
      <style>{`
        .pb-pointers { position: fixed; inset: 0; pointer-events: none; z-index: 1100; overflow: hidden; }
        .pb-pointer { position: absolute; left: 0; top: 0; transition: opacity .4s; will-change: transform; animation: pbPtrIn .18s ease-out; }
        .pb-pointer.idle { opacity: .45; }
        .pb-pointer svg { display: block; filter: drop-shadow(0 2px 3px rgba(20,20,30,.28)); margin: -2px 0 0 -3px; }
        .pb-pointer .tag { position: absolute; left: 15px; top: 19px; background: var(--c); color: var(--ink); font: 700 11.5px/1 'Figtree', system-ui, sans-serif; letter-spacing: .01em; padding: 4px 9px 5px; border-radius: 4px 11px 11px 11px; white-space: nowrap; box-shadow: 0 2px 8px rgba(20,20,30,.22), 0 0 0 1.5px rgba(255,255,255,.85); }
        .pb-pointer-edge { position: absolute; pointer-events: auto; cursor: pointer; border: 0; background: var(--c); color: var(--ink); font: 700 11.5px/1 'Figtree', system-ui, sans-serif; padding: 6px 11px; border-radius: 999px; box-shadow: 0 3px 12px rgba(20,20,30,.28), 0 0 0 1.5px rgba(255,255,255,.85); display: flex; gap: 6px; align-items: center; white-space: nowrap; }
        .pb-spot { position: fixed; border-radius: 14px; box-shadow: 0 0 0 200vmax rgba(12, 12, 24, .52); outline: 2px solid rgba(255,255,255,.55); transition: left .18s ease, top .18s ease, width .18s ease, height .18s ease; z-index: 0; }
        .pb-ping { position: fixed; width: 0; height: 0; pointer-events: none; }
        .pb-ping i { position: absolute; left: -20px; top: -20px; width: 40px; height: 40px; border-radius: 50%; border: 3px solid var(--c); opacity: 0; animation: pbRing 1.4s ease-out infinite; }
        .pb-ping i:nth-child(2) { animation-delay: .25s; } .pb-ping i:nth-child(3) { animation-delay: .5s; }
        @keyframes pbRing { 0% { transform: scale(.2); opacity: .95; } 100% { transform: scale(2.4); opacity: 0; } }
        .pb-pointer.laser svg { display: none; }
        .pb-pointer.laser .dot { position: absolute; left: -9px; top: -9px; width: 18px; height: 18px; border-radius: 50%; background: radial-gradient(circle, #fff 0 22%, #ff2d55 24% 60%, rgba(255,45,85,.0) 72%); box-shadow: 0 0 14px 6px rgba(255,45,85,.55); }
        .pb-pointer.laser .tag { left: 12px; top: 10px; }
        .pb-pointer.presenter svg { transform: scale(1.35); transform-origin: 3px 2px; }
        .pb-pointer.presenter::before { content: ''; position: absolute; left: -22px; top: -22px; width: 44px; height: 44px; border-radius: 50%; background: radial-gradient(circle, color-mix(in srgb, var(--c) 38%, transparent) 0%, transparent 70%); animation: pbHalo 1.8s ease-in-out infinite; }
        @keyframes pbHalo { 0%,100% { transform: scale(.8); opacity: .9; } 50% { transform: scale(1.25); opacity: .45; } }
        @keyframes pbPtrIn { from { opacity: 0; scale: .7; } to { opacity: 1; scale: 1; } }
        @media (prefers-reduced-motion: reduce) { .pb-pointer { transition: none; animation: none; } }
      `}</style>
    </div>,
    document.body
  );
}

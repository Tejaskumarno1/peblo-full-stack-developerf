import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/*
 * Live mouse pointers: where the other people's mouse is over the note, with their name.
 * Shared through the live document's awareness (temporary, never stored). The position is kept
 * relative to the editor column (x as a share of its width, y in pixels from its top), so it lands
 * on the same text whatever the window size or scroll position of each person.
 */
const SEND_MS = 50;

export default function Pointers({ rt, rootRef, ready }) {
  const [pts, setPts] = useState([]); // { key, name, color, x, y }
  const [, bump] = useState(0);

  // publish my pointer
  useEffect(() => {
    const root = rootRef?.current;
    if (!rt || !ready || !root) return undefined;
    const aw = rt.provider.awareness;
    let last = 0;
    let pending = null;
    let timer = null;
    const send = (v) => { try { aw.setLocalStateField('pointer', v); } catch { /* gone */ } };
    const flush = () => { timer = null; if (pending !== null) { send(pending); pending = null; last = Date.now(); } };
    const move = (e) => {
      const ed = root.querySelector('.bn-editor');
      if (!ed) return;
      const r = ed.getBoundingClientRect();
      if (!r.width) return;
      pending = { x: Math.round(((e.clientX - r.left) / r.width) * 1000) / 1000, y: Math.round(e.clientY - r.top) };
      const wait = SEND_MS - (Date.now() - last);
      if (wait <= 0) flush(); else if (!timer) timer = setTimeout(flush, wait);
    };
    const leave = () => { pending = null; clearTimeout(timer); timer = null; send(null); };
    root.addEventListener('pointermove', move, { passive: true });
    root.addEventListener('pointerleave', leave);
    return () => {
      root.removeEventListener('pointermove', move);
      root.removeEventListener('pointerleave', leave);
      clearTimeout(timer);
      send(null);
    };
  }, [rt, ready, rootRef]);

  // read everyone else's
  useEffect(() => {
    if (!rt || !ready) { setPts([]); return undefined; }
    const aw = rt.provider.awareness;
    const read = () => {
      const out = [];
      aw.getStates().forEach((st, id) => {
        if (id === aw.clientID || !st?.user || !st.pointer || typeof st.pointer.x !== 'number') return;
        out.push({ key: id, name: st.user.name || 'Someone', color: st.user.color || '#2563eb', x: st.pointer.x, y: st.pointer.y });
      });
      setPts(out);
    };
    read();
    aw.on('change', read);
    return () => aw.off('change', read);
  }, [rt, ready]);

  // follow the page when it scrolls or resizes
  useEffect(() => {
    if (!pts.length) return undefined;
    let raf = 0;
    const again = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => bump((n) => n + 1)); };
    window.addEventListener('scroll', again, true);
    window.addEventListener('resize', again);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('scroll', again, true); window.removeEventListener('resize', again); };
  }, [pts.length]);

  const root = rootRef?.current;
  const ed = root?.querySelector('.bn-editor');
  if (!ed || !pts.length) return null;
  const r = ed.getBoundingClientRect();
  const vis = root.getBoundingClientRect();
  return createPortal(
    <div className="pb-pointers" aria-hidden="true">
      {pts.map((p) => {
        const left = r.left + p.x * r.width;
        const top = r.top + p.y;
        if (left < vis.left - 4 || left > vis.right + 4 || top < vis.top - 4 || top > vis.bottom + 4) return null;
        return (
          <div key={p.key} className="pb-pointer" data-testid="peer-pointer" data-name={p.name} style={{ transform: `translate(${left}px, ${top}px)`, color: p.color }}>
            <svg width="16" height="20" viewBox="0 0 16 20" fill="currentColor" stroke="#fff" strokeWidth="1.2" strokeLinejoin="round"><path d="M1 1l12 8.6-5.2 1.1 3 6.8-2.6 1.1-3-6.8L1 16z" /></svg>
            <span className="tag" style={{ background: p.color }}>{p.name}</span>
          </div>
        );
      })}
      <style>{`
        .pb-pointers { position: fixed; inset: 0; pointer-events: none; z-index: 1100; overflow: hidden; }
        .pb-pointer { position: absolute; left: 0; top: 0; transition: transform .08s linear; will-change: transform; filter: drop-shadow(0 1px 2px rgba(0,0,0,.25)); }
        .pb-pointer svg { display: block; }
        .pb-pointer .tag { position: absolute; left: 12px; top: 16px; color: #fff; font: 600 11px/1 system-ui, sans-serif; padding: 3px 7px; border-radius: 999px; white-space: nowrap; }
      `}</style>
    </div>,
    document.body
  );
}

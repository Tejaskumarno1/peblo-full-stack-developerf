import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

/* A wrapper the person can drag anywhere on screen. Used for the "who is here" pill.
   The position is kept in this browser; it is clamped so the pill can never be lost off screen.
   Dragging starts after a few pixels of movement, so ordinary clicks on the buttons inside still work. */

const read = (key) => { try { const j = JSON.parse(localStorage.getItem(key) || 'null'); if (j && Number.isFinite(j.x) && Number.isFinite(j.y)) return j; } catch { /* none saved */ } return { x: 0, y: 0 }; };
const write = (key, v) => { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* private window */ } };

export default function DragWrap({ storageKey = 'peblo-presence-pos', className, children, ...rest }) {
  const ref = useRef(null);
  const [off, setOff] = useState(() => read(storageKey));
  const offRef = useRef(off);
  offRef.current = off;
  const drag = useRef(null);
  const [dragging, setDragging] = useState(false);

  // keep the pill fully on screen: after a move, after a resize and on first paint
  const clamp = useCallback((o) => {
    const el = ref.current; if (!el) return o;
    const pill = el.querySelector('.pb-presence') || el;
    const r = pill.getBoundingClientRect();
    if (!r.width) return o;
    const base = { l: r.left - offRef.current.x, t: r.top - offRef.current.y };
    const x = Math.min(Math.max(o.x, 8 - base.l), window.innerWidth - r.width - 8 - base.l);
    const y = Math.min(Math.max(o.y, 8 - base.t), window.innerHeight - r.height - 8 - base.t);
    return { x: Math.round(x), y: Math.round(y) };
  }, []);
  useLayoutEffect(() => { const c = clamp(off); if (c.x !== off.x || c.y !== off.y) setOff(c); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const f = () => setOff((o) => { const c = clamp(o); return c.x === o.x && c.y === o.y ? o : c; });
    window.addEventListener('resize', f);
    return () => window.removeEventListener('resize', f);
  }, [clamp]);

  // the move and release are followed on the window, so the pill keeps up even when the pointer leaves it
  const moveRef = useRef(null);
  const upRef = useRef(null);
  moveRef.current = (e) => {
    const d = drag.current; if (!d) return;
    const dx = e.clientX - d.sx; const dy = e.clientY - d.sy;
    if (!d.on) {
      if (Math.abs(dx) + Math.abs(dy) < 6) return;
      d.on = true; setDragging(true);
    }
    e.preventDefault();
    setOff(clamp({ x: d.ox + dx, y: d.oy + dy }));
  };
  upRef.current = () => {
    const d = drag.current; drag.current = null;
    window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); window.removeEventListener('pointercancel', onUp);
    if (!d || !d.on) return;
    setDragging(false);
    write(storageKey, offRef.current);
    // a drag must not also count as a click on the button it started on
    const swallow = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
    window.addEventListener('click', swallow, { capture: true, once: true });
    setTimeout(() => window.removeEventListener('click', swallow, true), 0);
  };
  const onMove = useRef((e) => moveRef.current(e)).current;
  const onUp = useRef(() => upRef.current()).current;
  useEffect(() => () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); window.removeEventListener('pointercancel', onUp); }, [onMove, onUp]);

  const down = (e) => {
    if (e.button !== 0 || e.target.closest('input, textarea, select')) return;
    drag.current = { sx: e.clientX, sy: e.clientY, ox: offRef.current.x, oy: offRef.current.y, on: false };
    window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp); window.addEventListener('pointercancel', onUp);
  };
  const reset = (e) => {
    if (e.target.closest('button, input, a')) return;
    setOff({ x: 0, y: 0 }); write(storageKey, { x: 0, y: 0 });
  };

  return (
    <div
      {...rest}
      ref={ref}
      className={`${className || ''}${dragging ? ' is-dragging' : ''}`}
      data-draggable="1"
      style={{ ...(rest.style || {}), transform: off.x || off.y ? `translate(${off.x}px, ${off.y}px)` : undefined, touchAction: 'none' }}
      onPointerDown={down}
      onDoubleClick={reset}
    >
      {children}
    </div>
  );
}

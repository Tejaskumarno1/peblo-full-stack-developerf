import { useEffect, useRef } from 'react';
import { previewTheme } from './appearance';

/**
 * FT12 / T20: hovering or focusing a theme card shows that theme on the whole page; leaving the card (or the page
 * unmounting) puts the current choice back. Clicking still applies it through setTheme.
 * `previewProps(id)` gives the four handlers for one card.
 */
export default function useThemePreview(current) {
  const cur = useRef(current);
  cur.current = current;
  const active = useRef(false);
  useEffect(() => () => { if (active.current) previewTheme(null, cur.current); }, []);
  const show = (id) => { active.current = true; previewTheme(id, cur.current); };
  const restore = () => { if (!active.current) return; active.current = false; previewTheme(null, cur.current); };
  return {
    previewProps: (id) => ({ onMouseEnter: () => show(id), onFocus: () => show(id), onMouseLeave: restore, onBlur: restore }),
    endPreview: restore,
  };
}

/** Arrow keys move between the radios of a radiogroup (and choose, as a native radio group does). */
export function radioKeys(e, ids, current, choose) {
  const keys = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
  if (!(e.key in keys) && e.key !== 'Home' && e.key !== 'End') return;
  e.preventDefault();
  const i = Math.max(0, ids.indexOf(current));
  const n = e.key === 'Home' ? 0 : e.key === 'End' ? ids.length - 1 : (i + keys[e.key] + ids.length) % ids.length;
  const group = e.currentTarget;
  choose(ids[n]);
  setTimeout(() => group.querySelector(`[data-theme-id="${ids[n]}"]`)?.focus(), 0);
}

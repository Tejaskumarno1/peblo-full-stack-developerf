import { useEffect } from 'react';

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const shown = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);

/** A dialog or sheet: on open focus moves into it (unless something inside already has it), Tab stays inside when `trap` is set,
 * and on close focus goes back to what had it before. The element should have tabIndex={-1} as a fallback target. */
export function useDialogFocus(ref, trap = false) {
  useEffect(() => {
    const prev = document.activeElement;
    const el = ref.current;
    if (el && !el.contains(document.activeElement)) {
      const first = [...el.querySelectorAll(FOCUSABLE)].find(shown);
      (first || el).focus({ preventScroll: true });
    }
    const onKey = (e) => {
      if (!trap || e.key !== 'Tab' || !el) return;
      const items = [...el.querySelectorAll(FOCUSABLE)].filter(shown);
      if (!items.length) { e.preventDefault(); return; }
      const a = document.activeElement;
      if (e.shiftKey && (a === items[0] || !el.contains(a))) { e.preventDefault(); items[items.length - 1].focus(); }
      else if (!e.shiftKey && (a === items[items.length - 1] || !el.contains(a))) { e.preventDefault(); items[0].focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      if (prev && prev !== document.body && prev.isConnected && typeof prev.focus === 'function') prev.focus({ preventScroll: true });
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}

/** A role="menu" element: the first item gets focus when it opens; Up, Down, Home, End move, Escape closes (and focus goes back). */
export function useMenuNav(ref, onClose) {
  useEffect(() => {
    const prev = document.activeElement;
    const el = ref.current;
    const items = () => [...(el?.querySelectorAll('[role="menuitem"]:not([disabled])') || [])];
    items()[0]?.focus({ preventScroll: true });
    const onKey = (e) => {
      const list = items();
      if (!list.length) return;
      const i = list.indexOf(document.activeElement);
      let to = null;
      if (e.key === 'ArrowDown') to = list[(i + 1) % list.length];
      else if (e.key === 'ArrowUp') to = list[(i - 1 + list.length) % list.length];
      else if (e.key === 'Home') to = list[0];
      else if (e.key === 'End') to = list[list.length - 1];
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose && onClose(); return; }
      if (to) { e.preventDefault(); e.stopPropagation(); to.focus(); }
    };
    el?.addEventListener('keydown', onKey);
    return () => {
      el?.removeEventListener('keydown', onKey);
      const a = document.activeElement;
      if ((!a || a === document.body || el?.contains(a)) && prev && prev.isConnected && typeof prev.focus === 'function') prev.focus({ preventScroll: true });
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}

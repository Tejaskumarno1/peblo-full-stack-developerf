import { useEffect, useRef } from 'react';

const typing = (t) => !!t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable);

/** Keys of the Soft notes list: Escape leaves select mode, Ctrl/Cmd+A selects every shown note while selecting,
 * "/" and Ctrl+Shift+F focus the search box. Ctrl+Shift+F also toggles full screen (FocusMode), so it only searches
 * when focus is in the list or no note is open; from the editor it keeps toggling full screen. */
export function useNotesKeys({ selectMode, sheetOpen, visibleIds, hasDoc, onPickAll, onLeaveSelect }) {
  const s = useRef({});
  s.current = { selectMode, sheetOpen, visibleIds, hasDoc, onPickAll, onLeaveSelect };
  useEffect(() => {
    const focusSearch = () => { const el = document.querySelector('.s-notes-list .s-nsearch input'); if (el) { el.focus(); el.select(); return true; } return false; };
    const k = (e) => {
      const c = s.current;
      const key = e.key;
      if (e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey && (key === 'F' || key === 'f')) {
        const inList = !!document.activeElement?.closest?.('.s-notes-list');
        if ((inList || !c.hasDoc) && !c.selectMode && focusSearch()) { e.preventDefault(); e.stopImmediatePropagation(); }
        return;
      }
      if (key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey && !typing(e.target) && !c.selectMode) {
        if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
        if (focusSearch()) e.preventDefault();
        return;
      }
      if (!c.selectMode) return;
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && (key === 'a' || key === 'A') && !typing(e.target)) { e.preventDefault(); c.onPickAll(c.visibleIds); return; }
      if (key === 'Escape' && !e.defaultPrevented && !c.sheetOpen && !typing(e.target)) c.onLeaveSelect();
    };
    window.addEventListener('keydown', k, true); // capture, and registered before FocusMode's own Ctrl+Shift+F handler
    return () => window.removeEventListener('keydown', k, true);
  }, []);
}

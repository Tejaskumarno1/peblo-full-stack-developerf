import { useState, useEffect, useRef, useCallback } from 'react';
import { writeUnsaved, clearUnsaved } from '../utils/unsavedCopy';

export function useDebounce(value, delay = 500) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

export function useAutoSave(noteId, data, saveFn, delay = 1500, unloadFn = null) {
  const [saveStatus, setSaveStatus] = useState('saved');
  const timeoutRef = useRef(null);
  const lastSavedRef = useRef('');
  const pendingRef = useRef({});
  const saveFnRef = useRef(saveFn);
  const unloadFnRef = useRef(unloadFn);
  const idRef = useRef(noteId);
  const retryRef = useRef({ timer: null, n: 0 });
  const busyRef = useRef(0); // saves in flight: a retry must not start a second save (a draft would be created twice)

  saveFnRef.current = saveFn;
  unloadFnRef.current = unloadFn;
  idRef.current = noteId;

  if (noteId && data) {
    pendingRef.current[noteId] = data;
  } else if (noteId) {
    delete pendingRef.current[noteId]; // nothing to save now (an empty draft, a deleted note): an old copy must not be retried or flushed later
  }

  const writeCopy = (id, payload) => {
    let baseContent = '';
    try { baseContent = JSON.parse(lastSavedRef.current || '{}').content ?? ''; } catch { /* no base */ }
    writeUnsaved(id, { content: payload?.content, title: payload?.title, baseContent });
  };

  const persist = useCallback(async (id, payload) => {
    if (!id || !payload) return false;
    const current = JSON.stringify(payload);
    if (current === lastSavedRef.current) return true;

    setSaveStatus(prev => prev !== 'saving' ? 'saving' : prev);
    busyRef.current += 1;
    try {
      await saveFnRef.current(id, payload);
      clearUnsaved(id, payload?.content); // saved: the local safety copy is not needed any more
      lastSavedRef.current = current;
      delete pendingRef.current[id];
      clearTimeout(retryRef.current.timer); retryRef.current.n = 0;
      setSaveStatus(prev => prev !== 'saved' ? 'saved' : prev);
      return true;
    } catch (err) {
      setSaveStatus(prev => prev !== 'error' ? 'error' : prev);
      console.error('Auto-save failed:', err);
      // try again by itself (5 s, 10 s, 20 s, then every 30 s) while this note is still the open one
      const r = retryRef.current;
      clearTimeout(r.timer);
      r.timer = setTimeout(() => { if (idRef.current === id && pendingRef.current[id] && !busyRef.current) persist(id, pendingRef.current[id]); }, Math.min(30000, 5000 * 2 ** r.n));
      r.n += 1;
      return false;
    } finally {
      busyRef.current -= 1;
    }
  }, []);

  // ONLY initialize when noteId changes, bypassing redundant updates while typing
  useEffect(() => {
    lastSavedRef.current = data ? JSON.stringify(data) : '';
    setSaveStatus(prev => prev !== 'saved' ? 'saved' : prev);
  }, [noteId]);

  // Flush when switching to another note
  useEffect(() => {
    const id = noteId;
    retryRef.current.n = 0;
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      clearTimeout(retryRef.current.timer);
      const pending = pendingRef.current[id];
      if (!id || !pending) return;
      const snapshot = JSON.stringify(pending);
      if (snapshot === lastSavedRef.current) return;
      const flush = (n) => saveFnRef.current(id, pending).catch((err) => {
        console.error('Flush save failed:', err);
        const st = err?.response?.status;
        if (n < 3 && st !== 403 && st !== 404 && st !== 401) setTimeout(() => flush(n + 1), 3000 * (n + 1)); // network, 5xx or 429: try again
      });
      flush(0);
    };
  }, [noteId]);

  useEffect(() => {
    if (!noteId || !data) return;

    const current = JSON.stringify(data);
    if (current === lastSavedRef.current) return;

    // Use functional state updates to prevent extra re-renders on every keystroke
    setSaveStatus(prev => prev !== 'unsaved' ? 'unsaved' : prev);
    
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      persist(noteId, data);
    }, delay);
    // keep a local copy while this is unsaved, so a failed save, a dead connection or a closed window cannot lose it
    const copyTimer = setTimeout(() => writeCopy(noteId, data), 400);

    return () => {
      clearTimeout(copyTimer);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [data, noteId, delay, persist]);

  useEffect(() => {
    const onLeave = () => {
      if (!noteId || !data) return;
      const current = JSON.stringify(data);
      if (current === lastSavedRef.current) return;
      // a normal request is cancelled when the window closes; the unload version is sent with keepalive so it still goes out
      if (unloadFnRef.current && unloadFnRef.current(noteId, data)) return;
      writeCopy(noteId, data); // too big for the last-chance request (about 55 KB) or none: keep it here; the next open restores it
      persist(noteId, data);
    };
    window.addEventListener('beforeunload', onLeave);
    return () => window.removeEventListener('beforeunload', onLeave);
  }, [noteId, data, persist]);

  const forceSave = useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    const id = noteId;
    const payload = pendingRef.current[id] ?? data;
    return persist(id, payload);
  }, [noteId, data, persist]);

  return { saveStatus, forceSave };
}

export function useKeyboardShortcut(key, callback, modifiers = { ctrl: false, shift: false }) {
  const cbRef = useRef(callback);
  const modRef = useRef(modifiers);

  useEffect(() => {
    cbRef.current = callback;
    modRef.current = modifiers;
  });

  useEffect(() => {
    function handler(e) {
      const mods = modRef.current;
      // Exact modifier match: Ctrl+Shift+S must not fire the Ctrl+S handler, Alt+K must not fire K (PEB-78)
      if (!!mods.ctrl !== (e.ctrlKey || e.metaKey)) return;
      if (!!mods.shift !== e.shiftKey) return;
      if (!!mods.alt !== e.altKey) return;
      if ((e.key || '').toLowerCase() === key.toLowerCase()) {
        e.preventDefault();
        e.stopPropagation();
        cbRef.current();
      }
    }
    window.addEventListener('keydown', handler, { capture: true });
    return () => window.removeEventListener('keydown', handler, { capture: true });
  }, [key]);
}

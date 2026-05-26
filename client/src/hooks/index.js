import { useState, useEffect, useRef, useCallback } from 'react';

export function useDebounce(value, delay = 500) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

export function useAutoSave(noteId, data, saveFn, delay = 1500) {
  const [saveStatus, setSaveStatus] = useState('saved');
  const timeoutRef = useRef(null);
  const lastSavedRef = useRef('');
  const pendingRef = useRef({});
  const saveFnRef = useRef(saveFn);

  saveFnRef.current = saveFn;

  if (noteId && data) {
    pendingRef.current[noteId] = data;
  }

  const persist = useCallback(async (id, payload) => {
    if (!id || !payload) return false;
    const current = JSON.stringify(payload);
    if (current === lastSavedRef.current) return true;

    setSaveStatus('saving');
    try {
      await saveFnRef.current(id, payload);
      lastSavedRef.current = current;
      setSaveStatus('saved');
      return true;
    } catch (err) {
      setSaveStatus('error');
      console.error('Auto-save failed:', err);
      return false;
    }
  }, []);

  useEffect(() => {
    lastSavedRef.current = data ? JSON.stringify(data) : '';
    setSaveStatus('saved');
  }, [noteId, data]);

  // Flush when switching to another note
  useEffect(() => {
    const id = noteId;
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      const pending = pendingRef.current[id];
      if (!id || !pending) return;
      const snapshot = JSON.stringify(pending);
      if (snapshot === lastSavedRef.current) return;
      saveFnRef.current(id, pending).catch((err) => {
        console.error('Flush save failed:', err);
      });
    };
  }, [noteId]);

  useEffect(() => {
    if (!noteId || !data) return;

    const current = JSON.stringify(data);
    if (current === lastSavedRef.current) return;

    setSaveStatus('unsaved');
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      persist(noteId, data);
    }, delay);

    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [data, noteId, delay, persist]);

  useEffect(() => {
    const onLeave = () => {
      if (!noteId || !data) return;
      const current = JSON.stringify(data);
      if (current === lastSavedRef.current) return;
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
      if (mods.ctrl && !(e.ctrlKey || e.metaKey)) return;
      if (mods.shift && !e.shiftKey) return;
      if (e.key.toLowerCase() === key.toLowerCase()) {
        e.preventDefault();
        e.stopPropagation();
        cbRef.current();
      }
    }
    window.addEventListener('keydown', handler, { capture: true });
    return () => window.removeEventListener('keydown', handler, { capture: true });
  }, [key]);
}

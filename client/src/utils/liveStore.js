import { useSyncExternalStore } from 'react';

/** What the notes editor knows about the open note's share link (written by LiveEditors, read by the header chips). */
let state = { noteId: null, shared: false, token: null, canEdit: false, expiresAt: null, viewers: [], open: false, offline: false };
const subs = new Set();
export const getLive = () => state;
export const setLive = (patch) => { state = { ...state, ...patch }; subs.forEach((fn) => fn()); };
const subscribe = (fn) => { subs.add(fn); return () => { subs.delete(fn); }; };
export const useLive = () => useSyncExternalStore(subscribe, getLive, getLive);

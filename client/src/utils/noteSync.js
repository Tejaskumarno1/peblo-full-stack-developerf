import { notesAPI } from '../api';
import api from '../api/client';
import { authHeaders } from '../api/token';
import { getSpace } from '../api/space';

/*
 * Safe saving for notes that someone else may be editing too (a shared link, another window).
 * We remember the text each open note was loaded or last saved with. Every save sends it along, so the server can
 * merge the two people's changes instead of letting the last save win. When the server had to merge, the combined
 * text comes back and an 'pb-note-merged' event tells the open editor to show it.
 */
const bases = new Map();

// The space (null = Personal) each open note was loaded in. A save is always sent to that space, so switching space
// while the last words are still on their way can never send them to the wrong place (where they would 404 and be lost).
const noteSpaces = new Map();
export const rememberNoteSpace = (id, space = getSpace()) => { if (id) noteSpaces.set(id, space || null); };
export const noteSpaceCfg = (id) => (noteSpaces.has(id) ? { spaceOverride: noteSpaces.get(id) } : undefined);

// The page that has a note open registers a function that saves it now; "Move to a team" and the like call it first.
let flusher = null;
export const setNoteFlusher = (fn) => { flusher = fn; };
export const flushOpenNote = async () => { try { if (flusher) await flusher(); } catch { /* the save status already says so */ } };

export const setNoteBase = (id, updatedAt, content) => { if (id && updatedAt) bases.set(id, { updatedAt, content: content ?? '' }); };
export const getNoteBase = (id) => bases.get(id);

// Notes open in a live room (Yjs): the editor already holds everyone's merged text, so a save replaces the saved copy.
// state: 'live' (connected and in step) or 'wait' (the room is opening, reopening or the connection is down)
const live = new Map();
export const setNoteLive = (id, state) => { if (id) { if (state) live.set(id, state); else live.delete(id); } };
export const isNoteLive = (id) => live.has(id);
// Text put into a note from outside the editor (a template, find and replace, a restored version) is not in the live room,
// and the editor that is mounted next shows the room's text, not the page's. The page leaves the new text here; the editor
// puts it into the room once the room is ready, as an ordinary edit everyone sees, and it is then saved like any typing.
const external = new Map();
export const markExternalEdit = (id, content) => { if (id && typeof content === 'string') external.set(id, { content, at: Date.now() }); };
export const peekExternalEdit = (id) => { const e = external.get(id); return e && Date.now() - e.at < 30000 ? e.content : null; };
export const clearExternalEdit = (id) => { external.delete(id); };
/** While the room is not ready, a save would write a copy that is not in step with it: wait (up to 20 s) until it is. */
async function whileWaiting(id) {
  for (let i = 0; i < 130 && live.get(id) === 'wait'; i++) await new Promise((r) => setTimeout(r, 150));
}

// Saves of one note run one after another: a last save sent while an earlier one is still on its way (the editor leaving a
// note) must be built from the base that earlier save leaves, and must reach the server after it. A request that hangs does
// not block the next one for more than CHAIN_WAIT_MS, and a failed save never blocks it.
const CHAIN_WAIT_MS = 30000;
const chains = new Map();
export function saveNoteSafe(id, payload) {
  const prev = chains.get(id);
  const run = (prev ? Promise.race([prev, new Promise((r) => setTimeout(r, CHAIN_WAIT_MS))]) : Promise.resolve()).then(() => saveNoteSafeNow(id, payload));
  const mine = run.catch(() => {});
  chains.set(id, mine);
  mine.then(() => { if (chains.get(id) === mine) chains.delete(id); });
  return run;
}

// Final texts that are on their way (id -> text), and when each note last had one saved.
const finalPending = new Map();
const finalDone = new Map();
/** The text of a note that was typed just before leaving it and is not saved yet: reopening the note shows it, not the older cached text. */
export const peekFinalText = (id) => finalPending.get(id);
/** True when a final text for this note reached the server after `since` (an older retry must then not be sent). */
export const finalSavedSince = (id, since) => (finalDone.get(id) || 0) >= since;

/** The text typed in the last moments before the editor left a note (its change timer never ran). Saved in that note's own space
 * and the cached lists are told, so reopening the note at once shows it. Content only: the title and tags are left alone.
 * Returns true (saved), 'rejected' (the server refused: no access, gone; nothing to keep) or false (not sent: keep a local copy).
 * Never sent without a base: a save that does not say what it started from would overwrite newer server text. */
export async function saveFinalText(id, content) {
  if (!id || id === '__draft__' || typeof content !== 'string') return false;
  if (!bases.has(id) || live.has(id)) return false; // no base to merge against, or a live room owns the text
  finalPending.set(id, content);
  try {
    const data = await saveNoteSafe(id, { content });
    finalDone.set(id, Date.now());
    window.dispatchEvent(new CustomEvent('pb-note-final', { detail: { id, content, updatedAt: data?.updatedAt } }));
    return true;
  } catch (e) {
    const st = e?.response?.status;
    return st === 401 || st === 403 || st === 404 || st === 410 ? 'rejected' : false;
  } finally {
    if (finalPending.get(id) === content) finalPending.delete(id);
  }
}

async function saveNoteSafeNow(id, payload) {
  if (typeof payload.content === 'string') await whileWaiting(id);
  const base = bases.get(id);
  const hasText = typeof payload.content === 'string';
  const body = live.get(id) === 'live' && hasText
    ? { ...payload, collab: true, baseUpdatedAt: base?.updatedAt || new Date().toISOString() }
    : base && hasText ? { ...payload, baseUpdatedAt: base.updatedAt, baseContent: base.content, keepBoth: true } : payload;
  const { data } = await notesAPI.update(id, body, noteSpaceCfg(id));
  if (hasText && data?.updatedAt) {
    if (typeof data.content === 'string' && data.status && data.status !== 'saved') {
      // Merged with someone else's edit. Our text is now the base but the time stays old, so a later save still merges
      // until the editor shows the merged text (see applyMerged).
      if (base) bases.set(id, { updatedAt: base.updatedAt, content: payload.content });
      window.dispatchEvent(new CustomEvent('pb-note-merged', { detail: { id, sent: payload.content, content: data.content, updatedAt: data.updatedAt, status: data.status } }));
    } else {
      bases.set(id, { updatedAt: data.updatedAt, content: payload.content });
    }
  }
  return data;
}

/** Call once the editor has swapped to the merged text. */
export const applyMerged = (detail) => setNoteBase(detail.id, detail.updatedAt, detail.content);

/**
 * Last-chance save while the window is closing. A normal request is cancelled then, so this one is sent with `keepalive`
 * (the browser finishes it after the page is gone). Returns true when it was sent. Browsers refuse a keepalive body over
 * about 60 KB; then it returns false and the caller falls back to the normal save.
 */
export function saveNoteOnUnload(id, payload) {
  try {
    if (!id || id === '__draft__' || typeof payload?.content !== 'string') return false;
    const base = bases.get(id);
    const body = live.get(id) === 'live'
      ? { ...payload, title: payload.title || 'Untitled', collab: true, baseUpdatedAt: base?.updatedAt || new Date().toISOString() }
      : base ? { ...payload, title: payload.title || 'Untitled', baseUpdatedAt: base.updatedAt, baseContent: base.content, keepBoth: true } : { ...payload, title: payload.title || 'Untitled' };
    const text = JSON.stringify(body);
    if (text.length > 55000) return false;
    fetch(`${api.defaults.baseURL}/notes/${encodeURIComponent(id)}`, { method: 'PATCH', keepalive: true, headers: authHeaders({ 'Content-Type': 'application/json', ...(((noteSpaces.has(id) ? noteSpaces.get(id) : getSpace()) || null) ? { 'x-peblo-space': noteSpaces.has(id) ? noteSpaces.get(id) : getSpace() } : {}) }), body: text }); // same headers as axios: a team note is saved in its own space
    return true;
  } catch { return false; }
}

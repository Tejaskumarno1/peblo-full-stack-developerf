import { notesAPI } from '../api';

/*
 * Safe saving for notes that someone else may be editing too (a shared link, another window).
 * We remember the text each open note was loaded or last saved with. Every save sends it along, so the server can
 * merge the two people's changes instead of letting the last save win. When the server had to merge, the combined
 * text comes back and an 'pb-note-merged' event tells the open editor to show it.
 */
const bases = new Map();

export const setNoteBase = (id, updatedAt, content) => { if (id && updatedAt) bases.set(id, { updatedAt, content: content ?? '' }); };
export const getNoteBase = (id) => bases.get(id);

// Notes open in a live room (Yjs): the editor already holds everyone's merged text, so a save replaces the saved copy.
// state: 'live' (connected and in step) or 'wait' (the room is opening, reopening or the connection is down)
const live = new Map();
export const setNoteLive = (id, state) => { if (id) { if (state) live.set(id, state); else live.delete(id); } };
export const isNoteLive = (id) => live.has(id);
// Text put into a note from outside the editor (a template, find and replace) is not in the live room. The next save of that
// note must go through the ordinary route, which makes the server reset the room from the new text; a live-room save
// ("collab: true") would leave the room, and with it the editor, on the old text, and the editor would then write that back.
const external = new Set();
export const markExternalEdit = (id) => { if (id) external.add(id); };
/** While the room is not ready, a save would write a copy that is not in step with it: wait (up to 20 s) until it is. */
async function whileWaiting(id) {
  for (let i = 0; i < 130 && live.get(id) === 'wait'; i++) await new Promise((r) => setTimeout(r, 150));
}

export async function saveNoteSafe(id, payload) {
  if (typeof payload.content === 'string') await whileWaiting(id);
  const base = bases.get(id);
  const hasText = typeof payload.content === 'string';
  const fromOutside = hasText && external.delete(id);
  const body = live.get(id) === 'live' && hasText && !fromOutside
    ? { ...payload, collab: true, baseUpdatedAt: base?.updatedAt || new Date().toISOString() }
    : base && hasText ? { ...payload, baseUpdatedAt: base.updatedAt, baseContent: base.content, keepBoth: true } : payload;
  const { data } = await notesAPI.update(id, body);
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

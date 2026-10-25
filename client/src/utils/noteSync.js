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

export async function saveNoteSafe(id, payload) {
  const base = bases.get(id);
  const hasText = typeof payload.content === 'string';
  const body = base && hasText ? { ...payload, baseUpdatedAt: base.updatedAt, baseContent: base.content, keepBoth: true } : payload;
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

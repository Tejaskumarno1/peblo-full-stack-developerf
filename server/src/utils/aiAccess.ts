import prisma from '../db.js';

/**
 * What an AI feature may read or change (PEB-64).
 *  - Notes in the Trash are gone as far as the assistant is concerned.
 *  - Notes tagged #private are never sent to any model.
 *  - A model may add to or rewrite only the note the person picked; for any other note it can only suggest,
 *    and the person has to say yes.
 */
export const PRIVATE_TAG = 'private';
export const PRIVATE_MESSAGE = 'This note is #private, so Peblo does not show it to any AI.';

/** The notes an AI feature may look at: not in the Trash and not #private. */
export function aiReadableWhere(userId: string) {
  return { userId, isDeleted: false, deletedAt: null, tags: { none: { tag: { name: PRIVATE_TAG } } } };
}

export type NoteAiAccess = 'ok' | 'missing' | 'private';

/** Whether this person's note exists (and is not in the Trash), and whether an AI may read it. */
export async function noteAiAccess(userId: string, noteId: string): Promise<NoteAiAccess> {
  const note = await prisma.note.findFirst({
    where: { id: noteId, userId, isDeleted: false, deletedAt: null },
    select: { tags: { select: { tag: { select: { name: true } } } } },
  });
  if (!note) return 'missing';
  return note.tags.some((t) => t.tag.name === PRIVATE_TAG) ? 'private' : 'ok';
}

export interface PlannedUpdate { noteId?: string | null; appendContent?: string | null; replaceContent?: string | null }
export interface SuggestedUpdate { noteId: string; title: string; appendContent: string | null; replaceContent: string | null }

/**
 * The model planned a change to an existing note. Apply it only when it is the note the person chose
 * (the chat on that note); a change to any other note comes back as a suggestion to confirm.
 * A note the model was not offered (private, in the Trash, or made up) is dropped.
 */
export function decideChatUpdate(opts: {
  targetNoteId?: string | null;
  plan?: PlannedUpdate | null;
  offered: { id: string; title: string }[];
}): { apply: { noteId: string; appendContent: string | null; replaceContent: string | null } | null; suggest: SuggestedUpdate | null } {
  const p = opts.plan;
  const append = p?.appendContent?.trim() ? p.appendContent : null;
  const replace = p?.replaceContent?.trim() ? p.replaceContent : null;
  if (!p?.noteId || (!append && !replace)) return { apply: null, suggest: null };
  if (opts.targetNoteId && p.noteId === opts.targetNoteId) {
    return { apply: { noteId: p.noteId, appendContent: append, replaceContent: replace }, suggest: null };
  }
  const offered = opts.offered.find((n) => n.id === p.noteId);
  if (!offered) return { apply: null, suggest: null };
  return { apply: null, suggest: { noteId: offered.id, title: offered.title, appendContent: append, replaceContent: replace } };
}

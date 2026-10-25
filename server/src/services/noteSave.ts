import DiffMatchPatch from 'diff-match-patch';
import prisma from '../db.js';
import { saveVersion } from './noteVersions.js';
import { invalidateNote } from './collab.js';

/*
 * Saving a note when more than one person (or window) may be editing it.
 *
 * The editor sends the text it started from (baseContent / baseUpdatedAt) next to its new text. If nobody saved in
 * between, the new text is simply stored. If somebody did, the changes this editor made (base -> new) are re-applied
 * on top of the latest saved text, so both people's edits survive. Only when the two edits touch the very same words
 * is the save refused (or, with keepBoth, both texts are kept one after the other). The write itself is conditional
 * on the note not having changed again, so two saves at the same instant can never overwrite each other.
 */

const dmp = new DiffMatchPatch();
// strict on purpose: a change is only re-applied where its surrounding text still matches. Otherwise it is a clash
// (shown to the person), never guessed into unrelated text.
dmp.Match_Threshold = 0.1;
dmp.Patch_DeleteThreshold = 0.1;
const MAX_MERGE_CHARS = 3_000_000;

/** Re-apply what `mine` changed relative to `base` on top of `theirs`. ok=false when a change cannot be placed safely. */
export function mergeText(base: string, theirs: string, mine: string): { ok: boolean; text: string } {
  if (mine === base || mine === theirs) return { ok: true, text: theirs };
  if (theirs === base) return { ok: true, text: mine };
  if (base.length + theirs.length + mine.length > MAX_MERGE_CHARS) return { ok: false, text: theirs };
  const patches = dmp.patch_make(base, mine);
  const [text, applied] = dmp.patch_apply(patches, theirs);
  return { ok: applied.every(Boolean), text };
}

export const KEEP_BOTH_DIVIDER = '\n\n---\n\n**Another edit clashed with this one. This is the other version, tidy up and delete what you do not need:**\n\n';

export type SaveInput = {
  content: string;
  title?: string;
  baseUpdatedAt?: string | Date | null;
  baseContent?: string | null;
  force?: boolean;
  keepBoth?: boolean;
  /** The save comes from an editor in a live room (it already holds everyone's merged text). */
  collab?: boolean;
  /** Who is saving (shown in the version history). */
  by?: string;
};
export type SaveResult =
  | { status: 'saved' | 'merged' | 'clash'; content: string; updatedAt: Date }
  | { status: 'conflict'; latest: { title: string; content: string; updatedAt: Date } }
  | { status: 'missing' };

/** `where` must pin the note (id, and userId for the owner; a share token for guests). */
export async function saveNoteMerged(where: Record<string, unknown>, input: SaveInput): Promise<SaveResult> {
  const baseTime = input.baseUpdatedAt ? new Date(input.baseUpdatedAt).getTime() : null;
  for (let attempt = 0; attempt < (input.force || input.collab ? 8 : 4); attempt++) {
    const cur = await prisma.note.findFirst({ where: where as any, select: { id: true, title: true, content: true, updatedAt: true } });
    if (!cur) return { status: 'missing' };

    let next = input.content;
    let status: 'saved' | 'merged' | 'clash' = 'saved';
    const someoneSavedSince = baseTime !== null && baseTime < cur.updatedAt.getTime() && cur.content !== input.content;
    if (someoneSavedSince && !input.force) {
      const merged = typeof input.baseContent === 'string' ? mergeText(input.baseContent, cur.content, input.content) : { ok: false, text: cur.content };
      if (merged.ok) { next = merged.text; status = 'merged'; }
      else if (input.keepBoth) { next = cur.content + KEEP_BOTH_DIVIDER + input.content; status = 'clash'; }
      else return { status: 'conflict', latest: { title: cur.title, content: cur.content, updatedAt: cur.updatedAt } };
    }

    const titleChanged = typeof input.title === 'string' && input.title.slice(0, 300) !== cur.title;
    if (next === cur.content && !titleChanged) return { status, content: next, updatedAt: cur.updatedAt }; // nothing to write

    // conditional write: only if nobody saved since we read the note
    const done = await prisma.note.updateMany({
      where: { id: cur.id, updatedAt: cur.updatedAt },
      data: { content: next, ...(titleChanged ? { title: (input.title as string).slice(0, 300) || 'Untitled' } : {}) },
    });
    if (done.count === 1) {
      // A save that did not come from a live editor changes the text under any open live room: reset it.
      if (!input.collab && next !== cur.content) invalidateNote(cur.id, next);
      // keep the text we replaced (always when a merge happened, otherwise at most every 10 minutes)
      if (cur.content !== next) await saveVersion(cur.id, cur.content, { force: status !== 'saved', by: input.by }).catch(() => {});
      const fresh = await prisma.note.findUnique({ where: { id: cur.id }, select: { updatedAt: true } });
      return { status, content: next, updatedAt: fresh?.updatedAt ?? new Date() };
    }
    // lost a race with another save: read again and merge on top of it
  }
  const last = await prisma.note.findFirst({ where: where as any, select: { id: true, title: true, content: true, updatedAt: true } });
  if (!last) return { status: 'missing' };
  if (input.force || input.collab) {
    // Several live editors save the same merged text at once and keep beating each other to the conditional write.
    // Their text is the merged truth, so write it without the condition instead of reporting a conflict nobody can resolve.
    const titleChanged = typeof input.title === 'string' && input.title.slice(0, 300) !== last.title;
    await prisma.note.updateMany({ where: { id: last.id }, data: { content: input.content, ...(titleChanged ? { title: (input.title as string).slice(0, 300) || 'Untitled' } : {}) } });
    if (!input.collab && input.content !== last.content) invalidateNote(last.id, input.content);
    const fresh = await prisma.note.findUnique({ where: { id: last.id }, select: { updatedAt: true } });
    return { status: 'saved', content: input.content, updatedAt: fresh?.updatedAt ?? new Date() };
  }
  return { status: 'conflict', latest: last };
}

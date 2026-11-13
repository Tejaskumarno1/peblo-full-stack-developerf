import prisma from '../db.js';

/*
 * A note shared into a team (meta.teamShare) can carry a to-do list: the tasks linked to it. When every one of them is finished the note gets
 * a "Done" tag, and when a task is reopened, or added so that something is open again, the tag goes. The tag belongs to the author.
 * Nothing here runs for a note that was not shared this way, so an ordinary team note with a linked task is never tagged behind anyone's back.
 */
export const DONE_TAG = 'Done';

export type Progress = { total: number; done: number };

export async function progressOf(noteId: string): Promise<Progress> {
  const r = (await prisma.$queryRaw<{ total: number; done: number }[]>`SELECT count(*)::int AS total, (count(*) FILTER (WHERE is_completed))::int AS done FROM todos WHERE linked_note_id = ${noteId}`)[0];
  return { total: r?.total ?? 0, done: r?.done ?? 0 };
}

/** Brings the Done tag in line with the tasks. Returns true when the note is Done now, false when it is not, null when the note is not a shared one. */
export async function syncDoneTag(noteId: string | null | undefined): Promise<boolean | null> {
  if (!noteId) return null;
  // Raw SQL on purpose: the Prisma client scopes plain note lookups to one space, and this one has to see a team note from anywhere.
  const note = (await prisma.$queryRaw<{ userId: string }[]>`SELECT user_id AS "userId" FROM notes WHERE id = ${noteId} AND NOT is_deleted AND space_id IS NOT NULL AND meta -> 'teamShare' IS NOT NULL`)[0];
  if (!note) return null;
  const { total, done } = await progressOf(noteId);
  const isDone = total > 0 && done === total;
  if (isDone) {
    const tag = await prisma.tag.upsert({ where: { userId_name: { userId: note.userId, name: DONE_TAG } }, create: { userId: note.userId, name: DONE_TAG }, update: {} });
    await prisma.noteTag.upsert({ where: { noteId_tagId: { noteId, tagId: tag.id } }, create: { noteId, tagId: tag.id }, update: {} });
  } else {
    const tag = await prisma.tag.findUnique({ where: { userId_name: { userId: note.userId, name: DONE_TAG } }, select: { id: true } });
    if (tag) await prisma.noteTag.deleteMany({ where: { noteId, tagId: tag.id } });
  }
  return isDone;
}

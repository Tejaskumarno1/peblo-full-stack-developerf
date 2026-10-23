import prisma from '../db.js';

/*
 * Note version history (PEB-83).
 * A version is a saved copy of a note's text. Ordinary edits save one at most every 10 minutes; an AI change or a
 * restore always saves one first (force). Each note keeps its newest 50 versions.
 */
export const VERSION_GAP_MS = 10 * 60 * 1000;
export const VERSIONS_KEPT = 50;

/** Saves `content` as a version of the note. Returns true when a version was written. */
export async function saveVersion(noteId: string, content: string, opts: { force?: boolean } = {}): Promise<boolean> {
  if (!content || !content.trim()) return false;
  const latest = await prisma.noteBackup.findFirst({ where: { noteId }, orderBy: { createdAt: 'desc' }, select: { content: true, createdAt: true } });
  if (latest && latest.content === content) return false; // nothing new to keep
  if (!opts.force && latest && Date.now() - latest.createdAt.getTime() < VERSION_GAP_MS) return false;
  await prisma.noteBackup.create({ data: { noteId, content } });
  const extra = await prisma.noteBackup.findMany({ where: { noteId }, orderBy: { createdAt: 'desc' }, skip: VERSIONS_KEPT, select: { id: true } });
  if (extra.length) await prisma.noteBackup.deleteMany({ where: { id: { in: extra.map((b) => b.id) } } });
  return true;
}

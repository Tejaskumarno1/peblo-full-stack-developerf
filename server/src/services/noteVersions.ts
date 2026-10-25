import prisma from '../db.js';

/*
 * Note version history (PEB-83).
 * A version is a saved copy of a note's text. Ordinary edits save one at most every 10 minutes; an AI change or a
 * restore always saves one first (force). Each note keeps its newest 50 versions.
 */
export const VERSION_GAP_MS = 10 * 60 * 1000;
export const VERSIONS_KEPT = 50;

/** Saves `content` as a version of the note. Returns true when a version was written. */
export async function saveVersion(noteId: string, content: string, opts: { force?: boolean; by?: string } = {}): Promise<boolean> {
  if (!content || !content.trim()) return false;
  const latest = await prisma.noteBackup.findFirst({ where: { noteId }, orderBy: { createdAt: 'desc' }, select: { content: true, createdAt: true } });
  if (latest && latest.content === content) return false; // nothing new to keep
  if (!opts.force && latest && Date.now() - latest.createdAt.getTime() < VERSION_GAP_MS) return false;
  const made = await prisma.noteBackup.create({ data: { noteId, content }, select: { id: true } });
  if (opts.by) await prisma.$executeRawUnsafe('UPDATE note_backups SET saved_by = $1 WHERE id = $2', opts.by.slice(0, 40), made.id).catch(() => {});
  // named versions are kept for good; only the unnamed ones are trimmed
  await prisma.$executeRawUnsafe(
    'DELETE FROM note_backups WHERE note_id = $1 AND label IS NULL AND id NOT IN (SELECT id FROM note_backups WHERE note_id = $1 AND label IS NULL ORDER BY created_at DESC LIMIT $2)',
    noteId, VERSIONS_KEPT,
  ).catch(() => {});
  return true;
}

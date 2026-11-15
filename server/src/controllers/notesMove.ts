import prisma from '../db.js';
import { can, spaceAccess } from '../utils/access.js';
import { noteScope } from '../utils/scope.js';

/* Moving a note between Personal and spaces, and sharing a copy into one. Mockups A05 to A07b. */

type Target = { spaceId: string | null } | null;

/** Where the note is going: Personal (null) or a space the person can write in. Answers 400/403/404 itself and returns null on failure. */
async function target(req: any, res: any): Promise<Target> {
  const to = req.body?.to;
  if (to === null || to === 'personal') return { spaceId: null };
  if (typeof to !== 'string' || !to) { res.status(400).json({ error: 'Choose where it should go.' }); return null; }
  const acc = await spaceAccess(req.user.id, to);
  if (!acc) { res.status(404).json({ error: 'Space not found.' }); return null; }
  if (!can('space.write', acc.org, acc.role)) { res.status(403).json({ error: 'You can read that space but not add to it.' }); return null; }
  return { spaceId: to };
}

/** Move a note. Its tasks, images and comments go with it. Links to notes left behind are dropped. Undo is a move back. */
export async function moveNote(req: any, res: any, next: any) {
  try {
    if (req.user.viaToken) return res.status(403).json({ error: 'Not allowed with an access token.' });
    const own = await noteScope(req, res, 'manage');
    if (!own) return;
    const note = await prisma.note.findFirst({ where: { id: req.params.id, isDeleted: false, ...own }, select: { id: true, userId: true, spaceId: true } });
    if (!note) return res.status(404).json({ error: 'Note not found.' });
    const to = await target(req, res);
    if (!to) return;
    if ((note.spaceId ?? null) === to.spaceId) return res.status(400).json({ error: 'It is already there.' });
    if (to.spaceId === null && note.userId !== req.user.id) return res.status(403).json({ error: 'Only the person who wrote a note can move it into their Personal space.' });
    const id = note.id;
    const dest = to.spaceId;
    const [, , , tasks] = await prisma.$transaction([
      prisma.$executeRaw`UPDATE notes SET space_id = ${dest}, office_everyone = NULL WHERE id = ${id}`,
      prisma.$executeRaw`DELETE FROM note_access WHERE note_id = ${id}`,
      prisma.$executeRaw`DELETE FROM note_links l USING notes o WHERE ((l.source_id = ${id} AND o.id = l.target_id) OR (l.target_id = ${id} AND o.id = l.source_id)) AND o.space_id IS DISTINCT FROM ${dest}`,
      prisma.$executeRaw`UPDATE todos SET space_id = ${dest}, assignee_id = CASE WHEN ${dest}::text IS NOT NULL AND assignee_id IN (SELECT user_id FROM space_members WHERE space_id = ${dest}) THEN assignee_id ELSE NULL END
        WHERE linked_note_id = ${id} AND (${dest}::text IS NOT NULL OR user_id = ${req.user.id})`,
    ]);
    const io = req.app.get('io');
    if (io) io.to(req.user.id).emit('notes_changed');
    res.json({ ok: true, from: note.spaceId ?? null, to: dest, tasksMoved: Number(tasks) });
  } catch (error) { next(error); }
}

/** Share a copy: the original stays where it is; a new note with the same words lands in the chosen space. */
export async function copyNote(req: any, res: any, next: any) {
  try {
    if (req.user.viaToken) return res.status(403).json({ error: 'Not allowed with an access token.' });
    const own = await noteScope(req, res, 'read');
    if (!own) return;
    const note = await prisma.note.findFirst({ where: { id: req.params.id, isDeleted: false, ...own } });
    if (!note) return res.status(404).json({ error: 'Note not found.' });
    const to = await target(req, res);
    if (!to) return;
    const copy = await prisma.note.create({
      data: { userId: req.user.id, spaceId: to.spaceId, title: note.title, content: note.content, category: note.category },
      select: { id: true, title: true },
    });
    const io = req.app.get('io');
    if (io) io.to(req.user.id).emit('notes_changed');
    res.status(201).json({ ok: true, note: copy });
  } catch (error) { next(error); }
}

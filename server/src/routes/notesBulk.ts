import { Router } from 'express';
import { z } from 'zod';
import prisma from '../db.js';
import { authenticate } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { noteScope } from '../utils/scope.js';
import { can, spaceAccess } from '../utils/access.js';
import { isOffice } from '../utils/noteAccess.js';
import { notify } from '../utils/notify.js';
import { scrub } from '../utils/meta.js';
import { TRASH_RETENTION_MS } from '../controllers/notesController.js';

/*
 * Notes actions that touch many notes at once, each in ONE request and ONE transaction, so a failure half-way can never leave
 * notes split between two states (ISSUES N4, N49):
 *   POST /notes/folders/rename { from, to }  every note of the caller in the current space that is in folder `from` moves to `to`
 *   POST /notes/folders/clear  { name }      the same notes leave the folder (the folder was deleted)
 *   GET  /notes/trash/info                   how long the Trash keeps notes here
 *   POST /notes/trash/empty                  deletes the Trash of the current space for good
 *   POST /notes/trash/restore                puts every note of the Trash back
 * The space comes from the x-peblo-space header (noteScope), exactly as for one note. Mounted before routes/notes.ts.
 */
const router = Router();
router.use(authenticate);

// The same rule as meta.folder in cleanNoteMeta: trimmed, at most 60 characters.
const folderName = z.string().transform((s) => scrub(s).trim().slice(0, 60)).refine((s) => s.length > 0, 'Give the folder a name.');
const renameBody = z.object({ from: folderName, to: folderName });
const clearBody = z.object({ name: folderName });

/** The space of this request (null = Personal), after noteScope checked the person may write there. */
async function writableSpace(req: any, res: any): Promise<{ space: string | null } | null> {
  const own = await noteScope(req, res, 'write');
  if (!own) return null;
  return { space: 'spaceId' in own ? own.spaceId : null };
}

router.post('/folders/rename', validate({ body: renameBody }), async (req: any, res, next) => {
  try {
    if (req.user.viaToken) return res.status(403).json({ error: 'Not allowed with an access token.' });
    const sc = await writableSpace(req, res); if (!sc) return;
    const { from, to } = req.body as { from: string; to: string };
    if (from === to) return res.json({ ok: true, count: 0 });
    // Only the caller's own notes: folders are kept per person (settings.noteFolders). The "last edited" time is not changed.
    const [count] = await prisma.$transaction([
      prisma.$executeRaw`UPDATE notes SET meta = jsonb_set(COALESCE(meta, '{}'::jsonb), '{folder}', to_jsonb(${to}::text))
        WHERE user_id = ${req.user.id} AND space_id IS NOT DISTINCT FROM ${sc.space} AND meta->>'folder' = ${from}`,
    ]);
    if (count) notify(req, 'notes_changed');
    res.json({ ok: true, count: Number(count) });
  } catch (e) { next(e); }
});

router.post('/folders/clear', validate({ body: clearBody }), async (req: any, res, next) => {
  try {
    if (req.user.viaToken) return res.status(403).json({ error: 'Not allowed with an access token.' });
    const sc = await writableSpace(req, res); if (!sc) return;
    const { name } = req.body as { name: string };
    const [count] = await prisma.$transaction([
      prisma.$executeRaw`UPDATE notes SET meta = meta - 'folder'
        WHERE user_id = ${req.user.id} AND space_id IS NOT DISTINCT FROM ${sc.space} AND meta->>'folder' = ${name}`,
    ]);
    if (count) notify(req, 'notes_changed');
    res.json({ ok: true, count: Number(count) });
  } catch (e) { next(e); }
});

/**
 * Who may empty or restore the Trash of this request's space, and which notes that covers.
 * Personal: the person's own notes. A Team: a lead covers every note of the team's Trash; anyone else only restores their own and
 * cannot delete forever. An Office: notes are private to their author, so only the person's own notes (deleting needs a lead too).
 */
async function trashScope(req: any, res: any, act: 'empty' | 'restore'): Promise<{ where: any } | null> {
  const own = await noteScope(req, res, 'write');
  if (!own) return null;
  if (!('spaceId' in own)) return { where: { userId: req.user.id, isDeleted: true } };
  const acc = await spaceAccess(req.user.id, own.spaceId);
  const lead = !!acc && can('space.manage', acc.org, acc.role);
  if (act === 'empty' && !lead) { res.status(403).json({ error: 'Only a team lead can delete notes forever.', code: 'lead_only' }); return null; }
  const office = await isOffice(own.spaceId);
  return { where: { spaceId: own.spaceId, isDeleted: true, ...(office || !lead ? { userId: req.user.id } : {}) } };
}

router.get('/trash/info', async (req: any, res, next) => {
  try {
    const own = await noteScope(req, res, 'read'); if (!own) return;
    const personal = !('spaceId' in own);
    // The timed purge (purgeExpiredTrash) only removes Personal notes; a team's Trash waits for a lead.
    res.json({ retentionDays: personal ? Math.round(TRASH_RETENTION_MS / 86400000) : null, purges: personal });
  } catch (e) { next(e); }
});

router.post('/trash/empty', async (req: any, res, next) => {
  try {
    if (req.user.viaToken) return res.status(403).json({ error: 'Not allowed with an access token.' });
    const sc = await trashScope(req, res, 'empty'); if (!sc) return;
    const [{ count }] = await prisma.$transaction([prisma.note.deleteMany({ where: sc.where })]);
    if (count) notify(req, 'notes_changed');
    res.json({ ok: true, count });
  } catch (e) { next(e); }
});

router.post('/trash/restore', async (req: any, res, next) => {
  try {
    if (req.user.viaToken) return res.status(403).json({ error: 'Not allowed with an access token.' });
    const sc = await trashScope(req, res, 'restore'); if (!sc) return;
    const [{ count }] = await prisma.$transaction([prisma.note.updateMany({ where: sc.where, data: { isDeleted: false, deletedAt: null } })]);
    if (count) notify(req, 'notes_changed');
    res.json({ ok: true, count });
  } catch (e) { next(e); }
});

export default router;

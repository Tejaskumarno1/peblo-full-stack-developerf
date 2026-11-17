import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import prisma from '../db.js';
import { authenticate } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { noteScope } from '../utils/scope.js';
import { can, spaceAccess } from '../utils/access.js';
import { isOffice } from '../utils/noteAccess.js';
import { notify } from '../utils/notify.js';
import { cleanNoteMeta, scrub } from '../utils/meta.js';
import { PRIVATE_TAG } from '../utils/aiAccess.js';
import { TRASH_RETENTION_MS } from '../controllers/notesController.js';

/*
 * Notes actions that touch many notes at once, each in ONE request and ONE transaction. Mounted at /api/notes BEFORE
 * routes/notes.ts. Every path here has a fixed first segment (bulk, folders, trash) that is never a note id, and none of them
 * exists in routes/notes.ts, so they do not shadow the /:id routes (GET/PATCH/DELETE /:id, POST /:id/restore ...).
 *   POST /notes/bulk                         (R37, round R4) one bulk action on many notes, see below
 *   POST /notes/folders/rename { from, to }  (N4, round R2) every note of the caller in the current space in folder `from` moves to `to`
 *   POST /notes/folders/clear  { name }      (N4) the same notes leave the folder (the folder was deleted)
 *   GET  /notes/trash/info                   (N49) how long the Trash keeps notes here
 *   POST /notes/trash/empty                  (N49) deletes the Trash of the current space for good
 *   POST /notes/trash/restore                (N49) puts every note of the Trash back
 * The space comes from the x-peblo-space header (noteScope), exactly as for one note.
 */
const router = Router();
// One authenticate for this router, limited to its own paths so other /api/notes requests are not authenticated twice
// (routes/notes.ts authenticates them itself).
export const BULK_PATHS = ['/bulk', '/folders/rename', '/folders/clear', '/trash/info', '/trash/empty', '/trash/restore'];
router.use(BULK_PATHS, authenticate);

/*
 * R37: one request for a bulk action on the notes list (archive, trash, pin, move to a folder, add a tag...), instead of one
 * request per note. POST /api/notes/bulk { action, ids, folder?, tag? } -> { action, done: [ids], failed: [{ id, error, code }] }.
 *
 * Scope is the same as the single routes: the space in X-Peblo-Space (noteScope), or Personal. Rights per note follow the
 * single routes exactly: archive/unarchive/trash/restore need "manage" (Personal: your note; Team: the author or a lead;
 * Office: the author), pin/unpin/move/tag are a PATCH and need "write" (Team: not a note shared "can view" by someone else;
 * Office: author or edit access). A note with meta.locked is skipped (code 'locked') except for pin, unpin and restore.
 * At most 3 pinned notes per scope (code 'pin_limit'), as PATCH. Access tokens never touch #private notes (code 'private').
 * All changes happen in one transaction; notes_changed is emitted once.
 */
export const BULK_MAX = 500;
const ACTIONS = ['archive', 'unarchive', 'trash', 'restore', 'pin', 'unpin', 'move', 'tag'] as const;
type Action = (typeof ACTIONS)[number];
const MANAGE = new Set<Action>(['archive', 'unarchive', 'trash', 'restore']);
const LOCK_FREE = new Set<Action>(['pin', 'unpin', 'restore']);
const MAX_PINNED = 3;

type Fail = { id: string; error: string; code: string };
const MSG: Record<string, string> = {
  not_found: 'Note not found',
  owner_only: 'Only the author or a space lead can do that.',
  view_only: 'This note is shared with you to read only.',
  no_access: 'This note is private. Ask the author to share it with you.',
  locked: 'This note is locked. Unlock it first.',
  pin_limit: `You can pin up to ${MAX_PINNED} notes. Unpin one first.`,
  private: 'This note is private.',
};
const fail = (id: string, code: string): Fail => ({ id, code, error: MSG[code] || code });

router.post('/bulk', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const action = req.body?.action as Action;
    if (!ACTIONS.includes(action)) return res.status(400).json({ error: `action must be one of ${ACTIONS.join(', ')}`, code: 'bad_action' });
    const raw = req.body?.ids;
    if (!Array.isArray(raw) || !raw.length || raw.some((x: unknown) => typeof x !== 'string' || !x || x.length > 64)) return res.status(400).json({ error: 'ids must be a non-empty list of note ids', code: 'bad_ids' });
    const ids = Array.from(new Set(raw as string[]));
    if (ids.length > BULK_MAX) return res.status(400).json({ error: `At most ${BULK_MAX} notes at once.`, code: 'too_many', max: BULK_MAX });
    let folder = '';
    if (action === 'move') {
      if (typeof req.body?.folder !== 'string') return res.status(400).json({ error: 'folder is required for move ("" takes notes out of their folder)', code: 'bad_folder' });
      folder = cleanNoteMeta({ folder: req.body.folder }, {}).folder || '';
    }
    let tag = '';
    if (action === 'tag') {
      tag = typeof req.body?.tag === 'string' ? req.body.tag.trim().replace(/^#+/, '').toLowerCase() : '';
      if (!tag || tag.length > 60) return res.status(400).json({ error: 'tag is required (1 to 60 characters)', code: 'bad_tag' });
    }

    // 'write' blocks a viewer of the space for every action; per-note rights are checked below (there is no :id here).
    const own = await noteScope(req, res, 'write');
    if (!own) return;
    const me = req.user!.id;
    const spaceId = 'spaceId' in own ? own.spaceId : null;
    const office = spaceId ? await isOffice(spaceId) : false;
    const role = spaceId ? (await spaceAccess(me, spaceId))?.role : null;
    // The Office fragment from noteScope hides notes the person may not change; read them without it to give a precise reason.
    const where = spaceId ? { spaceId } : { userId: me };

    const rows = await prisma.note.findMany({
      where: { id: { in: ids }, ...where },
      select: {
        id: true, userId: true, meta: true, isDeleted: true, isArchived: true, officeEveryone: true,
        access: { where: { userId: me }, select: { level: true } },
        tags: { select: { tag: { select: { name: true } } } },
      },
    });
    const byId = new Map(rows.map((r) => [r.id, r]));
    const failed: Fail[] = [];
    const ok: typeof rows = [];
    const need = MANAGE.has(action) ? 'manage' : 'write';
    for (const id of ids) {
      const n = byId.get(id);
      if (!n) { failed.push(fail(id, 'not_found')); continue; }
      const meta = (n.meta && typeof n.meta === 'object' ? n.meta : {}) as Record<string, any>;
      const tagNames = n.tags.map((t) => t.tag.name.toLowerCase());
      if ((req.user as any)?.viaToken && tagNames.includes(PRIVATE_TAG)) { failed.push(fail(id, 'private')); continue; }
      if (spaceId && office) {
        const grant = n.access[0]?.level;
        const level = n.userId === me ? 'owner' : (n.officeEveryone === 'edit' || grant === 'edit') ? 'edit' : (n.officeEveryone === 'view' || grant === 'view') ? 'view' : null;
        if (!level) { failed.push(fail(id, 'no_access')); continue; }
        if (need === 'manage' && level !== 'owner') { failed.push(fail(id, 'owner_only')); continue; }
        if (need === 'write' && level === 'view') { failed.push(fail(id, 'view_only')); continue; }
      } else if (spaceId) {
        if (need === 'manage' && n.userId !== me && role !== 'lead') { failed.push(fail(id, 'owner_only')); continue; }
        if (need === 'write' && n.userId !== me && meta.teamShare?.level === 'view') { failed.push(fail(id, 'view_only')); continue; }
      }
      if (meta.locked === true && !LOCK_FREE.has(action)) { failed.push(fail(id, 'locked')); continue; }
      ok.push(n);
    }

    let todo = ok;
    if (action === 'pin') {
      // already pinned: nothing to do; the rest only while there is room (same count as PATCH: not deleted, not archived, this scope)
      const fresh = ok.filter((n) => (n.meta as any)?.pinned !== true);
      const pinned = fresh.length ? await prisma.note.count({ where: { ...own, isDeleted: false, isArchived: false, meta: { path: ['pinned'], equals: true } } }) : 0;
      const room = Math.max(0, MAX_PINNED - pinned);
      const allowed = new Set(fresh.slice(0, room).map((n) => n.id));
      for (const n of fresh) if (!allowed.has(n.id)) failed.push(fail(n.id, 'pin_limit'));
      todo = ok.filter((n) => (n.meta as any)?.pinned === true || allowed.has(n.id));
    }

    const changeIds = todo.map((n) => n.id);
    if (changeIds.length) {
      await prisma.$transaction(async (tx) => {
        const scoped = { id: { in: changeIds }, ...where };
        switch (action) {
          case 'archive':
          case 'unarchive':
            await tx.note.updateMany({ where: scoped, data: { isArchived: action === 'archive' } });
            break;
          case 'trash': // a note already in the trash stays as it is (a plain DELETE on it is a no-op too)
            await tx.note.updateMany({ where: { ...scoped, isDeleted: false }, data: { isDeleted: true, deletedAt: new Date(), isArchived: false } });
            break;
          case 'restore':
            await tx.note.updateMany({ where: scoped, data: { isDeleted: false, deletedAt: null } });
            break;
          // Meta changes are not edits of the text, so updated_at is left alone (raw SQL: no @updatedAt), as PATCH does.
          case 'pin':
            await tx.$executeRaw`UPDATE notes SET meta = COALESCE(meta, '{}'::jsonb) || '{"pinned":true}'::jsonb WHERE id = ANY(${changeIds}::text[])`;
            break;
          case 'unpin':
            await tx.$executeRaw`UPDATE notes SET meta = COALESCE(meta, '{}'::jsonb) - 'pinned' WHERE id = ANY(${changeIds}::text[])`;
            break;
          case 'move':
            if (folder) await tx.$executeRaw`UPDATE notes SET meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object('folder', ${folder}::text) WHERE id = ANY(${changeIds}::text[])`;
            else await tx.$executeRaw`UPDATE notes SET meta = COALESCE(meta, '{}'::jsonb) - 'folder' WHERE id = ANY(${changeIds}::text[])`;
            break;
          case 'tag': {
            // the caller's own tag of that name (as PATCH { tags } does), linked to every note that has no tag of that name yet
            const need = todo.filter((n) => !n.tags.some((t) => t.tag.name.toLowerCase() === tag)).map((n) => n.id);
            if (!need.length) break;
            const t = await tx.tag.upsert({ where: { userId_name: { userId: me, name: tag } }, update: {}, create: { userId: me, name: tag }, select: { id: true } });
            await tx.noteTag.createMany({ data: need.map((noteId) => ({ noteId, tagId: t.id })), skipDuplicates: true });
            await tx.note.updateMany({ where: { id: { in: need }, ...where }, data: { updatedAt: new Date() } }); // a tag change counts as an edit
            break;
          }
        }
      }, { timeout: 30_000 });
    }

    if (changeIds.length) notify(req, 'notes_changed');
    res.json({ action, done: changeIds, failed });
  } catch (e) {
    next(e);
  }
});

// ---- Folders and Trash in one request (round R2, ISSUES N4, N49) ----

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

import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { authenticate } from '../middleware/auth.js';
import { noteScope } from '../utils/scope.js';
import { spaceAccess } from '../utils/access.js';
import { isOffice } from '../utils/noteAccess.js';
import { notify } from '../utils/notify.js';
import { cleanNoteMeta } from '../utils/meta.js';
import { PRIVATE_TAG } from '../utils/aiAccess.js';
import prisma from '../db.js';

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

const router = Router();

router.post('/bulk', authenticate, async (req: Request, res: Response, next: NextFunction) => {
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

export default router;

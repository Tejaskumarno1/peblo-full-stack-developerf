import type { Request, Response } from 'express';
import { can, spaceAccess } from './access.js';
import { hiddenNoteIds, isOffice, noteLevel } from './noteAccess.js';

/**
 * Who a request may read and write for. Phase 0 of the workspaces plan: every controller asks this one helper instead of
 * reading req.user.id itself, so that when workspaces arrive the change is made here and nowhere else.
 * Today the scope is the signed-in person's own data (their Personal space); workspaceId stays null until Phase 1.
 */
export interface Scope {
  userId: string;
  /** null means the person's Personal space. Set from a verified membership once workspaces exist. */
  workspaceId: string | null;
}

export function scopeOf(req: Request): Scope {
  const user = req.user;
  if (!user?.id) throw new Error('scopeOf called on a request with no signed-in user');
  return { userId: user.id, workspaceId: null };
}

/** The Prisma/SQL owner filter for a scope. Use it as `where: { ...ownedBy(scope), id }`. */
export const ownedBy = (scope: Scope) => ({ userId: scope.userId });

/**
 * Which notes a request is about: the person's own Personal notes (no space header), or one space they belong to.
 * Returns the where-fragment to spread into a notes query, or null after answering 403/404 itself.
 * An AI access token always works on Personal notes only. A space the person is not in answers 404, so its existence is not revealed.
 */
export type NoteScope = { userId: string } | { spaceId: string; AND?: any[] };

/**
 * In an Office a note is private to its author until opened up (040_office_private_notes.sql), so the returned fragment also hides notes the
 * person may not read (or, for 'write', may not change). A request that names one note (:id) gets a precise 403 instead:
 * code 'no_access' (not shared with you) or 'view_only' (shared, but not for editing). need 'manage' is the author only (delete, move).
 * Tasks share the space but not this privacy, so task routes pass { tasks: true }.
 */
export async function noteScope(req: Request, res: Response, need: 'read' | 'write' | 'manage', opts: { tasks?: boolean } = {}): Promise<NoteScope | null> {
  const user = req.user;
  if (!user?.id) { res.status(401).json({ error: 'Not signed in' }); return null; }
  const raw = String(req.headers['x-peblo-space'] ?? req.query?.space ?? '').trim();
  if (!raw || raw === 'personal' || (user as any).viaToken) return { userId: user.id };
  const acc = await spaceAccess(user.id, raw);
  if (!acc) { res.status(404).json({ error: 'Space not found' }); return null; }
  if (!can(need === 'read' ? 'space.read' : 'space.write', acc.org, acc.role)) {
    res.status(403).json({ error: need === 'read' ? 'No access.' : 'You can read this space but not change it.' });
    return null;
  }
  if (opts.tasks || !(await isOffice(raw))) return { spaceId: raw };
  const noteId = typeof req.params?.id === 'string' ? req.params.id : '';
  if (noteId) {
    const lv = await noteLevel(user.id, noteId, raw);
    if (lv.exists) {
      const owner = lv.ownerId ? { id: lv.ownerId, name: lv.ownerName ?? 'Someone' } : null;
      if (lv.level === null) { res.status(403).json({ error: 'This note is private. Ask the author to share it with you.', code: 'no_access', owner }); return null; }
      if (need === 'write' && lv.level === 'view') { res.status(403).json({ error: 'This note is shared with you to read only.', code: 'view_only', owner }); return null; }
      if (need === 'manage' && lv.level !== 'owner') { res.status(403).json({ error: 'Only the author can do that.', code: 'owner_only', owner }); return null; }
    }
  }
  const hidden = await hiddenNoteIds(user.id, raw, need === 'read' ? 'read' : 'write');
  return hidden.length ? { spaceId: raw, AND: [{ id: { notIn: hidden } }] } : { spaceId: raw };
}

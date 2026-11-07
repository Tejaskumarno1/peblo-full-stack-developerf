import type { Request, Response } from 'express';
import { can, spaceAccess } from './access.js';

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
export async function noteScope(req: Request, res: Response, need: 'read' | 'write'): Promise<{ userId: string } | { spaceId: string } | null> {
  const user = req.user;
  if (!user?.id) { res.status(401).json({ error: 'Not signed in' }); return null; }
  const raw = String(req.headers['x-peblo-space'] ?? req.query?.space ?? '').trim();
  if (!raw || raw === 'personal' || (user as any).viaToken) return { userId: user.id };
  const acc = await spaceAccess(user.id, raw);
  if (!acc) { res.status(404).json({ error: 'Space not found' }); return null; }
  if (!can(need === 'read' ? 'space.read' : 'space.write', acc.org, acc.role)) {
    res.status(403).json({ error: need === 'write' ? 'You can read this space but not change it.' : 'No access.' });
    return null;
  }
  return { spaceId: raw };
}

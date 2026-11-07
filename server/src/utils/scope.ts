import type { Request } from 'express';

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
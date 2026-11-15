import { Request, Response, NextFunction } from 'express';
import prisma from '../db.js';
import { PRIVATE_TAG, PRIVATE_MESSAGE } from '../utils/aiAccess.js';

/**
 * Access tokens (and so MCP clients such as Claude Desktop or Cursor) are AI as far as Peblo is concerned:
 * a note tagged #private is never shown to them, and cannot be read, changed, restored or traced through its links.
 * Signed-in people in the app are not affected. Applied to every /api/notes/:id route.
 */
export async function hidePrivateFromTokens(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user?.viaToken) return next();
    const id = String(req.params.id || '');
    if (!id) return next();
    if (req.params.kind && req.params.kind !== 'note') return next(); // /share/:kind/:id also serves tasks
    const row = await prisma.note.findFirst({ where: { id, userId: req.user.id, tags: { some: { tag: { name: PRIVATE_TAG } } } }, select: { id: true } });
    if (row) return res.status(403).json({ error: PRIVATE_MESSAGE, private: true });
    next();
  } catch (e) { next(e); }
}

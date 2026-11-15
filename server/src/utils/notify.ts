// Tell the signed-in person's other windows/devices that their notes or tasks changed (PEB-77).
// Every write path calls this once, after the database change, so lists and the calendar refresh by themselves.
// Team work (R11): when the request worked inside a space, teammates in the `space:<id>` room hear it too.
// Payloads carry only the space id (or null for Personal), never note or task text.
import type { Request } from 'express';

export type ChangeEvent = 'notes_changed' | 'todos_changed';

export const spaceRoom = (spaceId: string) => `space:${spaceId}`;

/** Emit to everyone currently in a space's room. Best-effort; payload must be ids only. */
export function emitSpace(io: any, spaceId: string | null | undefined, event: string, payload: Record<string, unknown> = {}) {
  try {
    if (io && spaceId) io.to(spaceRoom(spaceId)).emit(event, { ...payload, space: spaceId });
  } catch {
    /* live refresh is best-effort */
  }
}

/** Emit to one person's own windows and, in one pass (a socket in both rooms hears it once), to a space. */
export function emitUserAndSpace(io: any, userId: string | undefined, spaceId: string | null | undefined, event: string, payload: Record<string, unknown> = {}) {
  try {
    if (!io) return;
    const body = { ...payload, space: spaceId ?? null };
    let target = io.to(userId ?? '__none__');
    if (spaceId) target = target.to(spaceRoom(spaceId));
    if (userId || spaceId) target.emit(event, body);
  } catch {
    /* live refresh is best-effort */
  }
}

export function notify(req: Request | any, ...events: ChangeEvent[]) {
  try {
    const io = req.app?.get?.('io');
    const userId = req.user?.id;
    // peerSpace is set by noteScope() only after it verified the person is in that space.
    const spaceId: string | null = req.peerSpace ?? null;
    if (io && (userId || spaceId)) for (const e of events) emitUserAndSpace(io, userId, spaceId, e);
  } catch {
    /* live refresh is best-effort; never fail the request because of it */
  }
}

// Live team rooms (R11). A socket joins `space:<id>` for every space its person can read right now,
// so team notes and tasks refresh for teammates without a manual reload. Access is the same SQL the
// permission checks use (space member + active org member + nothing closed). Rooms carry ids only.
import prisma from '../db.js';
import { spaceRoom } from './notify.js';

const PREFIX = 'space:';

/** Space ids the person may read now. */
export async function readableSpaceIds(userId: string): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT sm.space_id AS id FROM space_members sm
    JOIN spaces s ON s.id = sm.space_id AND s.closed_at IS NULL
    JOIN org_members m ON m.org_id = s.org_id AND m.user_id = sm.user_id AND m.status = 'active' AND (m.guest_until IS NULL OR m.guest_until > now())
    JOIN organizations o ON o.id = s.org_id AND o.closed_at IS NULL
    WHERE sm.user_id = ${userId}`;
  return rows.map((r) => r.id);
}

/** Make one socket's space rooms match the person's current access (joins new ones, leaves lost ones). */
export async function syncSocketRooms(socket: any, userId: string): Promise<void> {
  try {
    const want = new Set((await readableSpaceIds(userId)).map(spaceRoom));
    for (const r of [...socket.rooms]) if (typeof r === 'string' && r.startsWith(PREFIX) && !want.has(r)) socket.leave(r);
    for (const r of want) if (!socket.rooms.has(r)) socket.join(r);
  } catch {
    /* rooms are best-effort; the client still refetches on reconnect and by its fallback poll */
  }
}

/** After membership changes: re-sync every open socket of these people. */
export async function refreshUserRooms(io: any, ...userIds: string[]): Promise<void> {
  try {
    if (!io) return;
    for (const uid of new Set(userIds.filter(Boolean))) {
      const sockets = await io.in(uid).fetchSockets();
      for (const s of sockets) await syncSocketRooms(s, uid);
    }
  } catch {
    /* best-effort */
  }
}

/** A space was closed or reshaped: re-sync every socket currently in its room. */
export async function refreshSpaceRoom(io: any, spaceId: string): Promise<void> {
  try {
    if (!io) return;
    const sockets = await io.in(spaceRoom(spaceId)).fetchSockets();
    for (const s of sockets) if (s.data?.userId) await syncSocketRooms(s, s.data.userId);
  } catch { /* best-effort */ }
}

/** A person left or was removed from a space: take their sockets out of its room at once. */
export function kickFromSpace(io: any, spaceId: string, userId: string): void {
  try { io?.in(userId).socketsLeave(spaceRoom(spaceId)); } catch { /* best-effort */ }
}

/** Safety net for access that ends by time (guest expiry) or by paths that do not call refreshUserRooms. */
export function startRoomRefresh(io: any, everyMs = 5 * 60 * 1000): NodeJS.Timeout {
  const t = setInterval(async () => {
    try {
      const sockets = await io.fetchSockets();
      for (const s of sockets) if (s.data?.userId) await syncSocketRooms(s, s.data.userId);
    } catch { /* best-effort */ }
  }, everyMs);
  t.unref?.();
  return t;
}

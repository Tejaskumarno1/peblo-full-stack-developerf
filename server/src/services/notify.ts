import crypto from 'crypto';
import prisma from '../db.js';
import { encField } from '../dataCrypto.js';

/** A stored notification for people in a workspace (one per person per event) plus a live nudge to their open windows. */
export async function notifyUsers(app: any, userIds: string[], n: { kind: string; title: string; body?: string; from: string; spaceId?: string | null; todoId?: string | null }) {
  const ids = [...new Set(userIds)];
  for (const userId of ids) {
    const nid = crypto.randomUUID();
    try {
      await prisma.$executeRawUnsafe(
        'INSERT INTO user_notifications (id, user_id, kind, note_id, title, body, from_name, space_id, todo_id) VALUES ($1,$2,$3,NULL,$4,$5,$6,$7,$8)',
        nid, userId, n.kind, n.title.slice(0, 200), encField('user_notifications', 'body', nid, (n.body || '').slice(0, 300)), n.from.slice(0, 40), n.spaceId ?? null, n.todoId ?? null,
      );
      await prisma.$executeRawUnsafe('DELETE FROM user_notifications WHERE user_id = $1 AND id NOT IN (SELECT id FROM user_notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 100)', userId);
      app?.get?.('io')?.to(userId).emit('notifications_changed');
    } catch { /* a missed notification never blocks the action */ }
  }
}

export async function spaceUserIds(spaceId: string, onlyLeads = false): Promise<string[]> {
  const r = await prisma.$queryRaw<{ user_id: string }[]>`SELECT user_id FROM space_members WHERE space_id = ${spaceId} AND (${!onlyLeads} OR role = 'lead')`;
  return r.map((x) => x.user_id);
}
export const nameOf = async (userId: string) => (await prisma.$queryRaw<{ name: string }[]>`SELECT name FROM users WHERE id = ${userId}`)[0]?.name ?? 'Someone';

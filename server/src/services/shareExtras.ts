import prisma from '../db.js';
import { ANY_SPACE } from '../personalGuard.js';
import { guestHash } from './shareAccess.js';
import { notifyUsers } from './notify.js';

/*
 * Round 3 additions to share links (kept out of routes/share.ts so that file only calls these):
 *  - FM12 "Let guests copy and download" per link (share_settings.no_copy, 054)
 *  - M6 a custom end date and time
 *  - M11 the owner is notified when a guest asks to edit or to keep the link going
 *  - M8 / M13 the owner's lists: guests who asked to come in (declined kept 30 days) and who opened the link in the last 30 days
 */

export const MAX_EXPIRY_MS = 10 * 366 * 86400000;

/** True when the owner turned off copying and downloading for this link. */
export async function noCopyOf(kind: string, token: string): Promise<boolean> {
  const r = await prisma.$queryRawUnsafe<{ no_copy: boolean }[]>('SELECT no_copy FROM share_settings WHERE kind = $1 AND share_token = $2', kind, token).catch(() => []);
  return !!r[0]?.no_copy;
}

export async function setNoCopy(kind: string, token: string, noCopy: boolean) {
  await prisma.$executeRawUnsafe('INSERT INTO share_settings (kind, share_token, no_copy) VALUES ($1, $2, $3) ON CONFLICT (kind, share_token) DO UPDATE SET no_copy = EXCLUDED.no_copy', kind, token, noCopy);
}

/** An end date from the client: null = never; a valid ISO date in the future and at most 10 years away; anything else is 'bad'. */
export function parseExpiresAt(raw: unknown): Date | null | 'bad' {
  if (raw === null || raw === '') return null;
  if (typeof raw !== 'string' || raw.length > 40) return 'bad';
  const d = new Date(raw);
  const t = d.getTime();
  if (!Number.isFinite(t) || t <= Date.now() + 30_000 || t > Date.now() + MAX_EXPIRY_MS) return 'bad';
  return d;
}

const REQUEST_QUIET_MS = 10 * 60_000;

/**
 * A guest asked to edit, or to keep the link going: one in-app notification for the person who owns the link (the note's author, the task's owner).
 * The same request again within 10 minutes is not notified twice. A guest's typed name is marked as a guest; a signed-in person is named by their account.
 */
export async function notifyOwnerOfRequest(app: any, kind: 'note' | 'todo', token: string, what: 'edit' | 'extend', guestName: string, previousAt: Date | null, memberName: string | null) {
  try {
    if (previousAt && Date.now() - new Date(previousAt).getTime() < REQUEST_QUIET_MS) return;
    const item = kind === 'note'
      ? await prisma.note.findFirst({ where: { ...ANY_SPACE, shareToken: token, isDeleted: false }, select: { id: true, userId: true, title: true } }).then((n) => n && { id: n.id, userId: n.userId, title: n.title || 'Untitled' })
      : await prisma.todo.findFirst({ where: { ...ANY_SPACE, shareToken: token }, select: { id: true, userId: true, text: true } }).then((t) => t && { id: t.id, userId: t.userId, title: t.text || 'Task' });
    if (!item) return;
    const who = memberName || `${guestName || 'Guest'} (guest)`;
    const title = what === 'edit' ? `${who} asked to edit “${item.title.slice(0, 80)}”` : `${who} asked you to keep the link to “${item.title.slice(0, 80)}” working`;
    await notifyUsers(app, [item.userId], {
      kind: 'share_request', title, body: what === 'edit' ? 'Open the share panel to let them edit.' : 'Open the share box to give the link a new end date.', from: who,
      ...(kind === 'note' ? { noteId: item.id } : { todoId: item.id }),
    });
  } catch { /* a missed notification never blocks the request itself */ }
}

/** Who opened this link in the last 30 days (one row per browser session; signed-in people by their account name). */
export async function linkOpens(kind: string, token: string) {
  const rows = await prisma.$queryRawUnsafe<{ name: string; user_id: string | null; account: string | null; avatar: string | null; visits: number; opened_at: Date; last_at: Date }[]>(
    `SELECT r.name, r.user_id, u.name AS account, u.avatar, r.visits, r.opened_at, r.last_at FROM share_reads r LEFT JOIN users u ON u.id = r.user_id
     WHERE r.kind = $1 AND r.share_token = $2 AND r.last_at >= NOW() - INTERVAL '30 days' ORDER BY r.last_at DESC LIMIT 50`, kind, token);
  return rows.map((r) => ({
    name: r.user_id ? (r.account || r.name) : r.name,
    member: !!r.user_id,
    avatar: r.user_id && r.avatar && r.avatar.length < 4096 ? r.avatar : null,
    visits: Math.max(1, Number(r.visits) || 1),
    firstAt: r.opened_at,
    lastAt: r.last_at,
  }));
}

/** Guests who knocked: waiting (only while they are still at the door), let in, or declined (kept 30 days). */
export async function linkRequests(kind: string, token: string) {
  const rows = await prisma.$queryRawUnsafe<{ session_id: string; name: string; status: string; role: string | null; at: Date }[]>(
    `SELECT session_id, name, status, role, at FROM share_guests WHERE kind = $1 AND share_token = $2
       AND (status <> 'waiting' OR at >= NOW() - INTERVAL '1 hour') ORDER BY at DESC LIMIT 50`, kind, token);
  return rows.map((r) => ({ id: guestHash(r.session_id), name: r.name, status: r.status === 'declined' ? 'declined' : r.status === 'admitted' ? 'admitted' : 'waiting', role: r.role, at: r.at }));
}

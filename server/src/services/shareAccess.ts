import crypto from 'crypto';
import prisma from '../db.js';

/*
 * Who may open a share link and what they may do there.
 * - The link can ask for approval: a new guest waits until the owner lets them in.
 * - The owner can give one person their own role ('view' or 'edit'); everyone else gets the link's default.
 */
export type Role = 'view' | 'edit';
export type Access = { allowed: boolean; waiting: 'waiting' | 'declined' | null; canEdit: boolean; role: Role | null; approval: boolean };

export const SESSION_RE = /^[A-Za-z0-9_-]{16,80}$/;
export const guestHash = (sessionId: string) => crypto.createHash('sha256').update(sessionId).digest('hex').slice(0, 12);

export async function approvalOn(kind: string, token: string): Promise<boolean> {
  const r = await prisma.$queryRawUnsafe<{ approval: boolean }[]>('SELECT approval FROM share_settings WHERE kind = $1 AND share_token = $2', kind, token);
  return !!r[0]?.approval;
}

/** The decision for one guest session. `owner` (the signed-in owner opening their own link) always gets in. */
export async function accessFor(kind: string, token: string, sessionId: unknown, linkEdit: boolean, owner = false): Promise<Access> {
  const approval = await approvalOn(kind, token);
  const sid = typeof sessionId === 'string' && SESSION_RE.test(sessionId) ? sessionId : null;
  if (owner) return { allowed: true, waiting: null, canEdit: linkEdit, role: null, approval };
  const rows = sid ? await prisma.$queryRawUnsafe<{ status: string; role: string | null }[]>('SELECT status, role FROM share_guests WHERE kind = $1 AND share_token = $2 AND session_id = $3', kind, token, sid) : [];
  const row = rows[0];
  if (approval && row?.status !== 'admitted') return { allowed: false, waiting: row?.status === 'declined' ? 'declined' : 'waiting', canEdit: false, role: null, approval };
  const role = row?.role === 'edit' || row?.role === 'view' ? (row.role as Role) : null;
  return { allowed: true, waiting: null, canEdit: role ? role === 'edit' : linkEdit, role, approval };
}

/** Everyone waiting at the door right now (they knock every few seconds). */
export async function listWaiting(kind: string, token: string) {
  const rows = await prisma.$queryRawUnsafe<{ session_id: string; name: string; at: Date }[]>(
    "SELECT session_id, name, at FROM share_guests WHERE kind = $1 AND share_token = $2 AND status = 'waiting' AND at >= NOW() - INTERVAL '40 seconds' ORDER BY at ASC LIMIT 30", kind, token);
  return rows.map((r) => ({ id: guestHash(r.session_id), name: r.name, at: r.at }));
}

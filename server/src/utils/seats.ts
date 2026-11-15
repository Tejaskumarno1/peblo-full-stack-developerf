import prisma from '../db.js';

/*
 * Seat limit (audit R15). A seat is an active member who is not a guest; guests are free (same rule as GET /orgs/:orgId/seats).
 * Pending invites (not accepted, not revoked, not expired, not for a guest) reserve a seat, so an owner cannot invite past the limit.
 * Limit: organizations.policy.seatLimit, default 10 (the number the settings page shows).
 */
export const DEFAULT_SEAT_LIMIT = 10;

type Db = { $queryRaw: typeof prisma.$queryRaw };

export interface SeatState { used: number; pending: number; limit: number }

export async function seatState(db: Db, orgId: string, opts: { excludeEmail?: string } = {}): Promise<SeatState> {
  const ex = opts.excludeEmail ?? null;
  const rows = await db.$queryRaw<{ used: number; pending: number; policy: any }[]>`
    SELECT (SELECT count(*)::int FROM org_members WHERE org_id = ${orgId} AND role <> 'guest' AND status = 'active') AS used,
           (SELECT count(*)::int FROM org_invites WHERE org_id = ${orgId} AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now() AND org_role <> 'guest'
              AND (${ex}::text IS NULL OR email::text <> ${ex}::text)) AS pending,
           (SELECT policy FROM organizations WHERE id = ${orgId}) AS policy`;
  const r = rows[0];
  const n = Number(r?.policy?.seatLimit);
  return { used: r?.used ?? 0, pending: r?.pending ?? 0, limit: n > 0 ? n : DEFAULT_SEAT_LIMIT };
}

export const seatMessage = (s: SeatState) =>
  `This organization has reached its limit of ${s.limit} seats (${s.used} active member${s.used === 1 ? '' : 's'}${s.pending ? ` and ${s.pending} pending invite${s.pending === 1 ? '' : 's'}` : ''}). Remove a member or withdraw an invite first. Guests do not use a seat.`;

export type SeatBlock = { error: string; code: 'seat_limit'; limit: number; used: number; pending: number };

/** null when one more seat fits; otherwise the body to answer 409 with ({ error, code: 'seat_limit', ... }). Pass a transaction client to check inside it. */
export async function seatBlock(db: Db, orgId: string, opts: { adding?: number; excludeEmail?: string } = {}): Promise<SeatBlock | null> {
  const s = await seatState(db, orgId, opts);
  if (s.used + s.pending + (opts.adding ?? 1) <= s.limit) return null;
  return { error: seatMessage(s), code: 'seat_limit', ...s };
}

/** Thrown inside a transaction to roll it back when the last seat was taken meanwhile. */
export class SeatLimitError extends Error {
  constructor(public body: SeatBlock) { super(body.error); }
}

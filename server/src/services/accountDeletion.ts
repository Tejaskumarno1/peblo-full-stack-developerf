import prisma from '../db.js';
import { DELETION_GRACE_DAYS } from '../utils/account.js';

/**
 * Accounts whose owner asked to delete them more than 30 days ago are removed for good. Everything the person owns is tied
 * to the user row with ON DELETE CASCADE, so one delete removes it all. Signing in during the 30 days cancels the request.
 */
/** Names of open organizations where this person is the only active owner (deleting them would orphan the organization). */
export async function soleOwnerOrgs(userId: string): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ name: string }[]>`
    SELECT o.name FROM org_members m JOIN organizations o ON o.id = m.org_id
    WHERE m.user_id = ${userId} AND m.role = 'owner' AND m.status = 'active' AND o.closed_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM org_members x WHERE x.org_id = m.org_id AND x.role = 'owner' AND x.status = 'active' AND x.user_id <> ${userId})`;
  return rows.map((r) => r.name);
}

export const soleOwnerMessage = (names: string[]) => `You are the only owner of ${names.join(', ')}. Make someone else an owner, or leave the organization, before you delete your account.`;

export async function purgeScheduledDeletions(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - DELETION_GRACE_DAYS * 86_400_000);
  const due = await prisma.user.findMany({ where: { deletionRequestedAt: { lt: cutoff } }, select: { id: true } });
  const ok: string[] = [];
  // an account that is the last owner of an organization is held (still flagged) rather than orphaning the organization
  for (const u of due) if (!(await soleOwnerOrgs(u.id)).length) ok.push(u.id);
  if (!ok.length) return 0;
  const res = await prisma.user.deleteMany({ where: { id: { in: ok }, deletionRequestedAt: { lt: cutoff } } });
  return res.count;
}

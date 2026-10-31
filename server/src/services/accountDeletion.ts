import prisma from '../db.js';
import { DELETION_GRACE_DAYS } from '../utils/account.js';

/**
 * Accounts whose owner asked to delete them more than 30 days ago are removed for good. Everything the person owns is tied
 * to the user row with ON DELETE CASCADE, so one delete removes it all. Signing in during the 30 days cancels the request.
 */
export async function purgeScheduledDeletions(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - DELETION_GRACE_DAYS * 86_400_000);
  const res = await prisma.user.deleteMany({ where: { deletionRequestedAt: { lt: cutoff } } });
  return res.count;
}

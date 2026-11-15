import prisma from '../db.js';

export const policyOf = (p: any) => ({
  publicShares: p?.publicShares !== false,
  guests: p?.guests === true,
  aiFeatures: p?.aiFeatures !== false,
  requireOrgKey: p?.requireOrgKey === true,
  membersCreateTeams: p?.membersCreateTeams !== false,
});
export const POLICY_KEYS = ['publicShares', 'guests', 'aiFeatures', 'requireOrgKey', 'membersCreateTeams'];

/** The policy of the organization that owns a space, or null for a Personal note (no space). */
export async function policyOfSpace(spaceId: string | null | undefined) {
  if (!spaceId) return null;
  const r = await prisma.$queryRaw<{ policy: any }[]>`SELECT o.policy FROM spaces s JOIN organizations o ON o.id = s.org_id WHERE s.id = ${spaceId}`;
  return r[0] ? policyOf(r[0].policy) : null;
}

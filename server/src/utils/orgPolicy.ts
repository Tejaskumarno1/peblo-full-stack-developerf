import prisma from '../db.js';

/** A company email domain as an owner types it ("@Acme.com", " acme.com ") -> "acme.com"; null when it is not a domain. */
export function cleanDomain(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const d = raw.trim().toLowerCase().replace(/^@+/, '');
  return /^(?=.{3,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(d) ? d : null;
}

export const MAX_DOMAINS = 20;

export const policyOf = (p: any) => ({
  publicShares: p?.publicShares !== false,
  guests: p?.guests === true,
  aiFeatures: p?.aiFeatures !== false,
  requireOrgKey: p?.requireOrgKey === true,
  membersCreateTeams: p?.membersCreateTeams !== false,
  // FM24: when not empty, only people whose email ends in one of these domains can be invited or use a join link (guests too).
  allowedDomains: Array.isArray(p?.allowedDomains) ? [...new Set((p.allowedDomains as unknown[]).map(cleanDomain).filter((d): d is string => !!d))].slice(0, MAX_DOMAINS) : [],
});
export const POLICY_KEYS = ['publicShares', 'guests', 'aiFeatures', 'requireOrgKey', 'membersCreateTeams'];

/** True when this email may join an organization with these allowed domains (an empty list allows everyone). Subdomains count: a@eu.acme.com is in acme.com. */
export function emailAllowed(email: string, allowed: string[]): boolean {
  if (!allowed.length) return true;
  const host = String(email || '').toLowerCase().split('@').pop() || '';
  return allowed.some((d) => host === d || host.endsWith(`.${d}`));
}

/** The answer an invite or a join link gives when the email is outside the allowed domains. */
export const domainRefusal = (allowed: string[]) => ({
  error: `This organization only accepts email addresses at ${allowed.map((d) => `@${d}`).join(', ')}.`,
  code: 'domain_not_allowed' as const,
  state: 'domain_not_allowed' as const,
  allowedDomains: allowed,
});

/** The policy of the organization that owns a space, or null for a Personal note (no space). */
export async function policyOfSpace(spaceId: string | null | undefined) {
  if (!spaceId) return null;
  const r = await prisma.$queryRaw<{ policy: any }[]>`SELECT o.policy FROM spaces s JOIN organizations o ON o.id = s.org_id WHERE s.id = ${spaceId}`;
  return r[0] ? policyOf(r[0].policy) : null;
}

/** The policy of one organization. */
export async function policyOfOrg(orgId: string) {
  const r = await prisma.$queryRaw<{ policy: any }[]>`SELECT policy FROM organizations WHERE id = ${orgId}`;
  return policyOf(r[0]?.policy);
}

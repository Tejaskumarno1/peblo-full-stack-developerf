import crypto from 'crypto';
import prisma from '../db.js';

/*
 * Workspaces, phase 1: the one place that answers "may this person do this here?". Routes call these instead of
 * comparing roles themselves, so a rule changes in one file. Raw SQL on the tables from 035_workspaces_expand.sql.
 */
export type OrgRole = 'owner' | 'admin' | 'member' | 'guest';
export type SpaceRole = 'lead' | 'member' | 'viewer';

export interface OrgAccess { orgId: string; role: OrgRole; status: 'active' | 'paused'; orgStatus: 'active' | 'read_only' | 'closed' }

export async function orgAccess(userId: string, orgId: string): Promise<OrgAccess | null> {
  const rows = await prisma.$queryRaw<{ role: OrgRole; status: 'active' | 'paused'; org_status: OrgAccess['orgStatus'] }[]>`
    SELECT m.role, m.status, o.status AS org_status FROM org_members m JOIN organizations o ON o.id = m.org_id
    WHERE m.org_id = ${orgId} AND m.user_id = ${userId} AND o.closed_at IS NULL AND (m.guest_until IS NULL OR m.guest_until > now())`;
  const r = rows[0];
  return r ? { orgId, role: r.role, status: r.status, orgStatus: r.org_status } : null;
}

/** A person's role in one space, or null when they are not in it (an owner or admin is NOT in a space just by being one). */
export async function spaceRole(userId: string, spaceId: string): Promise<SpaceRole | null> {
  const rows = await prisma.$queryRaw<{ role: SpaceRole }[]>`
    SELECT sm.role FROM space_members sm JOIN spaces s ON s.id = sm.space_id
    JOIN org_members m ON m.org_id = s.org_id AND m.user_id = sm.user_id AND m.status = 'active'
    JOIN organizations o ON o.id = s.org_id
    WHERE sm.space_id = ${spaceId} AND sm.user_id = ${userId} AND s.closed_at IS NULL AND o.closed_at IS NULL`;
  return rows[0]?.role ?? null;
}

export type Action = 'space.read' | 'space.write' | 'space.manage' | 'org.manage' | 'org.create_space';
const WRITE_BLOCKED = new Set(['read_only', 'closed']);

/** The single permission check. `org` is the person's membership; `space` their role in the space (when the action is about one). */
export function can(action: Action, org: OrgAccess | null, space: SpaceRole | null = null): boolean {
  if (!org || org.status !== 'active') return false;
  const adminish = org.role === 'owner' || org.role === 'admin';
  const writable = !WRITE_BLOCKED.has(org.orgStatus);
  switch (action) {
    case 'space.read': return space !== null;
    case 'space.write': return writable && (space === 'lead' || space === 'member');
    case 'space.manage': return writable && space === 'lead';
    case 'org.manage': return writable && adminish;
    case 'org.create_space': return writable && (adminish || org.role === 'member');
  }
}

export async function audit(orgId: string, actorId: string | null, action: string, target: string | null, detail: Record<string, unknown> = {}): Promise<void> {
  await prisma.$executeRaw`INSERT INTO audit_log (id, org_id, actor_id, action, target, detail) VALUES (${crypto.randomUUID()}, ${orgId}, ${actorId}, ${action}, ${target}, ${JSON.stringify(detail)}::jsonb)`;
}

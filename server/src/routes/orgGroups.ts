import { Router } from 'express';
import crypto from 'crypto';
import prisma from '../db.js';
import { audit, can, orgAccess, spaceAccess } from '../utils/access.js';

/*
 * FM23 groups: named groups of organization members (table 055_org_groups.sql). Owners and admins create, rename, fill and
 * delete them; any member (not a guest) can see them. A group is a shortcut, not a role: giving a task or an Office note
 * to a group adds each of its members (who is in that team) one by one, through the existing assignee and note-access rules.
 * Mounted inside routes/orgs.ts (so under /api/workspaces, behind `authenticate`).
 */
const router = Router();
const uid = (req: any): string => req.user.id;
const MAX_GROUPS = 50;
const MAX_MEMBERS = 200;
const cleanName = (v: unknown) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60) : '');

async function gate(req: any, res: any, manage: boolean) {
  const org = await orgAccess(uid(req), String(req.params.orgId));
  if (!org) { res.status(404).json({ error: 'Organization not found.' }); return null; }
  if (org.role === 'guest') { res.status(403).json({ error: 'Guests cannot see groups.' }); return null; }
  if (manage && !can('org.manage', org)) { res.status(403).json({ error: 'Only owners and admins can change groups.' }); return null; }
  return org;
}

/** Only active, non-guest members of this organization can be in one of its groups. */
async function validMembers(orgId: string, raw: unknown): Promise<string[]> {
  const wanted = Array.isArray(raw) ? [...new Set(raw.filter((x): x is string => typeof x === 'string'))].slice(0, MAX_MEMBERS) : [];
  if (!wanted.length) return [];
  const rows = await prisma.$queryRaw<{ user_id: string }[]>`SELECT user_id FROM org_members WHERE org_id = ${orgId} AND role <> 'guest' AND status = 'active' AND user_id = ANY(${wanted}::text[])`;
  return rows.map((r) => r.user_id);
}

async function listGroups(orgId: string, onlyUsers: string[] | null = null) {
  const groups = await prisma.$queryRaw<{ id: string; name: string; created_at: Date }[]>`SELECT id, name, created_at FROM org_groups WHERE org_id = ${orgId} ORDER BY lower(name)`;
  if (!groups.length) return [];
  const ids = groups.map((g) => g.id);
  // a person who left the organization (or became a guest) drops out of every group's list without being deleted from it
  const members = await prisma.$queryRaw<{ group_id: string; user_id: string; name: string; avatar: string | null }[]>`
    SELECT gm.group_id, gm.user_id, u.name, u.avatar FROM org_group_members gm JOIN users u ON u.id = gm.user_id
    JOIN org_members m ON m.user_id = gm.user_id AND m.org_id = ${orgId} AND m.role <> 'guest' AND m.status = 'active'
    WHERE gm.group_id = ANY(${ids}::text[]) ORDER BY lower(u.name)`;
  return groups.map((g) => {
    const all = members.filter((m) => m.group_id === g.id);
    const inSpace = onlyUsers ? all.filter((m) => onlyUsers.includes(m.user_id)) : all;
    return { id: g.id, name: g.name, size: all.length, members: inSpace.map((m) => ({ userId: m.user_id, name: m.name, avatar: m.avatar })) };
  });
}

// GET /orgs/:orgId/groups -> { groups: [{ id, name, size, members: [{ userId, name, avatar }] }], canManage }
router.get('/orgs/:orgId/groups', async (req, res, next) => {
  try {
    const org = await gate(req, res, false); if (!org) return;
    res.json({ groups: await listGroups(String(req.params.orgId)), canManage: can('org.manage', org) });
  } catch (e) { next(e); }
});

// POST /orgs/:orgId/groups { name, userIds? }
router.post('/orgs/:orgId/groups', async (req, res, next) => {
  try {
    if (!(await gate(req, res, true))) return;
    const orgId = String(req.params.orgId);
    const name = cleanName(req.body?.name);
    if (name.length < 2) return res.status(400).json({ error: 'Give the group a name of at least 2 letters.' });
    const n = (await prisma.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM org_groups WHERE org_id = ${orgId}`)[0]?.n ?? 0;
    if (n >= MAX_GROUPS) return res.status(400).json({ error: `An organization can have ${MAX_GROUPS} groups.` });
    const clash = await prisma.$queryRaw<{ id: string }[]>`SELECT id FROM org_groups WHERE org_id = ${orgId} AND lower(name) = lower(${name})`;
    if (clash.length) return res.status(409).json({ error: 'There is already a group with that name.', code: 'name_taken' });
    const id = crypto.randomUUID();
    const members = await validMembers(orgId, req.body?.userIds);
    await prisma.$transaction([
      prisma.$executeRaw`INSERT INTO org_groups (id, org_id, name, created_by) VALUES (${id}, ${orgId}, ${name}, ${uid(req)})`,
      ...members.map((u) => prisma.$executeRaw`INSERT INTO org_group_members (group_id, user_id) VALUES (${id}, ${u}) ON CONFLICT DO NOTHING`),
    ]);
    await audit(orgId, uid(req), 'group.created', id, { name, members: members.length });
    res.status(201).json({ id, name, members: members.length });
  } catch (e) { next(e); }
});

// PATCH /orgs/:orgId/groups/:groupId { name?, userIds? }  (userIds replaces the member list)
router.patch('/orgs/:orgId/groups/:groupId', async (req, res, next) => {
  try {
    if (!(await gate(req, res, true))) return;
    const orgId = String(req.params.orgId); const gid = String(req.params.groupId);
    const g = await prisma.$queryRaw<{ id: string }[]>`SELECT id FROM org_groups WHERE id = ${gid} AND org_id = ${orgId}`;
    if (!g.length) return res.status(404).json({ error: 'Group not found.' });
    const ops: any[] = [];
    if (req.body?.name !== undefined) {
      const name = cleanName(req.body.name);
      if (name.length < 2) return res.status(400).json({ error: 'Give the group a name of at least 2 letters.' });
      const clash = await prisma.$queryRaw<{ id: string }[]>`SELECT id FROM org_groups WHERE org_id = ${orgId} AND lower(name) = lower(${name}) AND id <> ${gid}`;
      if (clash.length) return res.status(409).json({ error: 'There is already a group with that name.', code: 'name_taken' });
      ops.push(prisma.$executeRaw`UPDATE org_groups SET name = ${name} WHERE id = ${gid}`);
    }
    let count: number | undefined;
    if (req.body?.userIds !== undefined) {
      const members = await validMembers(orgId, req.body.userIds);
      count = members.length;
      ops.push(prisma.$executeRaw`DELETE FROM org_group_members WHERE group_id = ${gid}`);
      for (const u of members) ops.push(prisma.$executeRaw`INSERT INTO org_group_members (group_id, user_id) VALUES (${gid}, ${u}) ON CONFLICT DO NOTHING`);
    }
    if (ops.length) await prisma.$transaction(ops);
    await audit(orgId, uid(req), 'group.updated', gid, { name: req.body?.name !== undefined ? cleanName(req.body.name) : undefined, members: count });
    res.json({ ok: true, ...(count !== undefined ? { members: count } : {}) });
  } catch (e) { next(e); }
});

// DELETE /orgs/:orgId/groups/:groupId -> the group goes; nothing given to its members is taken back
router.delete('/orgs/:orgId/groups/:groupId', async (req, res, next) => {
  try {
    if (!(await gate(req, res, true))) return;
    const n = await prisma.$executeRaw`DELETE FROM org_groups WHERE id = ${String(req.params.groupId)} AND org_id = ${String(req.params.orgId)}`;
    if (!n) return res.status(404).json({ error: 'Group not found.' });
    await audit(String(req.params.orgId), uid(req), 'group.deleted', String(req.params.groupId));
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// GET /spaces/:spaceId/groups -> the organization's groups, each with only the members who are in this team (to assign a task or share a note).
router.get('/spaces/:spaceId/groups', async (req, res, next) => {
  try {
    const spaceId = String(req.params.spaceId);
    const acc = await spaceAccess(uid(req), spaceId);
    if (!acc || acc.org.role === 'guest') return res.status(404).json({ error: 'Team not found.' });
    const inSpace = (await prisma.$queryRaw<{ user_id: string }[]>`SELECT user_id FROM space_members WHERE space_id = ${spaceId}`).map((r) => r.user_id);
    const groups = (await listGroups(acc.org.orgId, inSpace)).filter((g) => g.members.length > 0);
    res.json({ groups });
  } catch (e) { next(e); }
});

export default router;

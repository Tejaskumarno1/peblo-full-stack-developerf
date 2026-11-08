import { Router } from 'express';
import crypto from 'crypto';
import prisma from '../db.js';
import { authenticate } from '../middleware/auth.js';
import { audit, can, orgAccess, type OrgRole, type SpaceRole } from '../utils/access.js';
import { publicBase, sendMail, type Mail } from '../services/mailer.js';

/* Members, invitations and the audit trail of an organization. Tables: 035_workspaces_expand.sql. */
const router = Router();
router.use(authenticate);

const uid = (req: any): string => req.user.id;
const ORG_ROLES: OrgRole[] = ['owner', 'admin', 'member', 'guest'];
const SPACE_ROLES: SpaceRole[] = ['lead', 'member', 'viewer'];
const hash = (t: string) => crypto.createHash('sha256').update(t).digest('hex');
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const INVITE_DAYS = 7;

/** The caller's membership, or an error already sent. `manage` demands an owner or admin of an organization that accepts writes. */
async function gate(req: any, res: any, manage: boolean) {
  const org = await orgAccess(uid(req), req.params.orgId);
  if (!org) { res.status(404).json({ error: 'Organization not found.' }); return null; }
  if (manage && !can('org.manage', org)) { res.status(403).json({ error: 'Only owners and admins can do that.' }); return null; }
  return org;
}

router.get('/orgs/:orgId/members', async (req, res) => {
  if (!(await gate(req, res, false))) return;
  const orgId = req.params.orgId;
  const members = await prisma.$queryRaw<any[]>`
    SELECT m.user_id AS "userId", u.name, u.email, m.role, m.status, m.guest_until AS "guestUntil", m.joined_at AS "joinedAt",
           COALESCE((SELECT json_agg(json_build_object('id', s.id, 'name', s.name, 'kind', s.kind, 'role', sm.role) ORDER BY s.created_at)
                     FROM space_members sm JOIN spaces s ON s.id = sm.space_id AND s.org_id = m.org_id AND s.closed_at IS NULL
                     WHERE sm.user_id = m.user_id), '[]'::json) AS spaces
    FROM org_members m JOIN users u ON u.id = m.user_id WHERE m.org_id = ${orgId} ORDER BY m.joined_at`;
  const invites = await prisma.$queryRaw<any[]>`
    SELECT id, email::text AS email, org_role AS "orgRole", space_ids AS "spaceIds", space_role AS "spaceRole", created_at AS "createdAt", expires_at AS "expiresAt"
    FROM org_invites WHERE org_id = ${orgId} AND accepted_at IS NULL AND revoked_at IS NULL ORDER BY created_at DESC`;
  res.json({ members, invites });
});

function inviteMail(to: string, orgName: string, inviter: string, link: string): Mail {
  const text = `${inviter} invited you to join ${orgName} on Peblo.\n\nOpen this link while signed in with ${to}: ${link}\n\nThe link works once and expires in ${INVITE_DAYS} days. If you were not expecting it, ignore this email.`;
  return { to, subject: `${inviter} invited you to ${orgName} on Peblo`, text };
}

router.post('/orgs/:orgId/invites', async (req, res) => {
  const org = await gate(req, res, true); if (!org) return;
  const orgId = req.params.orgId;
  const email = String(req.body?.email ?? '').trim().toLowerCase();
  const orgRole: OrgRole = ORG_ROLES.includes(req.body?.orgRole) ? req.body.orgRole : 'member';
  let spaceRole: SpaceRole = SPACE_ROLES.includes(req.body?.spaceRole) ? req.body.spaceRole : 'member';
  if (!EMAIL.test(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
  const pol = (await prisma.$queryRaw<{ policy: any }[]>`SELECT policy FROM organizations WHERE id = ${orgId}`)[0]?.policy ?? {};
  if (orgRole === 'guest' && pol.guests !== true) return res.status(403).json({ error: 'Guests are turned off in this organization.' });
  if (orgRole === 'owner' && org.role !== 'owner') return res.status(403).json({ error: 'Only an owner can invite another owner.' });
  const wanted: string[] = Array.isArray(req.body?.spaceIds) ? req.body.spaceIds.filter((x: unknown) => typeof x === 'string') : [];
  const valid = wanted.length ? await prisma.$queryRaw<{ id: string }[]>`SELECT id FROM spaces WHERE org_id = ${orgId} AND closed_at IS NULL AND id = ANY(${wanted}::text[])` : [];
  const spaceIds = valid.map((v) => v.id);
  if (!SPACE_ROLES.includes(req.body?.spaceRole) && spaceIds.length === 1) {
    const d = await prisma.$queryRaw<{ default_role: SpaceRole }[]>`SELECT default_role FROM spaces WHERE id = ${spaceIds[0]}`;
    if (d[0]) spaceRole = d[0].default_role;
  }
  const already = await prisma.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM org_members m JOIN users u ON u.id = m.user_id WHERE m.org_id = ${orgId} AND lower(u.email) = ${email}`;
  if ((already[0]?.n ?? 0) > 0) return res.status(409).json({ error: 'That person is already a member.' });
  await prisma.$executeRaw`UPDATE org_invites SET revoked_at = now() WHERE org_id = ${orgId} AND email = ${email}::citext AND accepted_at IS NULL AND revoked_at IS NULL`;
  const raw = crypto.randomBytes(32).toString('base64url');
  const id = crypto.randomUUID();
  await prisma.$executeRaw`INSERT INTO org_invites (id, org_id, email, org_role, space_ids, space_role, token_hash, invited_by, expires_at)
    VALUES (${id}, ${orgId}, ${email}::citext, ${orgRole}, ${JSON.stringify(spaceIds)}::jsonb, ${spaceRole}, ${hash(raw)}, ${uid(req)}, now() + (${INVITE_DAYS} * interval '1 day'))`;
  await audit(orgId, uid(req), 'invite.sent', email, { orgRole, spaceIds, spaceRole });
  const names = await prisma.$queryRaw<{ org: string; me: string }[]>`SELECT (SELECT name FROM organizations WHERE id = ${orgId}) AS org, (SELECT name FROM users WHERE id = ${uid(req)}) AS me`;
  const link = `${publicBase(req)}/invite?token=${raw}`;
  const mailed = await sendMail(inviteMail(email, names[0]?.org ?? 'an organization', names[0]?.me ?? 'Someone', link)).catch(() => false);
  res.status(201).json({ id, link, mailed });
});

router.delete('/orgs/:orgId/invites/:id', async (req, res) => {
  if (!(await gate(req, res, true))) return;
  const n = await prisma.$executeRaw`UPDATE org_invites SET revoked_at = now() WHERE id = ${req.params.id} AND org_id = ${req.params.orgId} AND accepted_at IS NULL AND revoked_at IS NULL`;
  if (!n) return res.status(404).json({ error: 'Invite not found.' });
  await audit(req.params.orgId, uid(req), 'invite.revoked', req.params.id);
  res.json({ ok: true });
});

/** What an invite link would do for the signed-in person, without doing it: the states of the C08 screen. */
async function lookup(token: string, userId: string) {
  const rows = await prisma.$queryRaw<any[]>`
    SELECT i.id, i.org_id AS "orgId", i.email::text AS email, i.org_role AS "orgRole", i.space_ids AS "spaceIds", i.space_role AS "spaceRole", i.invited_by AS "invitedBy",
           i.expires_at AS "expiresAt", i.accepted_at AS "acceptedAt", i.revoked_at AS "revokedAt", o.name AS "orgName", o.closed_at AS "orgClosed"
    FROM org_invites i JOIN organizations o ON o.id = i.org_id WHERE i.token_hash = ${hash(token)}`;
  const inv = rows[0];
  if (!inv) return { state: 'invalid' as const };
  const me = await prisma.$queryRaw<{ email: string; verified: boolean }[]>`SELECT email, (email_verified_at IS NOT NULL) AS verified FROM users WHERE id = ${userId}`;
  const base = { orgName: inv.orgName, email: inv.email };
  if (inv.revokedAt || inv.orgClosed) return { state: 'revoked' as const, ...base };
  if (inv.acceptedAt) return { state: 'used' as const, ...base };
  if (new Date(inv.expiresAt) < new Date()) return { state: 'expired' as const, ...base };
  const member = await prisma.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM org_members WHERE org_id = ${inv.orgId} AND user_id = ${userId}`;
  if ((member[0]?.n ?? 0) > 0) return { state: 'member' as const, ...base };
  if (!me[0] || me[0].email.toLowerCase() !== inv.email.toLowerCase()) return { state: 'wrong_account' as const, ...base };
  if (!me[0].verified) return { state: 'unverified' as const, ...base };
  return { state: 'ready' as const, ...base, inv };
}

router.get('/invites/lookup', async (req, res) => {
  const r: any = await lookup(String(req.query.token ?? ''), uid(req));
  const { inv: _inv, ...out } = r;
  res.json(out);
});

router.post('/invites/accept', async (req, res) => {
  const userId = uid(req);
  const r: any = await lookup(String(req.body?.token ?? ''), userId);
  if (r.state !== 'ready') return res.status(409).json({ error: 'This invite cannot be accepted.', state: r.state });
  const inv = r.inv;
  const spaceIds: string[] = Array.isArray(inv.spaceIds) ? inv.spaceIds : [];
  const guestUntil = inv.orgRole === 'guest' ? new Date(Date.now() + 30 * 86400000) : null;
  await prisma.$transaction([
    prisma.$executeRaw`INSERT INTO org_members (org_id, user_id, role, guest_until) VALUES (${inv.orgId}, ${userId}, ${inv.orgRole}, ${guestUntil}) ON CONFLICT DO NOTHING`,
    prisma.$executeRaw`UPDATE org_invites SET accepted_at = now() WHERE id = ${inv.id}`,
    ...spaceIds.map((s) => prisma.$executeRaw`INSERT INTO space_members (space_id, user_id, role, added_by) VALUES (${s}, ${userId}, ${inv.spaceRole}, ${inv.invitedBy ?? null}) ON CONFLICT DO NOTHING`),
  ]);
  await audit(inv.orgId, userId, 'member.joined', userId, { orgRole: inv.orgRole, spaceIds });
  res.json({ ok: true, orgId: inv.orgId, orgName: inv.orgName });
});

async function ownerCount(orgId: string) {
  const r = await prisma.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM org_members WHERE org_id = ${orgId} AND role = 'owner' AND status = 'active'`;
  return r[0]?.n ?? 0;
}

/** Change an org role, or pause/resume a member. Only an owner can create or demote an owner; the last owner cannot be demoted. */
router.patch('/orgs/:orgId/members/:userId', async (req, res) => {
  const org = await gate(req, res, true); if (!org) return;
  const { orgId, userId } = req.params;
  const target = await prisma.$queryRaw<{ role: OrgRole }[]>`SELECT role FROM org_members WHERE org_id = ${orgId} AND user_id = ${userId}`;
  if (!target[0]) return res.status(404).json({ error: 'Member not found.' });
  const role: OrgRole | undefined = ORG_ROLES.includes(req.body?.role) ? req.body.role : undefined;
  const status = req.body?.status === 'paused' || req.body?.status === 'active' ? req.body.status : undefined;
  if ((role === 'owner' || target[0].role === 'owner') && org.role !== 'owner') return res.status(403).json({ error: 'Only an owner can change an owner.' });
  if (target[0].role === 'owner' && ((role && role !== 'owner') || status === 'paused') && (await ownerCount(orgId)) <= 1) return res.status(409).json({ error: 'Make someone else an owner first.' });
  if (role) await prisma.$executeRaw`UPDATE org_members SET role = ${role} WHERE org_id = ${orgId} AND user_id = ${userId}`;
  if (status) await prisma.$executeRaw`UPDATE org_members SET status = ${status} WHERE org_id = ${orgId} AND user_id = ${userId}`;
  await audit(orgId, uid(req), 'member.updated', userId, { role, status });
  res.json({ ok: true });
});

/** Remove a member (or leave). Their tasks in this organization's spaces become unassigned; nothing they wrote is deleted. */
async function removeMember(orgId: string, userId: string, actor: string) {
  await prisma.$transaction([
    prisma.$executeRaw`UPDATE todos SET assignee_id = NULL WHERE assignee_id = ${userId} AND space_id IN (SELECT id FROM spaces WHERE org_id = ${orgId})`,
    prisma.$executeRaw`DELETE FROM space_members WHERE user_id = ${userId} AND space_id IN (SELECT id FROM spaces WHERE org_id = ${orgId})`,
    prisma.$executeRaw`DELETE FROM org_members WHERE org_id = ${orgId} AND user_id = ${userId}`,
  ]);
  await audit(orgId, actor, userId === actor ? 'member.left' : 'member.removed', userId);
}

router.delete('/orgs/:orgId/members/:userId', async (req, res) => {
  const org = await gate(req, res, true); if (!org) return;
  const { orgId, userId } = req.params;
  const target = await prisma.$queryRaw<{ role: OrgRole }[]>`SELECT role FROM org_members WHERE org_id = ${orgId} AND user_id = ${userId}`;
  if (!target[0]) return res.status(404).json({ error: 'Member not found.' });
  if (target[0].role === 'owner' && (org.role !== 'owner' || (await ownerCount(orgId)) <= 1)) return res.status(409).json({ error: 'An owner cannot be removed. Transfer ownership first.' });
  await removeMember(orgId, userId, uid(req));
  res.json({ ok: true });
});

router.post('/orgs/:orgId/leave', async (req, res) => {
  const org = await gate(req, res, false); if (!org) return;
  if (org.role === 'owner' && (await ownerCount(req.params.orgId)) <= 1) return res.status(409).json({ error: 'You are the only owner. Make someone else an owner before you leave.' });
  await removeMember(req.params.orgId, uid(req), uid(req));
  res.json({ ok: true });
});

/** Add or change a person's role in one space (a team lead, or an org owner/admin). */
router.put('/spaces/:spaceId/members/:userId', async (req, res) => {
  const sp = await prisma.$queryRaw<{ org_id: string }[]>`SELECT org_id FROM spaces WHERE id = ${req.params.spaceId} AND closed_at IS NULL`;
  if (!sp[0]) return res.status(404).json({ error: 'Team not found.' });
  const org = await orgAccess(uid(req), sp[0].org_id);
  const mine = await prisma.$queryRaw<{ role: SpaceRole }[]>`SELECT role FROM space_members WHERE space_id = ${req.params.spaceId} AND user_id = ${uid(req)}`;
  if (!org || !(can('space.manage', org, mine[0]?.role ?? null) || can('org.manage', org))) return res.status(403).json({ error: 'Only a team lead or an admin can do that.' });
  const role: SpaceRole = SPACE_ROLES.includes(req.body?.role) ? req.body.role : 'member';
  const inOrg = await prisma.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM org_members WHERE org_id = ${sp[0].org_id} AND user_id = ${req.params.userId} AND status = 'active'`;
  if (!inOrg[0]?.n) return res.status(400).json({ error: 'Invite that person to the organization first.' });
  await prisma.$executeRaw`INSERT INTO space_members (space_id, user_id, role, added_by) VALUES (${req.params.spaceId}, ${req.params.userId}, ${role}, ${uid(req)}) ON CONFLICT (space_id, user_id) DO UPDATE SET role = ${role}`;
  await audit(sp[0].org_id, uid(req), 'space.member_set', req.params.userId, { spaceId: req.params.spaceId, role });
  res.json({ ok: true });
});

router.get('/orgs/:orgId/audit', async (req, res) => {
  if (!(await gate(req, res, true))) return;
  const rows = await prisma.$queryRaw<any[]>`
    SELECT a.id, a.action, a.target, a.detail, a.at, u.name AS "actorName"
    FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id WHERE a.org_id = ${req.params.orgId} ORDER BY a.at DESC LIMIT 200`;
  res.json({ events: rows });
});


/** Organization policy (mockup C04). Only settings that change what the app does are offered. */
const policyOf = (p: any) => ({ guests: p?.guests === true, membersCreateTeams: p?.membersCreateTeams !== false });
router.get('/orgs/:orgId/policy', async (req, res) => {
  if (!(await gate(req, res, false))) return;
  const r = await prisma.$queryRaw<{ policy: any }[]>`SELECT policy FROM organizations WHERE id = ${req.params.orgId}`;
  res.json({ policy: policyOf(r[0]?.policy) });
});
router.patch('/orgs/:orgId/policy', async (req, res) => {
  if (!(await gate(req, res, true))) return;
  const cur = (await prisma.$queryRaw<{ policy: any }[]>`SELECT policy FROM organizations WHERE id = ${req.params.orgId}`)[0]?.policy ?? {};
  const next = { ...cur };
  for (const k of ['guests', 'membersCreateTeams']) if (typeof req.body?.[k] === 'boolean') next[k] = req.body[k];
  await prisma.$executeRaw`UPDATE organizations SET policy = ${JSON.stringify(next)}::jsonb WHERE id = ${req.params.orgId}`;
  await audit(req.params.orgId, uid(req), 'policy.changed', null, req.body ?? {});
  res.json({ policy: policyOf(next) });
});

/** Everything in the organization in one file (mockup C07). Owners and admins only; each export is written to the audit log. */
router.get('/orgs/:orgId/export', async (req, res) => {
  const org = await gate(req, res, true); if (!org) return;
  const orgId = req.params.orgId;
  const [o, members, spaces, notes, tasks, posts] = await Promise.all([
    prisma.$queryRaw<any[]>`SELECT id, name, status, policy, created_at AS "createdAt" FROM organizations WHERE id = ${orgId}`,
    prisma.$queryRaw<any[]>`SELECT u.name, u.email, m.role, m.status, m.joined_at AS "joinedAt" FROM org_members m JOIN users u ON u.id = m.user_id WHERE m.org_id = ${orgId}`,
    prisma.$queryRaw<any[]>`SELECT id, kind, name, default_role AS "defaultRole", created_at AS "createdAt", closed_at AS "closedAt" FROM spaces WHERE org_id = ${orgId}`,
    prisma.$queryRaw<{ id: string }[]>`SELECT n.id FROM notes n JOIN spaces s ON s.id = n.space_id WHERE s.org_id = ${orgId} ORDER BY n.created_at`,
    prisma.$queryRaw<{ id: string }[]>`SELECT t.id FROM todos t JOIN spaces s ON s.id = t.space_id WHERE s.org_id = ${orgId} ORDER BY t.created_at`,
    prisma.$queryRaw<any[]>`SELECT a.id, a.space_id AS "spaceId", a.title, a.body, a.status, a.version, a.retracted_at AS "retractedAt", a.created_at AS "createdAt" FROM announcements a JOIN spaces s ON s.id = a.space_id WHERE s.org_id = ${orgId}`,
  ]);
  const spaceIds = spaces.map((s) => s.id);
  const noteRows = spaceIds.length ? await prisma.note.findMany({ where: { spaceId: { in: spaceIds } }, select: { id: true, spaceId: true, title: true, content: true, isDeleted: true, isArchived: true, createdAt: true, updatedAt: true } }) : [];
  const taskRows = spaceIds.length ? await prisma.todo.findMany({ where: { spaceId: { in: spaceIds } }, select: { id: true, spaceId: true, text: true, completed: true, priority: true, deadline: true, assigneeId: true, createdAt: true } }) : [];
  void notes; void tasks;
  await audit(orgId, uid(req), 'org.exported', orgId, { notes: noteRows.length, tasks: taskRows.length });
  res.setHeader('Content-Disposition', `attachment; filename="organization-export.json"`);
  res.json({ exportedAt: new Date().toISOString(), organization: o[0], members, spaces, notes: noteRows, tasks: taskRows, announcements: posts });
});

/** Team settings (mockup C11). A lead, or an owner/admin, can change them. */
async function spaceGate(req: any, res: any) {
  const sp = await prisma.$queryRaw<{ org_id: string; kind: string }[]>`SELECT org_id, kind FROM spaces WHERE id = ${req.params.spaceId} AND closed_at IS NULL`;
  if (!sp[0]) { res.status(404).json({ error: 'Team not found.' }); return null; }
  const org = await orgAccess(uid(req), sp[0].org_id);
  const mine = await prisma.$queryRaw<{ role: SpaceRole }[]>`SELECT role FROM space_members WHERE space_id = ${req.params.spaceId} AND user_id = ${uid(req)}`;
  if (!org) { res.status(404).json({ error: 'Team not found.' }); return null; }
  return { org, orgId: sp[0].org_id, role: mine[0]?.role ?? null, manage: can('space.manage', org, mine[0]?.role ?? null) || can('org.manage', org) };
}
router.patch('/spaces/:spaceId', async (req, res) => {
  const g = await spaceGate(req, res); if (!g) return;
  if (!g.manage) return res.status(403).json({ error: 'Only a team lead or an admin can change this.' });
  const name = typeof req.body?.name === 'string' ? req.body.name.replace(/\s+/g, ' ').trim().slice(0, 80) : '';
  if (name && name.length < 2) return res.status(400).json({ error: 'Give the team a name of at least 2 letters.' });
  const role = req.body?.defaultRole === 'viewer' || req.body?.defaultRole === 'member' ? req.body.defaultRole : null;
  if (name) await prisma.$executeRaw`UPDATE spaces SET name = ${name} WHERE id = ${req.params.spaceId}`;
  if (role) await prisma.$executeRaw`UPDATE spaces SET default_role = ${role} WHERE id = ${req.params.spaceId}`;
  await audit(g.orgId, uid(req), 'space.updated', req.params.spaceId, { name: name || undefined, defaultRole: role || undefined });
  res.json({ ok: true });
});
/** Leave a team: your open tasks there become unassigned; the last lead hands over first. */
router.post('/spaces/:spaceId/leave', async (req, res) => {
  const g = await spaceGate(req, res); if (!g) return;
  if (!g.role) return res.status(409).json({ error: 'You are not in this team.' });
  if (g.role === 'lead') {
    const n = await prisma.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM space_members WHERE space_id = ${req.params.spaceId} AND role = 'lead'`;
    if ((n[0]?.n ?? 0) <= 1) return res.status(409).json({ error: 'You are the only lead. Make someone else a lead before you leave.' });
  }
  await prisma.$transaction([
    prisma.$executeRaw`UPDATE todos SET assignee_id = NULL WHERE assignee_id = ${uid(req)} AND space_id = ${req.params.spaceId}`,
    prisma.$executeRaw`DELETE FROM space_members WHERE space_id = ${req.params.spaceId} AND user_id = ${uid(req)}`,
  ]);
  await audit(g.orgId, uid(req), 'space.left', req.params.spaceId);
  res.json({ ok: true });
});
/** Close a team. Nothing is deleted: the notes stay in the database and in the organization export. */
router.post('/spaces/:spaceId/close', async (req, res) => {
  const g = await spaceGate(req, res); if (!g) return;
  if (!g.manage) return res.status(403).json({ error: 'Only a team lead or an admin can close a team.' });
  await prisma.$executeRaw`UPDATE spaces SET closed_at = now() WHERE id = ${req.params.spaceId}`;
  await audit(g.orgId, uid(req), 'space.closed', req.params.spaceId);
  res.json({ ok: true });
});

export default router;

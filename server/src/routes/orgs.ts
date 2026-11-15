import { Router } from 'express';
import crypto from 'crypto';
import prisma from '../db.js';
import { authenticate } from '../middleware/auth.js';
import { notifyUsers, nameOf } from '../services/notify.js';
import { audit, can, orgAccess, type OrgRole, type SpaceRole } from '../utils/access.js';
import { refreshUserRooms, kickFromSpace, refreshSpaceRoom } from '../utils/spaceRooms.js';
import { policyOf, POLICY_KEYS } from '../utils/orgPolicy.js';
import { decryptSecret, encryptSecret } from '../secrets.js';
import { publicBase, sendMail, type Mail } from '../services/mailer.js';
import { seatBlock, SeatLimitError } from '../utils/seats.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { revokeOrgLinks, revokeSpaceLinks } from '../utils/shareScope.js';
import bcrypt from 'bcryptjs';

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
  const caller = await gate(req, res, false); if (!caller) return;
  const orgId = req.params.orgId;
  const guest = caller.role === 'guest';
  const me = uid(req);
  const members = await prisma.$queryRaw<any[]>`
    SELECT m.user_id AS "userId", u.name, u.avatar, u.email, m.role, m.status, m.guest_until AS "guestUntil", m.joined_at AS "joinedAt",
           (SELECT count(*)::int FROM todos t WHERE t.assignee_id = m.user_id AND t.is_completed = false AND t.space_id IN (SELECT id FROM spaces WHERE org_id = m.org_id)) AS "openTasks",
           COALESCE((SELECT json_agg(json_build_object('id', s.id, 'name', s.name, 'kind', s.kind, 'role', sm.role) ORDER BY s.created_at)
                     FROM space_members sm JOIN spaces s ON s.id = sm.space_id AND s.org_id = m.org_id AND s.closed_at IS NULL
                     WHERE sm.user_id = m.user_id), '[]'::json) AS spaces
    FROM org_members m JOIN users u ON u.id = m.user_id WHERE m.org_id = ${orgId}
      AND (${!guest} OR m.user_id = ${me} OR EXISTS (SELECT 1 FROM space_members a JOIN space_members b ON b.space_id = a.space_id AND b.user_id = ${me} WHERE a.user_id = m.user_id))
    ORDER BY m.joined_at`;
  // a guest sees only the people who share a space with them, and only name, picture and role (no email, task counts or other spaces)
  if (guest) return res.json({ members: members.map((m) => ({ userId: m.userId, name: m.name, avatar: m.avatar, role: m.role, status: m.status })), invites: [] });
  const invites = await prisma.$queryRaw<any[]>`
    SELECT id, email::text AS email, org_role AS "orgRole", space_ids AS "spaceIds", space_role AS "spaceRole", created_at AS "createdAt", expires_at AS "expiresAt"
    FROM org_invites WHERE org_id = ${orgId} AND accepted_at IS NULL AND revoked_at IS NULL ORDER BY created_at DESC`;
  res.json({ members, invites });
});

/** The token goes after the # so it never reaches a server log or a Referer header, and the client strips it from the address bar (R13). */
const inviteLink = (req: any, raw: string) => `${publicBase(req)}/invite#token=${raw}`;

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
  if (orgRole !== 'guest') { const full = await seatBlock(prisma, orgId, { excludeEmail: email }); if (full) return res.status(409).json(full); } // R15: members and pending invites share the seat limit
  await prisma.$executeRaw`UPDATE org_invites SET revoked_at = now() WHERE org_id = ${orgId} AND email = ${email}::citext AND accepted_at IS NULL AND revoked_at IS NULL`;
  const raw = crypto.randomBytes(32).toString('base64url');
  const id = crypto.randomUUID();
  await prisma.$executeRaw`INSERT INTO org_invites (id, org_id, email, org_role, space_ids, space_role, token_hash, invited_by, expires_at)
    VALUES (${id}, ${orgId}, ${email}::citext, ${orgRole}, ${JSON.stringify(spaceIds)}::jsonb, ${spaceRole}, ${hash(raw)}, ${uid(req)}, now() + (${INVITE_DAYS} * interval '1 day'))`;
  await audit(orgId, uid(req), 'invite.sent', email, { orgRole, spaceIds, spaceRole });
  const names = await prisma.$queryRaw<{ org: string; me: string }[]>`SELECT (SELECT name FROM organizations WHERE id = ${orgId}) AS org, (SELECT name FROM users WHERE id = ${uid(req)}) AS me`;
  const link = inviteLink(req, raw);
  const mailed = await sendMail(inviteMail(email, names[0]?.org ?? 'an organization', names[0]?.me ?? 'Someone', link)).catch(() => false);
  // someone who already has a Peblo account also sees it in their notifications. It carries no token: it points at /invite, where they open it from their own pending list.
  const known = await prisma.$queryRaw<{ id: string }[]>`SELECT id FROM users WHERE lower(email) = ${email}`;
  if (known[0]) await notifyUsers(req.app, [known[0].id], { kind: 'org_invite', title: `${names[0]?.me ?? 'Someone'} invited you to ${names[0]?.org ?? 'an organization'}`, body: '', from: names[0]?.me ?? 'Someone' });
  res.status(201).json({ id, link, mailed });
});

/** Resend an invite, or make its link again to copy. Only a hash of the token is stored, so this issues a NEW token (the old link stops working) and restarts the 7 days. `{ mail: false }` only returns the link. */
const resendLimit = rateLimit({ windowMs: 60 * 60_000, max: 30, key: (req: any) => (req.user?.id ? `invite-resend:${req.user.id}` : ''), message: 'Too many invite links made. Try again in a while.' });
router.post('/orgs/:orgId/invites/:id/resend', resendLimit, async (req, res) => {
  const org = await gate(req, res, true); if (!org) return;
  const orgId = String(req.params.orgId);
  const raw = crypto.randomBytes(32).toString('base64url');
  const rows = await prisma.$queryRaw<{ email: string }[]>`UPDATE org_invites SET token_hash = ${hash(raw)}, expires_at = now() + (${INVITE_DAYS} * interval '1 day'), last_reminded_at = NULL
    WHERE id = ${req.params.id} AND org_id = ${orgId} AND accepted_at IS NULL AND revoked_at IS NULL RETURNING email::text AS email`;
  if (!rows[0]) return res.status(404).json({ error: 'Invite not found.' });
  const link = inviteLink(req, raw);
  const send = req.body?.mail !== false;
  await audit(orgId, uid(req), send ? 'invite.resent' : 'invite.link_copied', rows[0].email);
  let mailed = false;
  if (send) {
    const names = await prisma.$queryRaw<{ org: string; me: string }[]>`SELECT (SELECT name FROM organizations WHERE id = ${orgId}) AS org, (SELECT name FROM users WHERE id = ${uid(req)}) AS me`;
    mailed = await sendMail(inviteMail(rows[0].email, names[0]?.org ?? 'an organization', names[0]?.me ?? 'Someone', link)).catch(() => false);
  }
  res.json({ link, mailed });
});

router.delete('/orgs/:orgId/invites/:id', async (req, res) => {
  if (!(await gate(req, res, true))) return;
  const n = await prisma.$executeRaw`UPDATE org_invites SET revoked_at = now() WHERE id = ${req.params.id} AND org_id = ${req.params.orgId} AND accepted_at IS NULL AND revoked_at IS NULL`;
  if (!n) return res.status(404).json({ error: 'Invite not found.' });
  await audit(req.params.orgId, uid(req), 'invite.revoked', req.params.id);
  res.json({ ok: true });
});

/** What an invite would do for the signed-in person, without doing it: the states of the C08 screen. The invite is named by its token (from the link) or by its id (from the person's own list, which needs the matching email). */
async function lookup(token: string, userId: string, inviteId = '') {
  const th = inviteId ? 'by-id' : hash(token); // never equal to a real hash, so only one of the two conditions can match
  const rows = await prisma.$queryRaw<any[]>`
    SELECT i.id, i.org_id AS "orgId", i.email::text AS email, i.org_role AS "orgRole", i.space_ids AS "spaceIds", i.space_role AS "spaceRole", i.invited_by AS "invitedBy",
           i.expires_at AS "expiresAt", i.accepted_at AS "acceptedAt", i.revoked_at AS "revokedAt", o.name AS "orgName", o.closed_at AS "orgClosed", o.status AS "orgStatus", (SELECT name FROM users WHERE id = i.invited_by) AS "inviterName"
    FROM org_invites i JOIN organizations o ON o.id = i.org_id WHERE i.token_hash = ${th} OR i.id = ${inviteId}`;
  const inv = rows[0];
  if (!inv) return { state: 'invalid' as const };
  const me = await prisma.$queryRaw<{ email: string; verified: boolean }[]>`SELECT email, (email_verified_at IS NOT NULL) AS verified FROM users WHERE id = ${userId}`;
  // an id alone is not a secret: it only works for the person the invite was sent to
  if (inviteId && (!me[0] || me[0].email.toLowerCase() !== inv.email.toLowerCase())) return { state: 'invalid' as const };
  const base = { orgName: inv.orgName, email: inv.email, inviterName: inv.inviterName ?? null, role: inv.orgRole, signedInAs: me[0]?.email ?? null };
  if (inv.revokedAt || inv.orgClosed) return { state: 'revoked' as const, ...base };
  if (inv.acceptedAt) return { state: 'used' as const, ...base };
  if (new Date(inv.expiresAt) < new Date()) return { state: 'expired' as const, ...base };
  const member = await prisma.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM org_members WHERE org_id = ${inv.orgId} AND user_id = ${userId}`;
  if ((member[0]?.n ?? 0) > 0) return { state: 'member' as const, ...base };
  if (!me[0] || me[0].email.toLowerCase() !== inv.email.toLowerCase()) return { state: 'wrong_account' as const, ...base };
  if (!me[0].verified) return { state: 'unverified' as const, ...base };
  return { state: 'ready' as const, ...base, inv };
}

/** The signed-in person's own pending invites (matched on their verified email), so an invite never has to be carried in a notification. */
async function myInvites(req: any, res: any) {
  const me = await prisma.$queryRaw<{ email: string; verified: boolean }[]>`SELECT email, (email_verified_at IS NOT NULL) AS verified FROM users WHERE id = ${uid(req)}`;
  if (!me[0]) return res.json({ invites: [], verified: false });
  if (!me[0].verified) return res.json({ invites: [], verified: false, email: me[0].email });
  const rows = await prisma.$queryRaw<any[]>`
    SELECT i.id, o.name AS "orgName", i.org_role AS "role", i.created_at AS "createdAt", i.expires_at AS "expiresAt", (i.expires_at < now()) AS expired, u.name AS "inviterName"
    FROM org_invites i JOIN organizations o ON o.id = i.org_id AND o.closed_at IS NULL LEFT JOIN users u ON u.id = i.invited_by
    WHERE i.email = ${me[0].email.toLowerCase()}::citext AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > now() - interval '30 days'
      AND NOT EXISTS (SELECT 1 FROM org_members m WHERE m.org_id = i.org_id AND m.user_id = ${uid(req)})
    ORDER BY i.created_at DESC LIMIT 50`;
  res.json({ invites: rows, verified: true, email: me[0].email });
}
router.get('/invites/mine', myInvites);
router.get('/orgs/invites/mine', myInvites);

const inviteKey = (b: any) => ({ token: typeof b?.token === 'string' ? b.token : '', id: typeof b?.inviteId === 'string' ? b.inviteId : '' });
// POST keeps the token out of the URL (access logs); GET stays for older clients
router.post('/invites/lookup', async (req, res) => {
  const k = inviteKey(req.body);
  const { inv: _inv, ...out }: any = await lookup(k.token, uid(req), k.id);
  res.json(out);
});
router.get('/invites/lookup', async (req, res) => {
  const r: any = await lookup(String(req.query.token ?? ''), uid(req));
  const { inv: _inv, ...out } = r;
  res.json(out);
});

/** An expired invite: the person asks the one who invited them for a new one (mockup C08). It tells the inviter, and nothing else. One reminder per invite per 24 hours. */
router.post('/invites/remind', async (req, res) => {
  const userId = uid(req);
  const k = inviteKey(req.body);
  const th = k.id ? 'by-id' : hash(k.token);
  const rows = await prisma.$queryRaw<any[]>`SELECT i.id, i.invited_by AS "invitedBy", i.email::text AS email, o.name AS "orgName" FROM org_invites i JOIN organizations o ON o.id = i.org_id WHERE (i.token_hash = ${th} OR i.id = ${k.id}) AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at < now()`;
  const inv = rows[0];
  if (!inv) return res.status(409).json({ error: 'There is nothing to remind about.' });
  const me = await prisma.$queryRaw<{ email: string }[]>`SELECT email FROM users WHERE id = ${userId}`;
  if (!me[0] || me[0].email.toLowerCase() !== String(inv.email).toLowerCase()) return res.status(403).json({ error: 'This invite is for another address.' });
  // claim the reminder first: two quick presses (or two windows) send one notification
  const claimed = await prisma.$executeRaw`UPDATE org_invites SET last_reminded_at = now() WHERE id = ${inv.id} AND (last_reminded_at IS NULL OR last_reminded_at < now() - interval '24 hours')`;
  if (!claimed) return res.status(429).json({ error: 'You already asked for a new invite today. They have been told.' });
  if (inv.invitedBy) await notifyUsers(req.app, [inv.invitedBy], { kind: 'invite_reminder', title: `${await nameOf(userId)} asked for a new invite to ${inv.orgName}`, from: await nameOf(userId) });
  res.json({ ok: true });
});

const rooms = (req: any, ...u: string[]) => void refreshUserRooms(req.app.get('io'), ...u); // live team rooms follow membership (R11)
router.post('/invites/accept', async (req, res) => {
  const userId = uid(req);
  const k = inviteKey(req.body);
  const r: any = await lookup(k.token, userId, k.id);
  if (r.state !== 'ready') return res.status(409).json({ error: 'This invite cannot be accepted.', state: r.state });
  const inv = r.inv;
  const spaceIds: string[] = Array.isArray(inv.spaceIds) ? inv.spaceIds : [];
  const guestUntil = inv.orgRole === 'guest' ? new Date(Date.now() + 30 * 86400000) : null;
  let accepted = false;
  try { accepted = await prisma.$transaction(async (tx) => {
    // claim the invite first; a second request for the same invite updates nothing and does nothing else
    const claimed = await tx.$executeRaw`UPDATE org_invites SET accepted_at = now() WHERE id = ${inv.id} AND accepted_at IS NULL AND revoked_at IS NULL`;
    if (!claimed) return false;
    if (inv.orgRole !== 'guest') { await tx.$queryRaw`SELECT id FROM organizations WHERE id = ${inv.orgId} FOR UPDATE`; const full = await seatBlock(tx, inv.orgId); if (full) throw new SeatLimitError(full); } // R15: the claimed invite no longer counts as pending
    await tx.$executeRaw`INSERT INTO org_members (org_id, user_id, role, guest_until) VALUES (${inv.orgId}, ${userId}, ${inv.orgRole}, ${guestUntil}) ON CONFLICT DO NOTHING`;
    for (const s of spaceIds) await tx.$executeRaw`INSERT INTO space_members (space_id, user_id, role, added_by) SELECT id, ${userId}::text, ${inv.spaceRole}::text, ${inv.invitedBy ?? null}::text FROM spaces WHERE id = ${s} AND org_id = ${inv.orgId} AND closed_at IS NULL ON CONFLICT DO NOTHING`;
    return true;
  }); } catch (e) { if (e instanceof SeatLimitError) return res.status(409).json({ ...e.body, state: 'seat_limit' }); throw e; }
  if (!accepted) return res.status(409).json({ error: 'This invite cannot be accepted.', state: 'used' });
  await audit(inv.orgId, userId, 'member.joined', userId, { orgRole: inv.orgRole, spaceIds });
  rooms(req, userId);
  if (inv.invitedBy) await notifyUsers(req.app, [inv.invitedBy], { kind: 'member_joined', title: `${await nameOf(userId)} joined ${inv.orgName}`, from: await nameOf(userId), spaceId: spaceIds[0] ?? null });
  res.json({ ok: true, orgId: inv.orgId, orgName: inv.orgName });
});

/* Expiring join links for an Office (mockups WsE04 to WsE06). Table: 041_org_join_links.sql.
 * An owner or admin makes a link; anyone signed in with a verified email who opens it joins the organization as a member and the Office. */
const joinUrl = (req: any, token: string) => `${publicBase(req)}/join?token=${token}`;

router.post('/orgs/:orgId/join-links', async (req, res) => {
  if (!(await gate(req, res, true))) return;
  const orgId = req.params.orgId;
  const days = req.body?.expiresInDays === undefined ? 7 : Number(req.body.expiresInDays);
  if (!Number.isInteger(days) || days < 1 || days > 90) return res.status(400).json({ error: 'Choose an expiry between 1 and 90 days.' });
  let maxUses: number | null = null;
  if (req.body?.maxUses !== undefined && req.body.maxUses !== null) {
    maxUses = Number(req.body.maxUses);
    if (!Number.isInteger(maxUses) || maxUses < 1 || maxUses > 1000) return res.status(400).json({ error: 'Max uses must be between 1 and 1000.' });
  }
  const spaceRole: 'member' | 'viewer' = req.body?.spaceRole === 'viewer' ? 'viewer' : 'member';
  const wanted = typeof req.body?.spaceId === 'string' ? req.body.spaceId : null;
  const office = (await prisma.$queryRaw<{ id: string; name: string }[]>`
    SELECT id, name FROM spaces WHERE org_id = ${orgId} AND kind = 'office' AND closed_at IS NULL AND (${wanted}::text IS NULL OR id = ${wanted}) ORDER BY created_at LIMIT 1`)[0];
  if (!office) return res.status(400).json({ error: 'Join links are for an Office, and this organization has none yet.', code: 'no_office' });
  const raw = crypto.randomBytes(32).toString('base64url');
  const id = crypto.randomUUID();
  const rows = await prisma.$queryRaw<{ expires_at: Date }[]>`
    INSERT INTO org_join_links (id, org_id, space_id, space_role, token_hash, token_enc, max_uses, created_by, expires_at)
    VALUES (${id}, ${orgId}, ${office.id}, ${spaceRole}, ${hash(raw)}, ${encryptSecret(raw)}, ${maxUses}, ${uid(req)}, now() + (${days} * interval '1 day')) RETURNING expires_at`;
  await audit(orgId, uid(req), 'joinlink.created', id, { spaceId: office.id, days, maxUses, spaceRole });
  res.status(201).json({ id, link: joinUrl(req, raw), spaceId: office.id, spaceName: office.name, spaceRole, expiresAt: rows[0].expires_at, maxUses, uses: 0, state: 'active' });
});

router.get('/orgs/:orgId/join-links', async (req, res) => {
  if (!(await gate(req, res, true))) return;
  const rows = await prisma.$queryRaw<any[]>`
    SELECT l.id, l.space_id AS "spaceId", s.name AS "spaceName", l.space_role AS "spaceRole", l.token_enc, l.max_uses AS "maxUses", l.uses, l.expires_at AS "expiresAt",
           l.created_at AS "createdAt", u.name AS "createdBy"
    FROM org_join_links l JOIN spaces s ON s.id = l.space_id LEFT JOIN users u ON u.id = l.created_by
    WHERE l.org_id = ${req.params.orgId} AND l.revoked_at IS NULL ORDER BY l.created_at DESC`;
  const now = Date.now();
  res.json({ links: rows.map(({ token_enc, ...l }) => {
    const token = decryptSecret(token_enc);
    const state = new Date(l.expiresAt).getTime() <= now ? 'expired' : (l.maxUses && l.uses >= l.maxUses) ? 'full' : 'active';
    return { ...l, link: token ? joinUrl(req, token) : null, state };
  }) });
});

router.delete('/orgs/:orgId/join-links/:id', async (req, res) => {
  if (!(await gate(req, res, true))) return;
  const n = await prisma.$executeRaw`UPDATE org_join_links SET revoked_at = now() WHERE id = ${req.params.id} AND org_id = ${req.params.orgId} AND revoked_at IS NULL`;
  if (!n) return res.status(404).json({ error: 'Link not found.' });
  await audit(req.params.orgId, uid(req), 'joinlink.revoked', req.params.id);
  res.json({ ok: true });
});

/** What a join link would do for the signed-in person, without doing it. */
async function lookupJoin(token: string, userId: string) {
  const rows = await prisma.$queryRaw<any[]>`
    SELECT l.id, l.org_id AS "orgId", l.space_id AS "spaceId", l.space_role AS "spaceRole", l.created_by AS "createdBy", l.max_uses AS "maxUses", l.uses,
           l.expires_at AS "expiresAt", l.revoked_at AS "revokedAt", o.name AS "orgName", o.closed_at AS "orgClosed", o.status AS "orgStatus", s.name AS "spaceName", s.closed_at AS "spaceClosed"
    FROM org_join_links l JOIN organizations o ON o.id = l.org_id JOIN spaces s ON s.id = l.space_id WHERE l.token_hash = ${hash(token)}`;
  const l = rows[0];
  if (!l) return { state: 'invalid' as const };
  const base = { orgName: l.orgName, spaceName: l.spaceName, expiresAt: l.expiresAt };
  if (l.revokedAt || l.orgClosed || l.spaceClosed || l.orgStatus !== 'active') return { state: 'revoked' as const, ...base };
  if (new Date(l.expiresAt) <= new Date()) return { state: 'expired' as const, ...base };
  if (l.maxUses && l.uses >= l.maxUses) return { state: 'full' as const, ...base };
  const already = await prisma.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM space_members sm JOIN org_members m ON m.org_id = ${l.orgId} AND m.user_id = sm.user_id WHERE sm.space_id = ${l.spaceId} AND sm.user_id = ${userId}`;
  if ((already[0]?.n ?? 0) > 0) return { state: 'member' as const, ...base };
  const me = await prisma.$queryRaw<{ verified: boolean }[]>`SELECT (email_verified_at IS NOT NULL) AS verified FROM users WHERE id = ${userId}`;
  if (!me[0]?.verified) return { state: 'unverified' as const, ...base };
  return { state: 'ready' as const, ...base, link: l };
}

router.get('/join-links/lookup', async (req, res) => {
  const r: any = await lookupJoin(String(req.query.token ?? ''), uid(req));
  const { link: _l, ...out } = r;
  res.json(out);
});

router.post('/join-links/accept', async (req, res) => {
  const userId = uid(req);
  const r: any = await lookupJoin(String(req.body?.token ?? ''), userId);
  if (r.state !== 'ready') return res.status(409).json({ error: 'This link cannot be used.', state: r.state });
  const l = r.link;
  // the use is counted inside the same transaction as the inserts: two people racing for the last place cannot both get it, and a failed join does not burn a use
  let took = false;
  try { took = await prisma.$transaction(async (tx) => {
    const n = await tx.$executeRaw`UPDATE org_join_links SET uses = uses + 1 WHERE id = ${l.id} AND revoked_at IS NULL AND expires_at > now() AND (max_uses IS NULL OR uses < max_uses)`;
    if (!n) return false;
    const isMember = (await tx.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM org_members WHERE org_id = ${l.orgId} AND user_id = ${userId}`)[0]?.n ?? 0;
    if (!isMember) { await tx.$queryRaw`SELECT id FROM organizations WHERE id = ${l.orgId} FOR UPDATE`; const full = await seatBlock(tx, l.orgId); if (full) throw new SeatLimitError(full); } // R15: a use is not burned when there is no seat
    await tx.$executeRaw`INSERT INTO org_members (org_id, user_id, role) VALUES (${l.orgId}, ${userId}, 'member') ON CONFLICT DO NOTHING`;
    await tx.$executeRaw`INSERT INTO space_members (space_id, user_id, role, added_by) VALUES (${l.spaceId}, ${userId}, ${l.spaceRole}, ${l.createdBy ?? null}) ON CONFLICT DO NOTHING`;
    return true;
  }); } catch (e) { if (e instanceof SeatLimitError) return res.status(409).json({ ...e.body, state: 'seat_limit' }); throw e; }
  if (!took) return res.status(409).json({ error: 'This link cannot be used.', state: 'full' });
  await audit(l.orgId, userId, 'member.joined_via_link', userId, { linkId: l.id, spaceId: l.spaceId });
  rooms(req, userId);
  if (l.createdBy && l.createdBy !== userId) await notifyUsers(req.app, [l.createdBy], { kind: 'member_joined', title: `${await nameOf(userId)} joined ${l.orgName} with your link`, from: await nameOf(userId), spaceId: l.spaceId });
  res.json({ ok: true, orgId: l.orgId, orgName: l.orgName, spaceId: l.spaceId, spaceName: l.spaceName });
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
  // R15: guest expiry. An owner or admin sets a new end date (it must be in the future, at most a year away); only guests have one.
  let guestUntil: Date | null | undefined;
  if (req.body?.guestUntil !== undefined) {
    const becomesGuest = (role ?? target[0].role) === 'guest';
    if (!becomesGuest) return res.status(400).json({ error: 'Only a guest has an end date.' });
    guestUntil = new Date(String(req.body.guestUntil));
    if (!Number.isFinite(+guestUntil) || +guestUntil <= Date.now()) return res.status(400).json({ error: 'Choose an end date in the future.' });
    if (+guestUntil > Date.now() + 366 * 86400000) return res.status(400).json({ error: 'A guest can stay for at most a year at a time.' });
  }
  // a guest who becomes a member, or a paused member who comes back, takes a seat
  const wasPaused = (await prisma.$queryRaw<{ status: string }[]>`SELECT status FROM org_members WHERE org_id = ${orgId} AND user_id = ${userId}`)[0]?.status === 'paused';
  const nextRole = role ?? target[0].role;
  if (nextRole !== 'guest' && ((target[0].role === 'guest') || (wasPaused && status === 'active'))) {
    const full = await seatBlock(prisma, orgId); if (full) return res.status(409).json(full);
  }
  if (role === 'guest' && target[0].role !== 'guest' && guestUntil === undefined) guestUntil = new Date(Date.now() + 30 * 86400000);
  if (role && role !== 'guest') await prisma.$executeRaw`UPDATE org_members SET guest_until = NULL WHERE org_id = ${orgId} AND user_id = ${userId}`;
  if (guestUntil) await prisma.$executeRaw`UPDATE org_members SET guest_until = ${guestUntil} WHERE org_id = ${orgId} AND user_id = ${userId}`;
  if (role) await prisma.$executeRaw`UPDATE org_members SET role = ${role} WHERE org_id = ${orgId} AND user_id = ${userId}`;
  if (status) await prisma.$executeRaw`UPDATE org_members SET status = ${status} WHERE org_id = ${orgId} AND user_id = ${userId}`;
  await audit(orgId, uid(req), 'member.updated', userId, { role, status, guestUntil: guestUntil ? guestUntil.toISOString() : undefined });
  rooms(req, userId);
  res.json({ ok: true });
});

/** Remove a member (or leave). Their tasks in this organization's spaces become unassigned; nothing they wrote is deleted. */
async function removeMember(orgId: string, userId: string, actor: string, reassignTo: string | null = null) {
  await prisma.$transaction([
    prisma.$executeRaw`UPDATE todos SET assignee_id = ${reassignTo} WHERE assignee_id = ${userId} AND space_id IN (SELECT id FROM spaces WHERE org_id = ${orgId})`,
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
  const to = typeof req.query.reassignTo === 'string' && req.query.reassignTo === uid(req) ? uid(req) : null; // tasks can only be handed to the person removing
  await removeMember(orgId, userId, uid(req), to);
  rooms(req, userId);
  res.json({ ok: true });
});

router.post('/orgs/:orgId/leave', async (req, res) => {
  const org = await gate(req, res, false); if (!org) return;
  if (org.role === 'owner' && (await ownerCount(req.params.orgId)) <= 1) return res.status(409).json({ error: 'You are the only owner. Make someone else an owner before you leave.' });
  await removeMember(req.params.orgId, uid(req), uid(req));
  rooms(req, uid(req));
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
  const target = await prisma.$queryRaw<{ role: OrgRole }[]>`SELECT role FROM org_members WHERE org_id = ${sp[0].org_id} AND user_id = ${req.params.userId} AND status = 'active'`;
  if (!target[0]) return res.status(400).json({ error: 'Invite that person to the organization first.' });
  if (role === 'lead' && target[0].role === 'guest') return res.status(400).json({ error: 'A guest cannot be a team lead.' });
  const current = await prisma.$queryRaw<{ role: SpaceRole }[]>`SELECT role FROM space_members WHERE space_id = ${req.params.spaceId} AND user_id = ${req.params.userId}`;
  if (current[0]?.role === 'lead' && role !== 'lead') {
    const leads = await prisma.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM space_members WHERE space_id = ${req.params.spaceId} AND role = 'lead'`;
    if ((leads[0]?.n ?? 0) <= 1) return res.status(409).json({ error: 'This is the only lead. Make someone else a lead first.' });
  }
  await prisma.$executeRaw`INSERT INTO space_members (space_id, user_id, role, added_by) VALUES (${req.params.spaceId}, ${req.params.userId}, ${role}, ${uid(req)}) ON CONFLICT (space_id, user_id) DO UPDATE SET role = ${role}`;
  await audit(sp[0].org_id, uid(req), 'space.member_set', req.params.userId, { spaceId: req.params.spaceId, role });
  rooms(req, req.params.userId);
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
router.get('/orgs/:orgId/policy', async (req, res) => {
  if (!(await gate(req, res, false))) return;
  const r = await prisma.$queryRaw<{ policy: any }[]>`SELECT policy FROM organizations WHERE id = ${req.params.orgId}`;
  res.json({ policy: policyOf(r[0]?.policy) });
});
router.patch('/orgs/:orgId/policy', async (req, res) => {
  if (!(await gate(req, res, true))) return;
  const cur = (await prisma.$queryRaw<{ policy: any }[]>`SELECT policy FROM organizations WHERE id = ${req.params.orgId}`)[0]?.policy ?? {};
  const next = { ...cur };
  for (const k of POLICY_KEYS) if (typeof req.body?.[k] === 'boolean') next[k] = req.body[k];
  await prisma.$executeRaw`UPDATE organizations SET policy = ${JSON.stringify(next)}::jsonb WHERE id = ${req.params.orgId}`;
  await audit(req.params.orgId, uid(req), 'policy.changed', null, req.body ?? {});
  // turning public links off ends every link that already exists in this organization's spaces, in this same request (R9)
  const revoked = req.body?.publicShares === false ? await revokeOrgLinks(req.params.orgId, uid(req), 'policy.publicShares') : null;
  res.json({ policy: policyOf(next), ...(revoked ? { revoked } : {}) });
});

/** Everything in the organization in one file (mockup C07). Owners and admins only, and only with their password again (R19). Each export is written to the audit log BEFORE it starts,
 *  at most 3 per hour per organization, trashed notes are left out unless ?includeTrash=1, and notes are read 200 at a time so a big team does not fill the server's memory. */
const exportPasswordLimit = rateLimit({ windowMs: 15 * 60_000, max: 8, skipSuccessful: true, key: (req: any) => (req.user?.id ? `export-pw:${req.user.id}` : ''), message: 'Too many attempts. Wait a few minutes and try again.' });
const EXPORT_PER_HOUR = 3;
const EXPORT_CHUNK = 200;
router.post('/orgs/:orgId/export', exportPasswordLimit, async (req, res, next) => {
  try {
    const org = await gate(req, res, true); if (!org) return;
    const orgId = String(req.params.orgId);
    const password = String(req.body?.password || '').slice(0, 200);
    const user = await prisma.user.findUnique({ where: { id: uid(req) }, select: { passwordHash: true } });
    if (!user || !password || !(await bcrypt.compare(password, user.passwordHash))) return res.status(403).json({ error: 'That password is not correct.', code: 'bad_password' });
    const recent = (await prisma.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM audit_log WHERE org_id = ${orgId} AND action = 'org.exported' AND at > now() - interval '1 hour'`)[0]?.n ?? 0;
    if (recent >= EXPORT_PER_HOUR) return res.status(429).json({ error: `This organization can be exported ${EXPORT_PER_HOUR} times an hour. Try again later.`, code: 'export_limit' });
    const includeTrash = req.query.includeTrash === '1' || req.body?.includeTrash === true;
    await audit(orgId, uid(req), 'org.exported', orgId, { includeTrash }); // before anything is read
    const [o, members, spaces, posts] = await Promise.all([
      prisma.$queryRaw<any[]>`SELECT id, name, status, policy, created_at AS "createdAt" FROM organizations WHERE id = ${orgId}`,
      prisma.$queryRaw<any[]>`SELECT u.name, u.email, m.role, m.status, m.joined_at AS "joinedAt" FROM org_members m JOIN users u ON u.id = m.user_id WHERE m.org_id = ${orgId}`,
      prisma.$queryRaw<any[]>`SELECT id, kind, name, default_role AS "defaultRole", created_at AS "createdAt", closed_at AS "closedAt" FROM spaces WHERE org_id = ${orgId}`,
      prisma.$queryRaw<any[]>`SELECT a.id, a.space_id AS "spaceId", a.title, a.body, a.status, a.version, a.retracted_at AS "retractedAt", a.created_at AS "createdAt" FROM announcements a JOIN spaces s ON s.id = a.space_id WHERE s.org_id = ${orgId}`,
    ]);
    const spaceIds = spaces.map((s) => s.id);
    const priv = (await prisma.$queryRaw<{ id: string }[]>`SELECT n.id FROM notes n JOIN spaces s ON s.id = n.space_id WHERE s.org_id = ${orgId} AND s.kind = 'office' AND n.office_everyone IS NULL`).map((r) => r.id);
    const taskRows = spaceIds.length ? await prisma.todo.findMany({ where: { spaceId: { in: spaceIds } }, select: { id: true, spaceId: true, text: true, completed: true, priority: true, deadline: true, assigneeId: true, createdAt: true } }) : [];
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="organization-export.json"`);
    res.write(`{"exportedAt":${JSON.stringify(new Date().toISOString())},"includesTrash":${includeTrash},"organization":${JSON.stringify(o[0])},"members":${JSON.stringify(members)},"spaces":${JSON.stringify(spaces)},"notes":[`);
    let first = true; let cursor: string | undefined; let count = 0;
    while (spaceIds.length) {
      const page = await prisma.note.findMany({
        where: { spaceId: { in: spaceIds }, id: { notIn: priv }, ...(includeTrash ? {} : { isDeleted: false }) },
        select: { id: true, spaceId: true, title: true, content: true, isDeleted: true, isArchived: true, createdAt: true, updatedAt: true },
        orderBy: { id: 'asc' }, take: EXPORT_CHUNK, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      for (const n of page) { res.write((first ? '' : ',') + JSON.stringify(n)); first = false; }
      count += page.length;
      if (page.length < EXPORT_CHUNK) break;
      cursor = page[page.length - 1].id;
    }
    res.write(`],"tasks":${JSON.stringify(taskRows)},"announcements":${JSON.stringify(posts)},"counts":${JSON.stringify({ notes: count, tasks: taskRows.length, privateNotesWithheld: priv.length })}}`);
    res.end();
  } catch (e) {
    if (res.headersSent) res.destroy(); else next(e); // a half-written file must not look like a complete one
  }
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
  const links = typeof req.body?.publicLinks === 'boolean' ? req.body.publicLinks : null;
  if (links !== null) await prisma.$executeRaw`UPDATE spaces SET public_links = ${links} WHERE id = ${req.params.spaceId}`;
  await audit(g.orgId, uid(req), 'space.updated', req.params.spaceId, { name: name || undefined, defaultRole: role || undefined, publicLinks: links ?? undefined });
  let revoked: { notes: number; tasks: number } | null = null;
  if (links === false) {
    revoked = await revokeSpaceLinks([req.params.spaceId]);
    if (revoked.notes || revoked.tasks) await audit(g.orgId, uid(req), 'shares.revoked', req.params.spaceId, { why: 'space.publicLinks', ...revoked });
  }
  res.json({ ok: true, ...(revoked ? { revoked } : {}) });
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
  kickFromSpace(req.app.get('io'), req.params.spaceId, uid(req));
  res.json({ ok: true });
});
/** Close a team. Nothing is deleted: the notes stay in the database and in the organization export. */
router.post('/spaces/:spaceId/close', async (req, res) => {
  const g = await spaceGate(req, res); if (!g) return;
  if (!g.manage) return res.status(403).json({ error: 'Only a team lead or an admin can close a team.' });
  await prisma.$executeRaw`UPDATE spaces SET closed_at = now() WHERE id = ${req.params.spaceId}`;
  await audit(g.orgId, uid(req), 'space.closed', req.params.spaceId);
  void refreshSpaceRoom(req.app.get('io'), req.params.spaceId);
  res.json({ ok: true });
});

/** Organization AI keys (mockup C05). Owners and admins only; the key itself is never returned. */
const AI_PROVIDERS = ['openai', 'gemini'];
router.get('/orgs/:orgId/ai-keys', async (req, res) => {
  if (!(await gate(req, res, true))) return;
  const rows = await prisma.$queryRaw<any[]>`SELECT k.provider, k.added_at AS "addedAt", u.name AS "addedByName" FROM org_ai_keys k LEFT JOIN users u ON u.id = k.added_by WHERE k.org_id = ${req.params.orgId}`;
  res.json({ keys: AI_PROVIDERS.map((p) => { const r = rows.find((x) => x.provider === p); return { provider: p, set: !!r, addedByName: r?.addedByName ?? null, addedAt: r?.addedAt ?? null }; }) });
});
router.put('/orgs/:orgId/ai-keys/:provider', async (req, res) => {
  if (!(await gate(req, res, true))) return;
  const provider = String(req.params.provider);
  const key = typeof req.body?.key === 'string' ? req.body.key.trim() : '';
  if (!AI_PROVIDERS.includes(provider)) return res.status(400).json({ error: 'Use openai or gemini.' });
  if (key.length < 8 || key.length > 400) return res.status(400).json({ error: 'That does not look like a key.' });
  const enc = encryptSecret(key);
  const had = (await prisma.$queryRaw<any[]>`SELECT 1 FROM org_ai_keys WHERE org_id = ${req.params.orgId} AND provider = ${provider}`).length > 0;
  await prisma.$executeRaw`INSERT INTO org_ai_keys (org_id, provider, secret, added_by, added_at) VALUES (${req.params.orgId}, ${provider}, ${enc}, ${uid(req)}, now())
    ON CONFLICT (org_id, provider) DO UPDATE SET secret = EXCLUDED.secret, added_by = EXCLUDED.added_by, added_at = now()`;
  await audit(req.params.orgId, uid(req), had ? 'key.replaced' : 'key.added', provider, { provider });
  res.json({ ok: true });
});
router.delete('/orgs/:orgId/ai-keys/:provider', async (req, res) => {
  if (!(await gate(req, res, true))) return;
  const provider = String(req.params.provider);
  await prisma.$executeRaw`DELETE FROM org_ai_keys WHERE org_id = ${req.params.orgId} AND provider = ${provider}`;
  await audit(req.params.orgId, uid(req), 'key.removed', provider, { provider });
  res.json({ ok: true });
});

/** Seats: active members count, guests are free (mockup C07). */
router.get('/orgs/:orgId/seats', async (req, res) => {
  if (!(await gate(req, res, false))) return;
  const orgId = req.params.orgId;
  const c = (await prisma.$queryRaw<any[]>`SELECT
    count(*) FILTER (WHERE role <> 'guest' AND status = 'active')::int AS used,
    count(*) FILTER (WHERE role = 'guest' AND status = 'active')::int AS guests
    FROM org_members WHERE org_id = ${orgId}`)[0];
  const pol = (await prisma.$queryRaw<any[]>`SELECT policy FROM organizations WHERE id = ${orgId}`)[0]?.policy ?? {};
  const made = (await prisma.$queryRaw<{ at: Date }[]>`SELECT created_at AS at FROM organizations WHERE id = ${orgId}`)[0]?.at;
  const trialEndsAt = made ? new Date(new Date(made).getTime() + 14 * 86400000).toISOString() : null; // early access: a 14 day trial from creation, no billing behind it yet
  res.json({ trialEndsAt, used: c?.used ?? 0, guests: c?.guests ?? 0, limit: Number(pol.seatLimit) > 0 ? Number(pol.seatLimit) : 10 });
});
router.get('/orgs/:orgId/exports', async (req, res) => {
  if (!(await gate(req, res, true))) return;
  const rows = await prisma.$queryRaw<any[]>`SELECT a.id, a.at, u.name AS "byName" FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id WHERE a.org_id = ${req.params.orgId} AND a.action = 'org.exported' ORDER BY a.at DESC LIMIT 5`;
  res.json({ exports: rows });
});

export default router;

import { Router } from 'express';
import prisma from '../db.js';
import { authenticate } from '../middleware/auth.js';
import { notifyUsers, nameOf, spaceUserIds } from '../services/notify.js';
import { audit, can, orgAccess, type SpaceRole } from '../utils/access.js';

/*
 * Team and member lifecycle (audit R6, R8, R16). Kept in its own file so routes/orgs.ts stays small.
 *   GET    /orgs/:orgId/members/:userId/notes-summary   what a person wrote in the organization's spaces (for the handover dialog)
 *   POST   /orgs/:orgId/members/:userId/handover-notes   { toUserId, spaceIds? }  give their notes (also private Office notes) to another member
 *   DELETE /spaces/:spaceId/members/:userId              remove one person from one team (a lead, or an owner/admin)
 *   GET    /orgs/:orgId/closed-spaces                    closed teams the caller may reopen
 *   POST   /spaces/:spaceId/reopen                       reopen a closed team (a lead, or an owner/admin)
 *   DELETE /orgs/:orgId                                  { confirmName } soft-close the organization; the data is kept 30 days (purge_after)
 * Every change writes audit_log and tells the people it concerns (services/notify.ts). Tables: 035_workspaces_expand.sql, 051_org_purge_after.sql.
 */
const router = Router();
router.use(authenticate);

const uid = (req: any): string => req.user.id;
const PURGE_DAYS = 30;

/** The caller's membership, or an error already sent. `manage` demands an owner or admin of an organization that accepts writes. */
async function gate(req: any, res: any, manage: boolean) {
  const org = await orgAccess(uid(req), req.params.orgId);
  if (!org) { res.status(404).json({ error: 'Organization not found.' }); return null; }
  if (manage && !can('org.manage', org)) { res.status(403).json({ error: 'Only owners and admins can do that.' }); return null; }
  return org;
}

/* ---------- R8: note handover ---------- */

router.get('/orgs/:orgId/members/:userId/notes-summary', async (req, res, next) => {
  try {
    if (!(await gate(req, res, true))) return;
    const rows = await prisma.$queryRaw<{ id: string; name: string; kind: string; notes: number; private: number }[]>`
      SELECT s.id, s.name, s.kind, count(*)::int AS notes,
             count(*) FILTER (WHERE s.kind = 'office' AND n.office_everyone IS NULL)::int AS private
      FROM notes n JOIN spaces s ON s.id = n.space_id
      WHERE s.org_id = ${req.params.orgId} AND s.closed_at IS NULL AND n.user_id = ${req.params.userId} AND NOT n.is_deleted
      GROUP BY s.id, s.name, s.kind ORDER BY s.name`;
    res.json({ spaces: rows, total: rows.reduce((a, r) => a + r.notes, 0) });
  } catch (e) { next(e); }
});

/** People who wrote notes in this organization's spaces but are no longer members (removed or left): their notes can still be handed over. */
router.get('/orgs/:orgId/orphaned-notes', async (req, res, next) => {
  try {
    if (!(await gate(req, res, true))) return;
    const rows = await prisma.$queryRaw<{ userId: string; name: string; notes: number }[]>`
      SELECT n.user_id AS "userId", u.name, count(*)::int AS notes
      FROM notes n JOIN spaces s ON s.id = n.space_id JOIN users u ON u.id = n.user_id
      WHERE s.org_id = ${req.params.orgId} AND s.closed_at IS NULL AND NOT n.is_deleted
        AND NOT EXISTS (SELECT 1 FROM org_members m WHERE m.org_id = s.org_id AND m.user_id = n.user_id)
      GROUP BY n.user_id, u.name ORDER BY u.name`;
    res.json({ people: rows });
  } catch (e) { next(e); }
});

router.post('/orgs/:orgId/members/:userId/handover-notes', async (req, res, next) => {
  try {
    const org = await gate(req, res, true); if (!org) return;
    const orgId = req.params.orgId; const from = req.params.userId;
    const to = typeof req.body?.toUserId === 'string' ? req.body.toUserId : '';
    if (!to || to === from) return res.status(400).json({ error: 'Choose another person to hand the notes to.' });
    // the receiver must be an active, current, non-guest member of this organization (orgAccess also rejects expired guests and closed organizations)
    const dest = await orgAccess(to, orgId);
    if (!dest || dest.status !== 'active' || dest.role === 'guest') return res.status(400).json({ error: 'Notes can only be handed to an active member of this organization.', code: 'not_member' });
    const only: string[] | null = Array.isArray(req.body?.spaceIds) ? req.body.spaceIds.filter((x: unknown): x is string => typeof x === 'string') : null;

    // spaces of this organization where the person has notes
    const have = await prisma.$queryRaw<{ id: string; name: string }[]>`
      SELECT DISTINCT s.id, s.name FROM notes n JOIN spaces s ON s.id = n.space_id
      WHERE s.org_id = ${orgId} AND s.closed_at IS NULL AND n.user_id = ${from} AND NOT n.is_deleted AND (${only === null} OR s.id = ANY(${only ?? []}::text[]))`;
    // the receiver must be able to write in each space, or the note would become unreadable to them
    const writer = new Set((await prisma.$queryRaw<{ space_id: string }[]>`
      SELECT space_id FROM space_members WHERE user_id = ${to} AND role IN ('lead', 'member') AND space_id = ANY(${have.map((h) => h.id)}::text[])`).map((r) => r.space_id));
    const ok = have.filter((h) => writer.has(h.id));
    const skipped = have.filter((h) => !writer.has(h.id)).map((h) => ({ id: h.id, name: h.name }));
    if (!ok.length) return res.json({ ok: true, moved: 0, skipped, message: have.length ? 'The receiver is not a member of those spaces, so nothing was moved. Add them first.' : 'There are no notes to hand over.' });

    const spaceIds = ok.map((o) => o.id);
    const moved = await prisma.$transaction(async (tx) => {
      const ids = (await tx.$queryRaw<{ id: string }[]>`SELECT id FROM notes WHERE user_id = ${from} AND NOT is_deleted AND space_id = ANY(${spaceIds}::text[]) FOR UPDATE`).map((r) => r.id);
      if (!ids.length) return [] as string[];
      // updated_at is left alone (a raw update does not touch it): the hand over is not an edit of the text
      await tx.$executeRaw`UPDATE notes SET user_id = ${to} WHERE id = ANY(${ids}::text[])`;
      await tx.$executeRaw`DELETE FROM note_access WHERE note_id = ANY(${ids}::text[]) AND user_id = ${to}`; // the new author needs no grant
      // tags belong to a person: give the receiver tags of the same names and point the notes at them
      await tx.$executeRaw`INSERT INTO tags (id, user_id, name) SELECT gen_random_uuid()::text, ${to}, t.name FROM tags t JOIN note_tags nt ON nt.tag_id = t.id WHERE nt.note_id = ANY(${ids}::text[]) AND t.user_id = ${from} GROUP BY t.name ON CONFLICT (user_id, name) DO NOTHING`;
      await tx.$executeRaw`UPDATE note_tags nt SET tag_id = t2.id FROM tags t, tags t2
        WHERE nt.note_id = ANY(${ids}::text[]) AND t.id = nt.tag_id AND t.user_id = ${from} AND t2.user_id = ${to} AND t2.name = t.name
          AND NOT EXISTS (SELECT 1 FROM note_tags x WHERE x.note_id = nt.note_id AND x.tag_id = t2.id)`;
      return ids;
    });

    const privateOffice = moved.length ? (await prisma.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM notes n JOIN spaces s ON s.id = n.space_id WHERE n.id = ANY(${moved}::text[]) AND s.kind = 'office' AND n.office_everyone IS NULL`)[0]?.n ?? 0 : 0;
    await audit(orgId, uid(req), 'member.notes_handover', from, { to, moved: moved.length, spaceIds, privateOffice, skipped: skipped.map((s) => s.id) });
    if (moved.length && to !== uid(req)) {
      await notifyUsers(req.app, [to], { kind: 'status', title: `${moved.length} note${moved.length === 1 ? '' : 's'} handed over to you`, body: `From ${await nameOf(from)}, by ${await nameOf(uid(req))}`, from: await nameOf(uid(req)), spaceId: spaceIds[0] });
    }
    for (const room of new Set([from, to, uid(req)])) req.app.get('io')?.to(room).emit('notes_changed');
    res.json({ ok: true, moved: moved.length, privateOffice, skipped });
  } catch (e) { next(e); }
});

/* ---------- R6: remove one person from one team ---------- */

router.delete('/spaces/:spaceId/members/:userId', async (req, res, next) => {
  try {
    const { spaceId, userId } = req.params;
    const sp = (await prisma.$queryRaw<{ org_id: string; name: string; kind: string }[]>`SELECT org_id, name, kind FROM spaces WHERE id = ${spaceId} AND closed_at IS NULL`)[0];
    if (!sp) return res.status(404).json({ error: 'Team not found.' });
    const org = await orgAccess(uid(req), sp.org_id);
    const mine = (await prisma.$queryRaw<{ role: SpaceRole }[]>`SELECT role FROM space_members WHERE space_id = ${spaceId} AND user_id = ${uid(req)}`)[0]?.role ?? null;
    if (!org || !(can('space.manage', org, mine) || can('org.manage', org))) return res.status(403).json({ error: 'Only a team lead or an admin can remove someone from a team.' });
    const target = (await prisma.$queryRaw<{ role: SpaceRole }[]>`SELECT role FROM space_members WHERE space_id = ${spaceId} AND user_id = ${userId}`)[0];
    if (!target) return res.status(404).json({ error: 'That person is not in this team.' });
    if (target.role === 'lead') {
      const leads = (await prisma.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM space_members WHERE space_id = ${spaceId} AND role = 'lead'`)[0]?.n ?? 0;
      if (leads <= 1) return res.status(409).json({ error: 'This is the only lead. Make someone else a lead first.', code: 'last_lead' });
    }
    await prisma.$transaction([
      prisma.$executeRaw`UPDATE todos SET assignee_id = NULL WHERE assignee_id = ${userId} AND space_id = ${spaceId}`,
      prisma.$executeRaw`DELETE FROM space_members WHERE space_id = ${spaceId} AND user_id = ${userId}`,
    ]);
    const notes = (await prisma.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM notes WHERE space_id = ${spaceId} AND user_id = ${userId} AND NOT is_deleted`)[0]?.n ?? 0;
    await audit(sp.org_id, uid(req), 'space.member_removed', userId, { spaceId, notes });
    if (userId !== uid(req)) await notifyUsers(req.app, [userId], { kind: 'member_joined', title: `You were removed from ${sp.name}`, from: await nameOf(uid(req)) });
    req.app.get('io')?.to(userId).emit('notes_changed');
    res.json({ ok: true, notes }); // notes: how many they wrote there (an owner or admin can hand them over)
  } catch (e) { next(e); }
});

/* ---------- R16: reopen a team, delete an organization ---------- */

/** The caller's right to reopen: a lead of that team, or an owner/admin, in an organization that is open for writing. */
async function reopenGate(req: any, res: any) {
  const sp = (await prisma.$queryRaw<{ org_id: string; name: string; closed_at: Date | null }[]>`SELECT org_id, name, closed_at FROM spaces WHERE id = ${req.params.spaceId}`)[0];
  if (!sp) { res.status(404).json({ error: 'Team not found.' }); return null; }
  const org = await orgAccess(uid(req), sp.org_id);
  if (!org) { res.status(404).json({ error: 'Team not found.' }); return null; }
  const lead = (await prisma.$queryRaw<{ role: SpaceRole }[]>`SELECT role FROM space_members WHERE space_id = ${req.params.spaceId} AND user_id = ${uid(req)}`)[0]?.role === 'lead';
  if (org.status !== 'active' || org.orgStatus !== 'active' || !(lead || can('org.manage', org))) { res.status(403).json({ error: 'Only a team lead or an admin can reopen a team.' }); return null; }
  return { sp, orgId: sp.org_id };
}

router.get('/orgs/:orgId/closed-spaces', async (req, res, next) => {
  try {
    const org = await gate(req, res, false); if (!org) return;
    const admin = can('org.manage', org);
    const rows = await prisma.$queryRaw<any[]>`
      SELECT s.id, s.name, s.kind, s.closed_at AS "closedAt" FROM spaces s
      WHERE s.org_id = ${req.params.orgId} AND s.closed_at IS NOT NULL
        AND (${admin} OR EXISTS (SELECT 1 FROM space_members sm WHERE sm.space_id = s.id AND sm.user_id = ${uid(req)} AND sm.role = 'lead'))
      ORDER BY s.closed_at DESC`;
    res.json({ spaces: rows });
  } catch (e) { next(e); }
});

router.post('/spaces/:spaceId/reopen', async (req, res, next) => {
  try {
    const g = await reopenGate(req, res); if (!g) return;
    if (!g.sp.closed_at) return res.status(409).json({ error: 'This team is already open.' });
    await prisma.$executeRaw`UPDATE spaces SET closed_at = NULL WHERE id = ${req.params.spaceId} AND closed_at IS NOT NULL`;
    await audit(g.orgId, uid(req), 'space.reopened', req.params.spaceId, { name: g.sp.name });
    const members = (await spaceUserIds(req.params.spaceId)).filter((u) => u !== uid(req));
    if (members.length) await notifyUsers(req.app, members, { kind: 'status', title: `${g.sp.name} was reopened`, from: await nameOf(uid(req)), spaceId: req.params.spaceId });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

/**
 * Delete an organization. The sole owner types the organization's name. It is allowed only when nobody else is an active member
 * (remove them, or transfer ownership so the new owner decides). Soft close: status 'closed', closed_at and purge_after (+30 days) are set,
 * pending invites and join links are revoked, and NOTHING is physically deleted here.
 */
router.delete('/orgs/:orgId', async (req, res, next) => {
  try {
    const org = await gate(req, res, false); if (!org) return;
    const orgId = req.params.orgId;
    if (org.role !== 'owner' || org.status !== 'active') return res.status(403).json({ error: 'Only an owner can delete the organization.' });
    const row = (await prisma.$queryRaw<{ name: string }[]>`SELECT name FROM organizations WHERE id = ${orgId}`)[0];
    if (!row || String(req.body?.confirmName ?? '').trim() !== row.name) return res.status(400).json({ error: 'Type the exact name of the organization to confirm.', code: 'name_mismatch' });
    const owners = (await prisma.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM org_members WHERE org_id = ${orgId} AND role = 'owner' AND status = 'active'`)[0]?.n ?? 0;
    const others = await prisma.$queryRaw<{ user_id: string }[]>`SELECT user_id FROM org_members WHERE org_id = ${orgId} AND user_id <> ${uid(req)} AND status = 'active' AND (guest_until IS NULL OR guest_until > now())`;
    if (others.length) {
      return res.status(409).json({ error: owners > 1 ? 'Other owners and members are still in this organization. Remove them first; only the last person can delete it.' : `${others.length} other active member${others.length === 1 ? ' is' : 's are'} still in this organization. Remove them, or transfer ownership to someone who should decide.`, code: 'has_members', others: others.length });
    }
    const everyone = (await prisma.$queryRaw<{ user_id: string }[]>`SELECT user_id FROM org_members WHERE org_id = ${orgId} AND user_id <> ${uid(req)}`).map((r) => r.user_id);
    const closed = await prisma.$transaction(async (tx) => {
      const n = await tx.$executeRaw`UPDATE organizations SET status = 'closed', closed_at = now(), purge_after = now() + (${PURGE_DAYS} * interval '1 day') WHERE id = ${orgId} AND closed_at IS NULL`;
      if (!n) return 0;
      await tx.$executeRaw`UPDATE org_invites SET revoked_at = now() WHERE org_id = ${orgId} AND accepted_at IS NULL AND revoked_at IS NULL`;
      await tx.$executeRaw`UPDATE org_join_links SET revoked_at = now() WHERE org_id = ${orgId} AND revoked_at IS NULL`;
      return n;
    });
    if (!closed) return res.status(409).json({ error: 'This organization is already closed.' });
    const purge = (await prisma.$queryRaw<{ purge_after: Date }[]>`SELECT purge_after FROM organizations WHERE id = ${orgId}`)[0]?.purge_after;
    await audit(orgId, uid(req), 'org.deleted', orgId, { name: row.name, purgeAfter: purge });
    if (everyone.length) await notifyUsers(req.app, everyone, { kind: 'member_joined', title: `${row.name} was closed by ${await nameOf(uid(req))}`, from: await nameOf(uid(req)) });
    req.app.get('io')?.to(uid(req)).emit('notes_changed');
    res.json({ ok: true, purgeAfter: purge });
  } catch (e) { next(e); }
});

export default router;

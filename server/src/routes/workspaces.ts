import { Router } from 'express';
import crypto from 'crypto';
import prisma from '../db.js';
import { authenticate } from '../middleware/auth.js';
import { audit, can, orgAccess, type OrgRole, type SpaceRole } from '../utils/access.js';

/* Workspaces: the spaces a person can switch between, and creating an organization or a team. Tables: 035_workspaces_expand.sql. */
const router = Router();
router.use(authenticate);

const clean = (v: unknown, max = 80) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const uid = (req: any): string => req.user.id;

type Row = { org_id: string; org_name: string; org_status: string; org_role: OrgRole; space_id: string | null; kind: string | null; space_name: string | null; space_role: SpaceRole | null; members: number | null; default_role: string | null };

/** Personal is always there. Organizations and their spaces appear only for people who belong to them. */
router.get('/', async (req, res) => {
  const userId = uid(req);
  const rows = await prisma.$queryRaw<Row[]>`
    SELECT o.id AS org_id, o.name AS org_name, o.status AS org_status, m.role AS org_role,
           s.id AS space_id, s.kind, s.name AS space_name, sm.role AS space_role, s.default_role,
           (SELECT count(*)::int FROM space_members x WHERE x.space_id = s.id) AS members
    FROM org_members m
    JOIN organizations o ON o.id = m.org_id AND o.closed_at IS NULL
    LEFT JOIN space_members sm ON sm.user_id = m.user_id AND sm.space_id IN (SELECT id FROM spaces WHERE org_id = o.id)
    LEFT JOIN spaces s ON s.id = sm.space_id AND s.closed_at IS NULL
    WHERE m.user_id = ${userId} AND m.status = 'active' AND (m.guest_until IS NULL OR m.guest_until > now())
    ORDER BY o.created_at, s.created_at`;
  const orgs = new Map<string, any>();
  for (const r of rows) {
    if (!orgs.has(r.org_id)) orgs.set(r.org_id, { id: r.org_id, name: r.org_name, status: r.org_status, role: r.org_role, spaces: [] });
    if (r.space_id && r.space_name) orgs.get(r.org_id).spaces.push({ id: r.space_id, kind: r.kind, name: r.space_name, role: r.space_role, members: r.members ?? 0, defaultRole: r.default_role });
  }
  const me = await prisma.$queryRaw<{ id: string; name: string }[]>`SELECT id, name FROM users WHERE id = ${userId}`;
  res.json({ me: me[0] ?? { id: userId, name: '' }, personal: { id: null, name: 'Personal' }, orgs: [...orgs.values()] });
});

/** Home "My Day" across spaces (mockup B05): team tasks assigned to me that are due today or overdue, from every space I can still read. */
router.get('/my-day', async (req, res) => {
  const userId = uid(req);
  const end = new Date(); end.setHours(23, 59, 59, 999);
  const until = Number.isFinite(Date.parse(String(req.query.until))) ? new Date(String(req.query.until)) : end;
  const rows = await prisma.$queryRaw<any[]>`
    SELECT t.id, t.text, t.priority, t.deadline, t.start_time AS "startTime", t.is_completed AS completed, t.space_id AS "spaceId", s.name AS "spaceName", s.kind AS "spaceKind", o.name AS "orgName", sm.role AS "spaceRole"
    FROM todos t
    JOIN spaces s ON s.id = t.space_id AND s.closed_at IS NULL
    JOIN organizations o ON o.id = s.org_id AND o.closed_at IS NULL
    JOIN org_members m ON m.org_id = o.id AND m.user_id = ${userId} AND m.status = 'active' AND (m.guest_until IS NULL OR m.guest_until > now())
    JOIN space_members sm ON sm.space_id = s.id AND sm.user_id = ${userId}
    WHERE t.assignee_id = ${userId} AND t.is_completed = false AND t.deadline IS NOT NULL AND t.deadline <= ${until}
    ORDER BY t.deadline ASC LIMIT 30`;
  res.json({ tasks: rows });
});

/** Calendar team layers (mockup B06): the open, dated tasks of every space I can read, shaped like a calendar feed so the calendar can show them as read-only layers. */
router.get('/team-range', async (req, res) => {
  const userId = uid(req);
  const from = new Date(String(req.query.from)); const to = new Date(String(req.query.to));
  if (!Number.isFinite(+from) || !Number.isFinite(+to)) return res.status(400).json({ error: 'from and to are required.' });
  let tz = String(req.query.tz || 'UTC');
  try { new Intl.DateTimeFormat('en-CA', { timeZone: tz }); } catch { tz = 'UTC'; }
  const rows = await prisma.$queryRaw<any[]>`
    SELECT t.id, t.text, t.deadline, t.start_time AS "startTime", t.end_time AS "endTime", s.id AS "spaceId", s.name AS "spaceName", s.kind
    FROM todos t
    JOIN spaces s ON s.id = t.space_id AND s.closed_at IS NULL
    JOIN organizations o ON o.id = s.org_id AND o.closed_at IS NULL
    JOIN org_members m ON m.org_id = o.id AND m.user_id = ${userId} AND m.status = 'active' AND (m.guest_until IS NULL OR m.guest_until > now())
    JOIN space_members sm ON sm.space_id = s.id AND sm.user_id = ${userId}
    WHERE t.is_completed = false AND t.deadline >= ${from} AND t.deadline < ${to}
    ORDER BY t.deadline ASC LIMIT 500`;
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: tz });
  const colors = ['sky', 'mint', 'butter', 'lilac'];
  const order = [...new Set(rows.map((r) => r.spaceId))];
  const next = (d: string) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + 1); return x.toISOString().slice(0, 10); };
  const events = rows.map((r) => {
    const d = day.format(new Date(r.deadline));
    const timed = r.startTime && r.endTime;
    return { feedId: r.spaceId, feed: r.spaceName, color: colors[order.indexOf(r.spaceId) % colors.length], uid: r.id, title: r.text, allDay: !timed, start: timed ? `${d}T${r.startTime}` : d, end: timed ? `${d}T${r.endTime}` : next(d) };
  });
  res.json({ events });
});

/** Create an organization; the creator becomes its owner and the lead of its first space (a team, or the Office). */
router.post('/orgs', async (req, res) => {
  const userId = uid(req);
  const name = clean(req.body?.name);
  const start = req.body?.start === 'office' ? 'office' : 'team';
  if (name.length < 2) return res.status(400).json({ error: 'Give the organization a name of at least 2 letters.' });
  const owned = await prisma.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM org_members WHERE user_id = ${userId} AND role = 'owner'`;
  if ((owned[0]?.n ?? 0) >= 5) return res.status(400).json({ error: 'You already own 5 organizations.' });
  const orgId = crypto.randomUUID();
  const spaceId = crypto.randomUUID();
  const spaceName = clean(req.body?.spaceName) || (start === 'office' ? `${name} office` : `${name} team`);
  await prisma.$transaction([
    prisma.$executeRaw`INSERT INTO organizations (id, name, created_by) VALUES (${orgId}, ${name}, ${userId})`,
    prisma.$executeRaw`INSERT INTO org_members (org_id, user_id, role) VALUES (${orgId}, ${userId}, 'owner')`,
    prisma.$executeRaw`INSERT INTO spaces (id, org_id, kind, name, created_by) VALUES (${spaceId}, ${orgId}, ${start}, ${spaceName}, ${userId})`,
    prisma.$executeRaw`INSERT INTO space_members (space_id, user_id, role, added_by) VALUES (${spaceId}, ${userId}, 'lead', ${userId})`,
  ]);
  await audit(orgId, userId, 'org.created', orgId, { name });
  res.status(201).json({ id: orgId, spaceId });
});

/** Create a team (or the Office) in an organization. The creator leads it; owners and admins are not added unless they create it. */
router.post('/orgs/:orgId/spaces', async (req, res) => {
  const userId = uid(req);
  const org = await orgAccess(userId, req.params.orgId);
  const pol = (await prisma.$queryRaw<{ policy: any }[]>`SELECT policy FROM organizations WHERE id = ${req.params.orgId}`)[0]?.policy ?? {};
  if (org?.role === 'member' && pol.membersCreateTeams === false) return res.status(403).json({ error: 'Only owners and admins can create teams here.' });
  if (!can('org.create_space', org)) return res.status(403).json({ error: 'You cannot create teams here.' });
  const name = clean(req.body?.name);
  if (name.length < 2) return res.status(400).json({ error: 'Give the team a name of at least 2 letters.' });
  const kind = req.body?.kind === 'office' ? 'office' : 'team';
  const spaceId = crypto.randomUUID();
  await prisma.$transaction([
    prisma.$executeRaw`INSERT INTO spaces (id, org_id, kind, name, created_by) VALUES (${spaceId}, ${req.params.orgId}, ${kind}, ${name}, ${userId})`,
    prisma.$executeRaw`INSERT INTO space_members (space_id, user_id, role, added_by) VALUES (${spaceId}, ${userId}, 'lead', ${userId})`,
  ]);
  await audit(req.params.orgId, userId, 'space.created', spaceId, { name, kind });
  res.status(201).json({ id: spaceId });
});

export default router;

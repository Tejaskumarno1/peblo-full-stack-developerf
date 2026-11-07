import { Router } from 'express';
import crypto from 'crypto';
import prisma from '../db.js';
import { authenticate } from '../middleware/auth.js';
import { audit, can, spaceAccess } from '../utils/access.js';

/* Office announcements (mockups B01 to B03). Tables: 036_office_announcements.sql. */
const router = Router();
router.use(authenticate);

const uid = (req: any): string => req.user.id;
const clean = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** The caller's access to an Office. Answers 404/400 itself. `publisher` is true for a lead of an organization that accepts writes. */
async function office(req: any, res: any) {
  const acc = await spaceAccess(uid(req), req.params.spaceId);
  if (!acc) { res.status(404).json({ error: 'Space not found.' }); return null; }
  const kind = await prisma.$queryRaw<{ kind: string; org_id: string }[]>`SELECT kind, org_id FROM spaces WHERE id = ${req.params.spaceId}`;
  if (kind[0]?.kind !== 'office') { res.status(400).json({ error: 'Announcements belong to an Office.' }); return null; }
  return { acc, orgId: kind[0].org_id, publisher: can('space.manage', acc.org, acc.role), canSuggest: can('space.write', acc.org, acc.role) };
}

router.get('/spaces/:spaceId/announcements', async (req, res) => {
  const o = await office(req, res); if (!o) return;
  const rows = await prisma.$queryRaw<any[]>`
    SELECT a.id, a.title, a.body, a.status, a.version, a.retracted_at AS "retractedAt", a.created_at AS "createdAt", a.updated_at AS "updatedAt", u.name AS "authorName", a.author_id AS "authorId"
    FROM announcements a JOIN users u ON u.id = a.author_id
    WHERE a.space_id = ${req.params.spaceId} AND (a.status = 'published' OR (${o.publisher} AND a.status = 'suggested') OR a.author_id = ${uid(req)})
    ORDER BY a.created_at DESC LIMIT 100`;
  res.json({ publisher: o.publisher, canSuggest: o.canSuggest, posts: rows });
});

router.post('/spaces/:spaceId/announcements', async (req, res) => {
  const o = await office(req, res); if (!o) return;
  if (!o.canSuggest) return res.status(403).json({ error: 'You cannot post here.' });
  const title = clean(req.body?.title, 200); const body = clean(req.body?.body, 8000);
  if (title.length < 2) return res.status(400).json({ error: 'Give the announcement a title.' });
  const id = crypto.randomUUID();
  const status = o.publisher ? 'published' : 'suggested';
  await prisma.$executeRaw`INSERT INTO announcements (id, space_id, author_id, title, body, status) VALUES (${id}, ${req.params.spaceId}, ${uid(req)}, ${title}, ${body}, ${status})`;
  await audit(o.orgId, uid(req), status === 'published' ? 'announcement.posted' : 'announcement.suggested', id, { spaceId: req.params.spaceId });
  res.status(201).json({ id, status });
});

async function load(req: any, res: any) {
  const o = await office(req, res); if (!o) return null;
  if (!o.publisher) { res.status(403).json({ error: 'Only the publisher can do that.' }); return null; }
  const r = await prisma.$queryRaw<any[]>`SELECT id, title, body, status, version, retracted_at AS "retractedAt" FROM announcements WHERE id = ${req.params.id} AND space_id = ${req.params.spaceId}`;
  if (!r[0]) { res.status(404).json({ error: 'Announcement not found.' }); return null; }
  return { o, a: r[0] };
}

/** Edit keeps every earlier version. */
router.patch('/spaces/:spaceId/announcements/:id', async (req, res) => {
  const l = await load(req, res); if (!l) return;
  const title = clean(req.body?.title, 200) || l.a.title; const body = typeof req.body?.body === 'string' ? clean(req.body.body, 8000) : l.a.body;
  await prisma.$transaction([
    prisma.$executeRaw`INSERT INTO announcement_versions (announcement_id, version, title, body) VALUES (${l.a.id}, ${l.a.version}, ${l.a.title}, ${l.a.body}) ON CONFLICT DO NOTHING`,
    prisma.$executeRaw`UPDATE announcements SET title = ${title}, body = ${body}, version = version + 1, updated_at = now() WHERE id = ${l.a.id}`,
  ]);
  await audit(l.o.orgId, uid(req), 'announcement.edited', l.a.id);
  res.json({ ok: true, version: l.a.version + 1 });
});

/** Retracted posts stay visible as retracted. */
router.post('/spaces/:spaceId/announcements/:id/retract', async (req, res) => {
  const l = await load(req, res); if (!l) return;
  await prisma.$executeRaw`UPDATE announcements SET retracted_at = now(), updated_at = now() WHERE id = ${l.a.id} AND retracted_at IS NULL`;
  await audit(l.o.orgId, uid(req), 'announcement.retracted', l.a.id);
  res.json({ ok: true });
});

router.post('/spaces/:spaceId/announcements/:id/approve', async (req, res) => {
  const l = await load(req, res); if (!l) return;
  if (l.a.status !== 'suggested') return res.status(409).json({ error: 'That is not a suggestion.' });
  await prisma.$executeRaw`UPDATE announcements SET status = 'published', created_at = now(), updated_at = now() WHERE id = ${l.a.id}`;
  await audit(l.o.orgId, uid(req), 'announcement.approved', l.a.id);
  res.json({ ok: true });
});

router.post('/spaces/:spaceId/announcements/:id/decline', async (req, res) => {
  const l = await load(req, res); if (!l) return;
  if (l.a.status !== 'suggested') return res.status(409).json({ error: 'That is not a suggestion.' });
  await prisma.$executeRaw`UPDATE announcements SET status = 'declined', updated_at = now() WHERE id = ${l.a.id}`;
  await audit(l.o.orgId, uid(req), 'announcement.declined', l.a.id);
  res.json({ ok: true });
});

router.get('/spaces/:spaceId/announcements/:id/versions', async (req, res) => {
  const o = await office(req, res); if (!o) return;
  const rows = await prisma.$queryRaw<any[]>`
    SELECT v.version, v.title, v.body, v.saved_at AS "savedAt" FROM announcement_versions v JOIN announcements a ON a.id = v.announcement_id
    WHERE a.id = ${req.params.id} AND a.space_id = ${req.params.spaceId} AND a.status = 'published' ORDER BY v.version DESC`;
  res.json({ versions: rows });
});

export default router;

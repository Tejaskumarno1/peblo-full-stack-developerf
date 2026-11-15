import { Router } from 'express';
import prisma from '../db.js';
import { authenticate } from '../middleware/auth.js';
import { spaceAccess } from '../utils/access.js';
import { isOffice, noteLevel } from '../utils/noteAccess.js';

/* Per-person settings of one space: mute a team (051_invite_remind_space_prefs.sql) and the short people list the note editor offers for @mentions. */
const router = Router();
router.use(authenticate);
const uid = (req: any): string => req.user.id;

// GET /api/workspaces/spaces/:id/prefs -> { muted }
router.get('/spaces/:id/prefs', async (req, res) => {
  const acc = await spaceAccess(uid(req), req.params.id);
  if (!acc) return res.status(404).json({ error: 'Team not found.' });
  const r = await prisma.$queryRaw<{ muted: boolean }[]>`SELECT muted FROM space_prefs WHERE user_id = ${uid(req)} AND space_id = ${req.params.id}`;
  res.json({ muted: r[0]?.muted === true });
});

// PUT /api/workspaces/spaces/:id/prefs { muted } -> a muted team sends this person no stored notifications and no live nudges (direct @mentions and tasks given to them still arrive)
router.put('/spaces/:id/prefs', async (req, res) => {
  const acc = await spaceAccess(uid(req), req.params.id);
  if (!acc) return res.status(404).json({ error: 'Team not found.' });
  if (typeof req.body?.muted !== 'boolean') return res.status(400).json({ error: 'Send muted as true or false.' });
  await prisma.$executeRaw`INSERT INTO space_prefs (user_id, space_id, muted, updated_at) VALUES (${uid(req)}, ${req.params.id}, ${req.body.muted}, now())
    ON CONFLICT (user_id, space_id) DO UPDATE SET muted = EXCLUDED.muted, updated_at = now()`;
  res.json({ muted: req.body.muted });
});

// GET /api/workspaces/spaces/:id/people-lite[?noteId=] -> { people: [{ id, name, avatar }] } the other members of this space the caller may @mention.
// With a noteId in an Office, only people who can read that note are listed (an Office note is private until its author opens it up).
router.get('/spaces/:id/people-lite', async (req, res) => {
  const me = uid(req);
  const acc = await spaceAccess(me, req.params.id);
  if (!acc) return res.status(404).json({ error: 'Team not found.' });
  const rows = await prisma.$queryRaw<{ id: string; name: string; avatar: string | null }[]>`
    SELECT u.id, u.name, u.avatar FROM space_members sm
    JOIN spaces s ON s.id = sm.space_id AND s.closed_at IS NULL
    JOIN org_members m ON m.org_id = s.org_id AND m.user_id = sm.user_id AND m.status = 'active' AND (m.guest_until IS NULL OR m.guest_until > now())
    JOIN users u ON u.id = sm.user_id
    WHERE sm.space_id = ${req.params.id} AND sm.user_id <> ${me}
    ORDER BY lower(u.name) LIMIT 200`;
  let people = rows;
  const noteId = typeof req.query.noteId === 'string' ? req.query.noteId : '';
  if (noteId && (await isOffice(req.params.id))) {
    const keep: typeof rows = [];
    for (const p of rows) if ((await noteLevel(p.id, noteId, req.params.id)).level) keep.push(p);
    people = keep;
  }
  res.json({ people: people.map((p) => ({ id: p.id, name: p.name, avatar: p.avatar })) });
});

export default router;

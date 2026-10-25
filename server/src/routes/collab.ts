import { Router } from 'express';
import prisma from '../db.js';
import { authenticate } from '../middleware/auth.js';
import { liveRoomIds, presenceOf } from '../services/collab.js';
import { addComment, listComments, notifyOwner, removeComment, setStatus } from '../services/comments.js';

/*
 * Live collaboration helpers for the signed-in owner:
 *  - who from outside is in my notes right now (the dot on the notes list)
 *  - comments and suggestions on a note, and my notifications
 * People on a share link use the matching public routes below.
 */
const router = Router();
export const collabPublic = Router();
router.use(authenticate);

const ownNote = (userId: string, id: string) => prisma.note.findFirst({ where: { id, userId, isDeleted: false }, select: { id: true, title: true } });

// GET /api/collab/presence -> { [noteId]: [{ name, color }] }
router.get('/presence', async (req, res, next) => {
  try {
    const ids = liveRoomIds();
    if (!ids.length) return res.json({ presence: {} });
    const mine = await prisma.note.findMany({ where: { id: { in: ids }, userId: req.user!.id, isDeleted: false }, select: { id: true } });
    res.json({ presence: presenceOf(mine.map((n) => n.id)) });
  } catch (err) { next(err); }
});

// ---- comments (owner) ----
router.get('/comments/:noteId', async (req, res, next) => {
  try {
    if (!(await ownNote(req.user!.id, req.params.noteId))) return res.status(404).json({ error: 'Note not found' });
    res.json({ comments: await listComments(req.params.noteId, { userId: req.user!.id }) });
  } catch (err) { next(err); }
});

router.post('/comments/:noteId', async (req, res, next) => {
  try {
    if (!(await ownNote(req.user!.id, req.params.noteId))) return res.status(404).json({ error: 'Note not found' });
    const me = await prisma.user.findUnique({ where: { id: req.user!.id }, select: { name: true } });
    const r = await addComment(req.params.noteId, { name: me?.name?.trim() || 'Owner', color: String(req.body?.color || ''), userId: req.user!.id }, req.body);
    if (!r.ok) return res.status(400).json({ error: r.error });
    res.json({ id: r.id });
  } catch (err) { next(err); }
});

router.patch('/comments/:noteId/:cid', async (req, res, next) => {
  try {
    if (!(await ownNote(req.user!.id, req.params.noteId))) return res.status(404).json({ error: 'Note not found' });
    if (!(await setStatus(req.params.noteId, req.params.cid, String(req.body?.status || '')))) return res.status(400).json({ error: 'Could not change that.' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.delete('/comments/:noteId/:cid', async (req, res, next) => {
  try {
    if (!(await ownNote(req.user!.id, req.params.noteId))) return res.status(404).json({ error: 'Note not found' });
    if (!(await removeComment(req.params.noteId, req.params.cid, { userId: req.user!.id, owner: true }))) return res.status(404).json({ error: 'Comment not found' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ---- notifications ----
router.get('/notifications', async (req, res, next) => {
  try {
    const rows = await prisma.$queryRawUnsafe<any[]>('SELECT id, kind, note_id, title, body, from_name, is_read, created_at FROM user_notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 30', req.user!.id);
    res.json({
      notifications: rows.map((r) => ({ id: r.id, kind: r.kind, noteId: r.note_id, title: r.title, body: r.body, from: r.from_name, read: r.is_read, createdAt: new Date(r.created_at).toISOString() })),
      unread: rows.filter((r) => !r.is_read).length,
    });
  } catch (err) { next(err); }
});

router.post('/notifications/read', async (req, res, next) => {
  try {
    const ids = Array.isArray(req.body?.ids) ? (req.body.ids as unknown[]).filter((x): x is string => typeof x === 'string').slice(0, 100) : null;
    if (ids) await prisma.$executeRawUnsafe('UPDATE user_notifications SET is_read = TRUE WHERE user_id = $1 AND id = ANY($2::text[])', req.user!.id, ids);
    else await prisma.$executeRawUnsafe('UPDATE user_notifications SET is_read = TRUE WHERE user_id = $1', req.user!.id);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ---- comments (people on an editing share link) ----
const SHARE = /^[A-Za-z0-9_-]{20,40}$/;
const SESSION = /^[A-Za-z0-9_-]{16,80}$/;
async function guestNote(req: any) {
  const token = String(req.params.token || '');
  const sid = String(req.query?.sid || req.body?.sid || '');
  if (!SHARE.test(token) || !SESSION.test(sid)) return null;
  const note = await prisma.note.findFirst({
    where: { shareToken: token, isDeleted: false, shareEdit: true, OR: [{ shareExpiresAt: null }, { shareExpiresAt: { gt: new Date() } }] },
    select: { id: true, title: true, userId: true },
  });
  if (!note) return null;
  const blocked = await prisma.$queryRawUnsafe<{ n: number }[]>('SELECT 1 AS n FROM share_blocked WHERE kind = \'note\' AND share_token = $1 AND session_id = $2', token, sid);
  if (blocked.length) return null;
  return { note, sid, name: String(req.query?.name || req.body?.name || 'Guest').trim().slice(0, 40) || 'Guest' };
}

collabPublic.get('/:token/comments', async (req, res, next) => {
  try {
    const g = await guestNote(req);
    if (!g) return res.status(404).json({ error: 'This link is not available.' });
    res.json({ comments: await listComments(g.note.id, { session: g.sid }) });
  } catch (err) { next(err); }
});

collabPublic.post('/:token/comments', async (req, res, next) => {
  try {
    const g = await guestNote(req);
    if (!g) return res.status(404).json({ error: 'This link is not available.' });
    const r = await addComment(g.note.id, { name: g.name, color: String(req.body?.color || ''), session: g.sid }, req.body);
    if (!r.ok) return res.status(400).json({ error: r.error });
    const owner = await prisma.user.findUnique({ where: { id: g.note.userId }, select: { name: true } });
    const body = String(req.body?.body || '');
    const mentioned = !!owner?.name && body.toLowerCase().includes('@' + owner.name.trim().toLowerCase());
    const what = req.body?.kind === 'suggestion' ? 'suggested a change in' : mentioned ? 'mentioned you in' : 'commented on';
    await notifyOwner(req.app, g.note.userId, { kind: mentioned ? 'mention' : req.body?.kind === 'suggestion' ? 'suggestion' : 'comment', noteId: g.note.id, title: `${g.name} ${what} “${g.note.title || 'Untitled'}”`, body: body || String(req.body?.replacement || ''), from: g.name });
    res.json({ id: r.id });
  } catch (err) { next(err); }
});

collabPublic.patch('/:token/comments/:cid', async (req, res, next) => {
  try {
    const g = await guestNote(req);
    if (!g) return res.status(404).json({ error: 'This link is not available.' });
    if (!(await setStatus(g.note.id, req.params.cid, String(req.body?.status || '')))) return res.status(400).json({ error: 'Could not change that.' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

collabPublic.delete('/:token/comments/:cid', async (req, res, next) => {
  try {
    const g = await guestNote(req);
    if (!g) return res.status(404).json({ error: 'This link is not available.' });
    if (!(await removeComment(g.note.id, req.params.cid, { session: g.sid, owner: false }))) return res.status(404).json({ error: 'Comment not found' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

export default router;

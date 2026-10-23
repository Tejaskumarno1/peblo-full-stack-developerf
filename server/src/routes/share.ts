import { Router } from 'express';
import crypto from 'crypto';
import prisma from '../db.js';
import { authenticate, verifyToken } from '../middleware/auth.js';

/*
 * Share links. The owner turns a link on for one note or one task; anyone who has the link can read it (never edit).
 * The link holds a long random secret, and turning sharing off makes the old link stop working at once.
 */
export const shareRoutes = Router();
shareRoutes.use(authenticate);

const newToken = () => crypto.randomBytes(18).toString('base64url');
const kindOf = (k: string) => (k === 'note' || k === 'todo' ? k : null);
// A link whose end date has passed stops working (the owner can turn it on again from the share box).
const LIVE = () => ({ OR: [{ shareExpiresAt: null }, { shareExpiresAt: { gt: new Date() } }] });

async function owned(kind: 'note' | 'todo', id: string, userId: string) {
  if (kind === 'note') return prisma.note.findFirst({ where: { id, userId, isDeleted: false }, select: { id: true, shareToken: true, shareEdit: true, shareExpiresAt: true } });
  return prisma.todo.findFirst({ where: { id, userId }, select: { id: true, shareToken: true, shareEdit: true, shareExpiresAt: true } });
}
async function setToken(kind: 'note' | 'todo', id: string, token: string | null, edit = false, expiresAt: Date | null = null) {
  const data = { shareToken: token, shareEdit: token ? edit : false, shareExpiresAt: token ? expiresAt : null };
  if (kind === 'note') await prisma.note.update({ where: { id }, data, select: { id: true } });
  else await prisma.todo.update({ where: { id }, data, select: { id: true } });
}

// GET /api/share -> everything this person has shared: [{ kind, id, title, token, edit }]
shareRoutes.get('/', async (req, res, next) => {
  try {
    const uid = req.user!.id;
    const [notes, todos] = await Promise.all([
      prisma.note.findMany({ where: { userId: uid, isDeleted: false, shareToken: { not: null } }, select: { id: true, title: true, shareToken: true, shareEdit: true, shareExpiresAt: true, updatedAt: true }, orderBy: { updatedAt: 'desc' } }),
      prisma.todo.findMany({ where: { userId: uid, shareToken: { not: null } }, select: { id: true, text: true, shareToken: true, shareEdit: true, shareExpiresAt: true, updatedAt: true }, orderBy: { updatedAt: 'desc' } }),
    ]);
    const rows = [
      ...notes.map((n) => ({ kind: 'note', id: n.id, title: n.title || 'Untitled', token: n.shareToken, edit: !!n.shareEdit, expiresAt: n.shareExpiresAt ?? null, updatedAt: n.updatedAt })),
      ...todos.map((t) => ({ kind: 'todo', id: t.id, title: t.text || 'Task', token: t.shareToken, edit: !!t.shareEdit, expiresAt: t.shareExpiresAt ?? null, updatedAt: t.updatedAt })),
    ].sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt));
    res.json({ links: rows });
  } catch (e) { next(e); }
});

// GET /api/share/:kind/:id -> { token: string | null }
shareRoutes.get('/:kind/:id', async (req, res, next) => {
  try {
    const kind = kindOf(req.params.kind);
    if (!kind) return res.status(400).json({ error: 'You can share a note or a task.' });
    const row = await owned(kind, req.params.id, req.user!.id);
    if (!row) return res.status(404).json({ error: 'Not found.' });
    res.json({ token: row.shareToken ?? null, edit: !!row.shareEdit, expiresAt: row.shareExpiresAt ?? null });
  } catch (e) { next(e); }
});

// POST /api/share/:kind/:id -> turn the link on (keeps the same link if it is already on)
shareRoutes.post('/:kind/:id', async (req, res, next) => {
  try {
    const kind = kindOf(req.params.kind);
    if (!kind) return res.status(400).json({ error: 'You can share a note or a task.' });
    const row = await owned(kind, req.params.id, req.user!.id);
    if (!row) return res.status(404).json({ error: 'Not found.' });
    const edit = typeof req.body?.edit === 'boolean' ? req.body.edit : !!row.shareEdit;
    let token = row.shareToken;
    if (!token) token = newToken();
    // expiresInDays: a number sets an end date, null (or 0) means never, leaving it out keeps what the link had.
    const days = req.body?.expiresInDays;
    let expiresAt: Date | null = row.shareExpiresAt && row.shareExpiresAt.getTime() > Date.now() ? row.shareExpiresAt : null;
    if (days === null || days === 0) expiresAt = null;
    else if (typeof days === 'number' && days > 0 && days <= 3650) expiresAt = new Date(Date.now() + days * 86400000);
    await setToken(kind, row.id, token, edit, expiresAt);
    res.status(201).json({ token, edit, expiresAt });
  } catch (e) { next(e); }
});

// DELETE /api/share/:kind/:id -> turn the link off
shareRoutes.delete('/:kind/:id', async (req, res, next) => {
  try {
    const kind = kindOf(req.params.kind);
    if (!kind) return res.status(400).json({ error: 'You can share a note or a task.' });
    const row = await owned(kind, req.params.id, req.user!.id);
    if (!row) return res.status(404).json({ error: 'Not found.' });
    await setToken(kind, row.id, null);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

/** What anyone with a link can read. No sign-in. */
export const publicRoutes = Router();
publicRoutes.use((_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  next();
});

const validToken = (t: string) => /^[A-Za-z0-9_-]{20,40}$/.test(t);
const PRESENCE_TTL_MS = 35_000;
type ViewerPresence = { sessionId: string; name: string; seenAt: number };
const liveViewers = new Map<string, Map<string, ViewerPresence>>();
const viewerNames = new Map<string, { name: string; expiresAt: number }>();
const presenceKey = (kind: 'note' | 'todo', token: string) => `${kind}:${token}`;

function prunePresence(key?: string) {
  const now = Date.now();
  const rooms = key ? [[key, liveViewers.get(key)] as const] : liveViewers.entries();
  for (const [roomKey, room] of rooms) {
    if (!room) continue;
    for (const [sessionId, viewer] of room) if (now - viewer.seenAt > PRESENCE_TTL_MS) room.delete(sessionId);
    if (!room.size) liveViewers.delete(roomKey);
  }
  for (const [userId, entry] of viewerNames) if (entry.expiresAt < now) viewerNames.delete(userId);
}
const presenceSweep = setInterval(() => prunePresence(), 15_000);
presenceSweep.unref?.();

async function shareOwner(kind: 'note' | 'todo', token: string, userId: string) {
  if (kind === 'note') return prisma.note.findFirst({ where: { shareToken: token, userId, isDeleted: false }, select: { id: true } });
  return prisma.todo.findFirst({ where: { shareToken: token, userId }, select: { id: true } });
}

// The share link remains public, but only its owner can see management controls or revoke it.
publicRoutes.get('/:kind/:token/owner', authenticate, async (req, res, next) => {
  try {
    const kind = kindOf(req.params.kind);
    if (!kind || !validToken(req.params.token)) return res.status(404).json({ error: 'Not found.' });
    const row = await shareOwner(kind, req.params.token, req.user!.id);
    res.json({ isOwner: !!row });
  } catch (e) { next(e); }
});

publicRoutes.delete('/:kind/:token', authenticate, async (req, res, next) => {
  try {
    const kind = kindOf(req.params.kind);
    if (!kind || !validToken(req.params.token)) return res.status(404).json({ error: 'Not found.' });
    const row = await shareOwner(kind, req.params.token, req.user!.id);
    if (!row) return res.status(404).json({ error: 'This link is not yours to turn off.' });
    await setToken(kind, row.id, null);
    liveViewers.delete(presenceKey(kind, req.params.token));
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// Anonymous visitors are represented as Guests; signed-in visitors may appear by their Peblo display name.
// No email, IP address, or other account detail is returned. Inactive sessions expire automatically.
publicRoutes.post('/:kind/:token/presence', async (req, res, next) => {
  try {
    const kind = kindOf(req.params.kind);
    const { token } = req.params;
    const sessionId = req.body?.sessionId;
    if (!kind || !validToken(token)) return res.status(404).json({ error: 'This link is not shared any more.' });
    if (typeof sessionId !== 'string' || !/^[A-Za-z0-9_-]{16,80}$/.test(sessionId)) return res.status(400).json({ error: 'A valid viewer session is required.' });
    const record = kind === 'note'
      ? await prisma.note.findFirst({ where: { shareToken: token, ...LIVE(), isDeleted: false }, select: { id: true } })
      : await prisma.todo.findFirst({ where: { shareToken: token, ...LIVE() }, select: { id: true } });
    if (!record) return res.status(404).json({ error: 'This link is not shared any more.' });

    const auth = req.headers.authorization || '';
    const user = await verifyToken(auth.startsWith('Bearer ') ? auth.slice(7) : null);
    let name = 'Guest';
    if (user) {
      const cached = viewerNames.get(user.id);
      if (cached && cached.expiresAt > Date.now()) name = cached.name;
      else {
        const profile = await prisma.user.findUnique({ where: { id: user.id }, select: { name: true } });
        name = profile?.name?.trim().slice(0, 80) || 'Peblo member';
        viewerNames.set(user.id, { name, expiresAt: Date.now() + 5 * 60_000 });
      }
    }

    const key = presenceKey(kind, token);
    prunePresence(key);
    let room = liveViewers.get(key);
    if (!room) { room = new Map(); liveViewers.set(key, room); }
    if (req.body?.active === false) room.delete(sessionId);
    else room.set(sessionId, { sessionId, name, seenAt: Date.now() });
    if (!room.size) liveViewers.delete(key);

    res.json({ viewers: [...(liveViewers.get(key)?.values() || [])].map((viewer) => ({
      id: crypto.createHash('sha256').update(viewer.sessionId).digest('hex').slice(0, 12),
      name: viewer.name,
      self: viewer.sessionId === sessionId,
    })) });
  } catch (e) { next(e); }
});

publicRoutes.get('/note/:token', async (req, res, next) => {
  try {
    if (!validToken(req.params.token)) return res.status(404).json({ error: 'This link is not shared any more.' });
    const note = await prisma.note.findFirst({
      where: { shareToken: req.params.token, ...LIVE(), isDeleted: false },
      select: { title: true, content: true, updatedAt: true, shareEdit: true, user: { select: { name: true } } },
    });
    if (!note) return res.status(404).json({ error: 'This link is not shared any more.' });
    res.json({ kind: 'note', title: note.title, content: note.content, updatedAt: note.updatedAt, canEdit: note.shareEdit, author: note.user?.name || null });
  } catch (e) { next(e); }
});

publicRoutes.get('/todo/:token', async (req, res, next) => {
  try {
    if (!validToken(req.params.token)) return res.status(404).json({ error: 'This link is not shared any more.' });
    const t = await prisma.todo.findFirst({
      where: { shareToken: req.params.token, ...LIVE() },
      select: {
        text: true, completed: true, priority: true, deadline: true, todoTags: true, updatedAt: true, shareEdit: true,
        note: { select: { title: true, content: true, isDeleted: true } },
        user: { select: { name: true } },
      },
    });
    if (!t) return res.status(404).json({ error: 'This link is not shared any more.' });
    res.json({
      kind: 'todo', text: t.text, completed: t.completed, priority: t.priority, deadline: t.deadline,
      tags: Array.isArray(t.todoTags) ? t.todoTags : [], updatedAt: t.updatedAt, canEdit: t.shareEdit, author: t.user?.name || null,
      note: t.note && !t.note.isDeleted ? { title: t.note.title, content: t.note.content } : null,
    });
  } catch (e) { next(e); }
});

const MAX_NOTE = 8_000_000;

// PUT /api/public/note/:token { title?, content, baseUpdatedAt, force? } -> save an edit made through an "can edit" link.
// If the owner (or someone else) saved after the editor opened the note, answer 409 with the latest copy instead of overwriting.
publicRoutes.put('/note/:token', async (req, res, next) => {
  try {
    if (!validToken(req.params.token)) return res.status(404).json({ error: 'This link is not shared any more.' });
    const note = await prisma.note.findFirst({ where: { shareToken: req.params.token, ...LIVE(), isDeleted: false }, select: { id: true, title: true, content: true, updatedAt: true, shareEdit: true } });
    if (!note) return res.status(404).json({ error: 'This link is not shared any more.' });
    if (!note.shareEdit) return res.status(403).json({ error: 'This link is view only.' });
    const { title, content, baseUpdatedAt, force } = req.body || {};
    if (typeof content !== 'string' || content.length > MAX_NOTE) return res.status(400).json({ error: 'That note is too big to save.' });
    if (!force && baseUpdatedAt && new Date(baseUpdatedAt).getTime() < note.updatedAt.getTime() && content !== note.content) {
      return res.status(409).json({ error: 'Someone else changed this note while you were editing.', latest: { title: note.title, content: note.content, updatedAt: note.updatedAt } });
    }
    const saved = await prisma.note.update({
      where: { id: note.id },
      data: { content, ...(typeof title === 'string' ? { title: title.slice(0, 300) || 'Untitled' } : {}) },
      select: { updatedAt: true },
    });
    res.json({ ok: true, updatedAt: saved.updatedAt });
  } catch (e) { next(e); }
});

// PUT /api/public/todo/:token { completed?, text? } -> an editor can tick the task off or reword it.
publicRoutes.put('/todo/:token', async (req, res, next) => {
  try {
    if (!validToken(req.params.token)) return res.status(404).json({ error: 'This link is not shared any more.' });
    const t = await prisma.todo.findFirst({ where: { shareToken: req.params.token, ...LIVE() }, select: { id: true, shareEdit: true } });
    if (!t) return res.status(404).json({ error: 'This link is not shared any more.' });
    if (!t.shareEdit) return res.status(403).json({ error: 'This link is view only.' });
    const data: { completed?: boolean; text?: string } = {};
    if (typeof req.body?.completed === 'boolean') data.completed = req.body.completed;
    if (typeof req.body?.text === 'string' && req.body.text.trim()) data.text = req.body.text.trim().slice(0, 500);
    const saved = await prisma.todo.update({ where: { id: t.id }, data, select: { updatedAt: true, completed: true, text: true } });
    res.json({ ok: true, ...saved });
  } catch (e) { next(e); }
});

import { Router } from 'express';
import crypto from 'crypto';
import prisma from '../db.js';
import { authenticate, verifyToken } from '../middleware/auth.js';
import { saveNoteMerged } from '../services/noteSave.js';

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

// GET /api/share/:kind/:id/live[?typing=1] -> who is on this link right now (for the owner's open note).
// Calling it also marks the owner as present (and typing) so people on the link see "<owner> is typing…".
shareRoutes.get('/:kind/:id/live', async (req, res, next) => {
  try {
    const kind = kindOf(req.params.kind);
    if (!kind) return res.status(400).json({ error: 'You can share a note or a task.' });
    const row = await owned(kind, req.params.id, req.user!.id);
    if (!row) return res.status(404).json({ error: 'Not found.' });
    const live = await prisma.note.count({ where: { id: row.id, shareToken: { not: null }, ...LIVE() } }).catch(() => 0);
    if (kind !== 'note' || !row.shareToken || !live) return res.json({ shared: false, viewers: [] });
    const me = await prisma.user.findUnique({ where: { id: req.user!.id }, select: { name: true } });
    const session = `owner:${req.user!.id}`;
    await touchViewer(kind, row.shareToken, session, me?.name?.trim().slice(0, 80) || 'Owner', req.query.typing === '1');
    const viewers = (await listViewers(kind, row.shareToken, session)).filter((v) => !v.self);
    res.json({ shared: true, canEdit: !!row.shareEdit, viewers });
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
const viewerNames = new Map<string, { name: string; expiresAt: number }>();

const prunePresence = () => prisma.$executeRawUnsafe('DELETE FROM share_viewers WHERE seen_at < NOW() - INTERVAL \'35 seconds\'').catch(() => {});
const presenceSweep = setInterval(() => { void prunePresence(); }, 15_000);
presenceSweep.unref?.();

/** Mark a person as present (and, when `typing`, as typing for the next few seconds). */
const touchViewer = (kind: string, token: string, sessionId: string, name: string, typing: boolean) => prisma.$executeRawUnsafe(
  'INSERT INTO share_viewers (kind, share_token, session_id, display_name, seen_at, typing_at) VALUES ($1, $2, $3, $4, NOW(), CASE WHEN $5 THEN NOW() ELSE NULL END) ON CONFLICT (kind, share_token, session_id) DO UPDATE SET display_name = EXCLUDED.display_name, seen_at = NOW(), typing_at = CASE WHEN $5 THEN NOW() ELSE share_viewers.typing_at END',
  kind, token, sessionId, name, typing,
);
/** Everyone on the link right now. No emails or addresses: a short id, a name, and whether they are typing. */
async function listViewers(kind: string, token: string, mySession: string) {
  const rows = await prisma.$queryRawUnsafe<{ session_id: string; display_name: string; typing: boolean }[]>(
    'SELECT session_id, display_name, (typing_at IS NOT NULL AND typing_at >= NOW() - INTERVAL \'4 seconds\') AS typing FROM share_viewers WHERE kind = $1 AND share_token = $2 AND seen_at >= NOW() - INTERVAL \'35 seconds\' ORDER BY seen_at DESC LIMIT 50',
    kind, token,
  );
  return rows.map((v) => ({
    id: crypto.createHash('sha256').update(v.session_id).digest('hex').slice(0, 12),
    name: v.display_name,
    self: v.session_id === mySession,
    typing: !!v.typing,
    owner: v.session_id.startsWith('owner:'), // guests cannot use ':' in a session id
  }));
}

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
    await prisma.$executeRawUnsafe('DELETE FROM share_viewers WHERE kind = $1 AND share_token = $2', kind, req.params.token);
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

    if (req.body?.active === false) {
      await prisma.$executeRawUnsafe('DELETE FROM share_viewers WHERE kind = $1 AND share_token = $2 AND session_id = $3', kind, token, sessionId);
    } else {
      await touchViewer(kind, token, sessionId, name, req.body?.typing === true);
    }
    res.json({ viewers: await listViewers(kind, token, sessionId) });
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
    const note = await prisma.note.findFirst({ where: { shareToken: req.params.token, ...LIVE(), isDeleted: false }, select: { id: true, userId: true, shareEdit: true } });
    if (!note) return res.status(404).json({ error: 'This link is not shared any more.' });
    if (!note.shareEdit) return res.status(403).json({ error: 'This link is view only.' });
    const { title, content, baseUpdatedAt, baseContent, force, keepBoth } = req.body || {};
    if (typeof content !== 'string' || content.length > MAX_NOTE) return res.status(400).json({ error: 'That note is too big to save.' });
    // Both people's edits are merged; the write is conditional so two saves at the same moment cannot overwrite each other.
    const r = await saveNoteMerged(
      { id: note.id, shareToken: req.params.token, isDeleted: false },
      { content, title: typeof title === 'string' ? title : undefined, baseUpdatedAt, baseContent: typeof baseContent === 'string' ? baseContent : null, force: !!force, keepBoth: !!keepBoth },
    );
    if (r.status === 'missing') return res.status(404).json({ error: 'This link is not shared any more.' });
    if (r.status === 'conflict') return res.status(409).json({ error: 'Someone else changed the same words while you were editing.', latest: r.latest });
    try { (req.app as any)?.get?.('io')?.to(note.userId).emit('notes_changed'); } catch { /* live refresh is best-effort */ }
    res.json({ ok: true, status: r.status, updatedAt: r.updatedAt, ...(r.status !== 'saved' ? { content: r.content } : {}) });
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

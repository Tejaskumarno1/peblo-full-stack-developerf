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
    const kind = kindOf(String(req.params.kind));
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
    const kind = kindOf(String(req.params.kind));
    if (!kind) return res.status(400).json({ error: 'You can share a note or a task.' });
    const row = await owned(kind, req.params.id, req.user!.id);
    if (!row) return res.status(404).json({ error: 'Not found.' });
    const live = await prisma.note.count({ where: { id: row.id, shareToken: { not: null }, ...LIVE() } }).catch(() => 0);
    if (kind !== 'note' || !row.shareToken || !live) return res.json({ shared: false, viewers: [] });
    const me = await prisma.user.findUnique({ where: { id: req.user!.id }, select: { name: true } });
    const session = `owner:${req.user!.id}`;
    await touchViewer(kind, row.shareToken, session, me?.name?.trim().slice(0, 80) || 'Owner', req.query.typing === '1', cleanCursor(req.query.cursor), cleanCursor(req.query.selStart), cleanCursor(req.query.selEnd));
    const viewers = await listViewers(kind, row.shareToken, session, !!row.shareEdit);
    res.json({ shared: true, token: row.shareToken, canEdit: !!row.shareEdit, expiresAt: row.shareExpiresAt ?? null, viewers });
  } catch (e) { next(e); }
});

// POST /api/share/:kind/:id/viewers/:vid/remove -> the owner removes one person from the link. They are dropped from
// the list and cannot come back in on this link (turning the link off and on again gives a new one).
shareRoutes.post('/:kind/:id/viewers/:vid/remove', async (req, res, next) => {
  try {
    const kind = kindOf(String(req.params.kind));
    if (!kind) return res.status(400).json({ error: 'You can share a note or a task.' });
    const row = await owned(kind, req.params.id, req.user!.id);
    if (!row || !row.shareToken) return res.status(404).json({ error: 'Not found.' });
    const rows = await prisma.$queryRawUnsafe<{ session_id: string }[]>('SELECT session_id FROM share_viewers WHERE kind = $1 AND share_token = $2', kind, row.shareToken);
    const hit = rows.find((r) => !r.session_id.startsWith('owner:') && viewerHash(r.session_id) === req.params.vid);
    if (!hit) return res.status(404).json({ error: 'That person already left.' });
    await prisma.$executeRawUnsafe('INSERT INTO share_blocked (kind, share_token, session_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', kind, row.shareToken, hit.session_id);
    await prisma.$executeRawUnsafe('DELETE FROM share_viewers WHERE kind = $1 AND share_token = $2 AND session_id = $3', kind, row.shareToken, hit.session_id);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// GET /api/share/note/:id/activity -> what happened on this note's link, newest first.
shareRoutes.get('/:kind/:id/activity', async (req, res, next) => {
  try {
    const kind = kindOf(String(req.params.kind));
    if (kind !== 'note') return res.json({ activity: [] });
    const row = await owned(kind, req.params.id, req.user!.id);
    if (!row) return res.status(404).json({ error: 'Not found.' });
    const rows = await prisma.$queryRawUnsafe<{ actor: string; action: string; at: Date }[]>(
      'SELECT actor, action, at FROM share_activity WHERE note_id = $1 ORDER BY at DESC LIMIT 30', row.id,
    );
    res.json({ activity: rows });
  } catch (e) { next(e); }
});

// POST /api/share/:kind/:id -> turn the link on (keeps the same link if it is already on)
shareRoutes.post('/:kind/:id', async (req, res, next) => {
  try {
    const kind = kindOf(String(req.params.kind));
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
    const kind = kindOf(String(req.params.kind));
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

const viewerHash = (sessionId: string) => crypto.createHash('sha256').update(sessionId).digest('hex').slice(0, 12);
const isBlocked = async (kind: string, token: string, sessionId: unknown) =>
  typeof sessionId === 'string' && /^[A-Za-z0-9_-]{16,80}$/.test(sessionId)
  && (await prisma.$queryRawUnsafe<{ n: number }[]>('SELECT 1 AS n FROM share_blocked WHERE kind = $1 AND share_token = $2 AND session_id = $3', kind, token, sessionId)).length > 0;
const prunePresence = () => Promise.all([
  prisma.$executeRawUnsafe('DELETE FROM share_viewers WHERE seen_at < NOW() - INTERVAL \'35 seconds\''),
  prisma.$executeRawUnsafe('DELETE FROM share_blocked WHERE at < NOW() - INTERVAL \'7 days\''),
]).catch(() => {});
const presenceSweep = setInterval(() => { void prunePresence(); }, 15_000);
presenceSweep.unref?.();

/** Mark a person as present (and, when `typing`, as typing for the next few seconds). */
async function touchViewer(kind: string, token: string, sessionId: string, name: string, typing: boolean, cursor: number | null = null, selStart: number | null = null, selEnd: number | null = null): Promise<boolean> {
  const rows = await prisma.$queryRawUnsafe<{ inserted: boolean }[]>(
    'INSERT INTO share_viewers (kind, share_token, session_id, display_name, seen_at, typing_at, cursor_block, sel_start, sel_end) VALUES ($1, $2, $3, $4, NOW(), CASE WHEN $5 THEN NOW() ELSE NULL END, $6, $7, $8) ON CONFLICT (kind, share_token, session_id) DO UPDATE SET display_name = EXCLUDED.display_name, seen_at = NOW(), typing_at = CASE WHEN $5 THEN NOW() ELSE share_viewers.typing_at END, cursor_block = COALESCE($6, share_viewers.cursor_block), sel_start = CASE WHEN $6 IS NULL THEN share_viewers.sel_start ELSE $7 END, sel_end = CASE WHEN $6 IS NULL THEN share_viewers.sel_end ELSE $8 END RETURNING (xmax = 0) AS inserted',
    kind, token, sessionId, name, typing, cursor, selStart, selEnd,
  );
  return !!rows[0]?.inserted;
}
/** A guest's name from the share page: plain text only, 40 characters, never empty. */
const cleanName = (raw: unknown) => (typeof raw === 'string' ? raw.replace(/[\u0000-\u001f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 40) : '') || 'Guest';
const cleanCursor = (raw: unknown) => { const n = Number(raw); return Number.isInteger(n) && n >= 0 && n < 100000 ? n : null; };
/** What happened on a shared note. An edit by the same person within 2 minutes just refreshes the last line. */
async function logActivity(noteId: string, actor: string, action: 'viewed' | 'edited' | 'merged' | 'clash') {
  try {
    if (action === 'edited' || action === 'viewed') {
      const within = action === 'edited' ? '2 minutes' : '10 minutes';
      const n = await prisma.$executeRawUnsafe(`UPDATE share_activity SET at = NOW() WHERE id = (SELECT id FROM share_activity WHERE note_id = $1 AND actor = $2 AND action = $3 AND at >= NOW() - INTERVAL '${within}' ORDER BY at DESC LIMIT 1)`, noteId, actor, action);
      if (n > 0) return;
    }
    await prisma.$executeRawUnsafe('INSERT INTO share_activity (note_id, actor, action) VALUES ($1, $2, $3)', noteId, actor, action);
    await prisma.$executeRawUnsafe("DELETE FROM share_activity WHERE note_id = $1 AND at < NOW() - INTERVAL '60 days'", noteId);
  } catch { /* the log is a convenience, never a reason to fail a save */ }
}
/** Everyone on the link right now. No emails or addresses: a short id, a name, and whether they are typing. */
async function listViewers(kind: string, token: string, mySession: string, canEdit = false) {
  const rows = await prisma.$queryRawUnsafe<{ session_id: string; display_name: string; typing: boolean; cursor_block: number | null; sel_start: number | null; sel_end: number | null; idle_s: number }[]>(
    'SELECT session_id, display_name, cursor_block, sel_start, sel_end, (typing_at IS NOT NULL AND typing_at >= NOW() - INTERVAL \'4 seconds\') AS typing, EXTRACT(EPOCH FROM (NOW() - seen_at))::int AS idle_s FROM share_viewers WHERE kind = $1 AND share_token = $2 AND seen_at >= NOW() - INTERVAL \'35 seconds\' ORDER BY seen_at DESC LIMIT 50',
    kind, token,
  );
  return rows.map((v) => ({
    id: viewerHash(v.session_id),
    name: v.display_name,
    self: v.session_id === mySession,
    typing: !!v.typing,
    // editing: typed in the last few seconds; idle: no sign of life for 20 s (a hidden tab slows its heartbeat);
    // reading: on a view-only link; viewing: on an editable link without typing
    status: v.typing ? 'editing' : Number(v.idle_s) >= 20 ? 'idle' : canEdit ? 'viewing' : 'reading',
    idleSeconds: Math.max(0, Number(v.idle_s)),
    cursor: v.cursor_block,
    selStart: v.sel_start,
    selEnd: v.sel_end,
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
    const kind = kindOf(String(req.params.kind));
    if (!kind || !validToken(String(req.params.token))) return res.status(404).json({ error: 'Not found.' });
    const row = await shareOwner(kind, String(req.params.token), req.user!.id);
    res.json({ isOwner: !!row });
  } catch (e) { next(e); }
});

publicRoutes.delete('/:kind/:token', authenticate, async (req, res, next) => {
  try {
    const kind = kindOf(String(req.params.kind));
    if (!kind || !validToken(String(req.params.token))) return res.status(404).json({ error: 'Not found.' });
    const row = await shareOwner(kind, String(req.params.token), req.user!.id);
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
    const kind = kindOf(String(req.params.kind));
    const { token } = req.params;
    const sessionId = req.body?.sessionId;
    if (!kind || !validToken(token)) return res.status(404).json({ error: 'This link is not shared any more.' });
    if (typeof sessionId !== 'string' || !/^[A-Za-z0-9_-]{16,80}$/.test(sessionId)) return res.status(400).json({ error: 'A valid viewer session is required.' });
    const record = kind === 'note'
      ? await prisma.note.findFirst({ where: { shareToken: token, ...LIVE(), isDeleted: false }, select: { id: true, shareEdit: true } })
      : await prisma.todo.findFirst({ where: { shareToken: token, ...LIVE() }, select: { id: true, shareEdit: true } });
    if (!record) return res.status(404).json({ error: 'This link is not shared any more.' });
    if (await isBlocked(kind, token, sessionId)) return res.status(403).json({ error: 'The owner removed you from this page.', removed: true });

    const auth = req.headers.authorization || '';
    const user = await verifyToken(auth.startsWith('Bearer ') ? auth.slice(7) : null);
    let name = cleanName(req.body?.name);
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
      const fresh = await touchViewer(kind, token, sessionId, name, req.body?.typing === true, cleanCursor(req.body?.cursor), cleanCursor(req.body?.selStart), cleanCursor(req.body?.selEnd));
      if (fresh && kind === 'note') void logActivity(record.id, name, 'viewed');
    }
    res.json({ viewers: await listViewers(kind, token, sessionId, !!record.shareEdit) });
  } catch (e) { next(e); }
});

publicRoutes.get('/note/:token', async (req, res, next) => {
  try {
    if (!validToken(req.params.token)) return res.status(404).json({ error: 'This link is not shared any more.' });
    const note = await prisma.note.findFirst({
      where: { shareToken: req.params.token, ...LIVE(), isDeleted: false },
      select: { title: true, content: true, updatedAt: true, shareEdit: true, shareExpiresAt: true, user: { select: { name: true } } },
    });
    if (!note) return res.status(404).json({ error: 'This link is not shared any more.' });
    res.json({ kind: 'note', title: note.title, content: note.content, updatedAt: note.updatedAt, canEdit: note.shareEdit, expiresAt: note.shareExpiresAt ?? null, author: note.user?.name || null });
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
    if (await isBlocked('note', req.params.token, req.body?.sessionId)) return res.status(403).json({ error: 'The owner removed you from this page.', removed: true });
    const { title, content, baseUpdatedAt, baseContent, keepBoth, collab } = req.body || {};
    const force = req.body?.force || collab === true; // live-room editors already hold the merged text
    if (typeof content !== 'string' || content.length > MAX_NOTE) return res.status(400).json({ error: 'That note is too big to save.' });
    // Both people's edits are merged; the write is conditional so two saves at the same moment cannot overwrite each other.
    const r = await saveNoteMerged(
      { id: note.id, shareToken: req.params.token, isDeleted: false },
      { content, title: typeof title === 'string' ? title : undefined, baseUpdatedAt, baseContent: typeof baseContent === 'string' ? baseContent : null, force: !!force, keepBoth: !!keepBoth, collab: collab === true },
    );
    if (r.status === 'missing') return res.status(404).json({ error: 'This link is not shared any more.' });
    if (r.status === 'conflict') return res.status(409).json({ error: 'Someone else changed the same words while you were editing.', latest: r.latest });
    const who = cleanName(req.body?.name);
    void logActivity(note.id, who, r.status === 'saved' ? 'edited' : r.status === 'merged' ? 'merged' : 'clash');
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

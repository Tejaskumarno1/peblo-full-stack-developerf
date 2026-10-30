import { Router } from 'express';
import crypto from 'crypto';
import prisma from '../db.js';
import { authenticate, verifyToken } from '../middleware/auth.js';
import { saveNoteMerged } from '../services/noteSave.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { accessFor, approvalOn, listWaiting, guestHash, SESSION_RE } from '../services/shareAccess.js';

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
/** A turned-off link leaves nothing behind: guests, presence, blocks, read stats, short code. */
async function purgeToken(kind: string, token: string) {
  await Promise.all(['share_viewers', 'share_guests', 'share_blocked', 'share_reads', 'share_settings'].map((t) => prisma.$executeRawUnsafe(`DELETE FROM ${t} WHERE kind = $1 AND share_token = $2`, kind, token))).catch(() => {});
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
    const style = String(req.query.style || '');
    if (style === 'soft' || style === 'river' || style === 'orbit') await prisma.$executeRawUnsafe('INSERT INTO share_settings (kind, share_token, style) VALUES ($1, $2, $3) ON CONFLICT (kind, share_token) DO UPDATE SET style = EXCLUDED.style', kind, row.shareToken, style).catch(() => {});
    const ext = (await prisma.$queryRawUnsafe<{ extend_at: Date | null; extend_by: string | null }[]>('SELECT extend_at, extend_by FROM share_settings WHERE kind = $1 AND share_token = $2', kind, row.shareToken))[0];
    const viewers = await listViewers(kind, row.shareToken, session, !!row.shareEdit);
    res.json({ extendRequest: ext?.extend_at ? { at: ext.extend_at, by: ext.extend_by || 'A guest' } : null, shared: true, token: row.shareToken, canEdit: !!row.shareEdit, expiresAt: row.shareExpiresAt ?? null, viewers, approval: await approvalOn(kind, row.shareToken), waiting: await listWaiting(kind, row.shareToken) });
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

// POST /api/share/:kind/:id/approval { on } -> ask people to wait until the owner lets them in. People already on the page stay in.
shareRoutes.post('/:kind/:id/approval', async (req, res, next) => {
  try {
    const kind = kindOf(String(req.params.kind));
    if (!kind) return res.status(400).json({ error: 'You can share a note or a task.' });
    const row = await owned(kind, req.params.id, req.user!.id);
    if (!row || !row.shareToken) return res.status(404).json({ error: 'Not found.' });
    const on = req.body?.on === true;
    await prisma.$executeRawUnsafe('INSERT INTO share_settings (kind, share_token, approval) VALUES ($1, $2, $3) ON CONFLICT (kind, share_token) DO UPDATE SET approval = EXCLUDED.approval', kind, row.shareToken, on);
    if (on) {
      await prisma.$executeRawUnsafe("INSERT INTO share_guests (kind, share_token, session_id, name, status) SELECT kind, share_token, session_id, display_name, 'admitted' FROM share_viewers WHERE kind = $1 AND share_token = $2 AND session_id NOT LIKE 'owner:%' ON CONFLICT (kind, share_token, session_id) DO UPDATE SET status = 'admitted' WHERE share_guests.status = 'waiting'", kind, row.shareToken);
    }
    res.json({ ok: true, approval: on });
  } catch (e) { next(e); }
});

// POST /api/share/:kind/:id/guests/:gid/(admit|decline) -> let one waiting person in, or turn them away
for (const verb of ['admit', 'decline'] as const) shareRoutes.post(`/:kind/:id/guests/:gid/${verb}`, async (req, res, next) => {
  try {
    const kind = kindOf(String(req.params.kind));
    if (!kind) return res.status(400).json({ error: 'You can share a note or a task.' });
    const row = await owned(kind, req.params.id, req.user!.id);
    if (!row || !row.shareToken) return res.status(404).json({ error: 'Not found.' });
    const rows = await prisma.$queryRawUnsafe<{ session_id: string }[]>('SELECT session_id FROM share_guests WHERE kind = $1 AND share_token = $2', kind, row.shareToken);
    const hit = rows.find((r) => guestHash(r.session_id) === req.params.gid);
    if (!hit) return res.status(404).json({ error: 'That person already left.' });
    const status = verb === 'admit' ? 'admitted' : 'declined';
    await prisma.$executeRawUnsafe('UPDATE share_guests SET status = $4, at = NOW() WHERE kind = $1 AND share_token = $2 AND session_id = $3', kind, row.shareToken, hit.session_id, status);
    res.json({ ok: true, status });
  } catch (e) { next(e); }
});

// POST /api/share/:kind/:id/viewers/:vid/role { role: 'view' | 'edit' | null } -> one person's own role on this link
shareRoutes.post('/:kind/:id/viewers/:vid/role', async (req, res, next) => {
  try {
    const kind = kindOf(String(req.params.kind));
    if (!kind) return res.status(400).json({ error: 'You can share a note or a task.' });
    const row = await owned(kind, req.params.id, req.user!.id);
    if (!row || !row.shareToken) return res.status(404).json({ error: 'Not found.' });
    const role = req.body?.role;
    if (role !== 'view' && role !== 'edit' && role !== null) return res.status(400).json({ error: 'Pick view or edit.' });
    const rows = await prisma.$queryRawUnsafe<{ session_id: string; display_name: string }[]>('SELECT session_id, display_name FROM share_viewers WHERE kind = $1 AND share_token = $2', kind, row.shareToken);
    const hit = rows.find((r) => !r.session_id.startsWith('owner:') && viewerHash(r.session_id) === req.params.vid);
    if (!hit) return res.status(404).json({ error: 'That person already left.' });
    await prisma.$executeRawUnsafe("INSERT INTO share_guests (kind, share_token, session_id, name, status, role) VALUES ($1, $2, $3, $4, 'admitted', $5) ON CONFLICT (kind, share_token, session_id) DO UPDATE SET role = EXCLUDED.role", kind, row.shareToken, hit.session_id, hit.display_name, role);
    res.json({ ok: true, role });
  } catch (e) { next(e); }
});

// GET /api/share/:kind/:id/short -> a short link (/l/abc123) for the same page, made once and kept
const CODE_CHARS = 'abcdefghjkmnpqrstuvwxyz23456789';
const newCode = () => Array.from(crypto.randomBytes(10), (b) => CODE_CHARS[b % CODE_CHARS.length]).join('');
shareRoutes.get('/:kind/:id/short', async (req, res, next) => {
  try {
    const kind = kindOf(String(req.params.kind));
    if (!kind) return res.status(400).json({ error: 'You can share a note or a task.' });
    const row = await owned(kind, req.params.id, req.user!.id);
    if (!row || !row.shareToken) return res.status(404).json({ error: 'Not found.' });
    const have = (await prisma.$queryRawUnsafe<{ short_code: string | null }[]>('SELECT short_code FROM share_settings WHERE kind = $1 AND share_token = $2', kind, row.shareToken))[0];
    if (have?.short_code) return res.json({ code: have.short_code });
    for (let i = 0; i < 5; i++) {
      const code = newCode();
      try {
        await prisma.$executeRawUnsafe('INSERT INTO share_settings (kind, share_token, short_code) VALUES ($1, $2, $3) ON CONFLICT (kind, share_token) DO UPDATE SET short_code = COALESCE(share_settings.short_code, EXCLUDED.short_code)', kind, row.shareToken, code);
        const now = (await prisma.$queryRawUnsafe<{ short_code: string }[]>('SELECT short_code FROM share_settings WHERE kind = $1 AND share_token = $2', kind, row.shareToken))[0];
        return res.json({ code: now.short_code });
      } catch { /* a clash: try another code */ }
    }
    res.status(500).json({ error: 'Could not make a short link.' });
  } catch (e) { next(e); }
});

// ---- polls written into a shared note ----
type PollRow = { id: string; question: string; options: string[]; open: boolean; named: boolean };
async function pollsFor(noteId: string, sid: string | null, owner: boolean) {
  const polls = await prisma.$queryRawUnsafe<PollRow[]>('SELECT id, question, options, open, named FROM share_polls WHERE note_id = $1 ORDER BY at ASC LIMIT 10', noteId);
  if (!polls.length) return [];
  const ids = polls.map((p) => p.id);
  const votes = await prisma.$queryRawUnsafe<{ poll_id: string; session_id: string; name: string; choice: number }[]>('SELECT poll_id, session_id, name, choice FROM share_poll_votes WHERE poll_id = ANY($1::text[])', ids);
  return polls.map((p) => {
    const mine = votes.filter((v) => v.poll_id === p.id);
    const counts = p.options.map((_, i) => mine.filter((v) => v.choice === i).length);
    return {
      id: p.id, question: p.question, options: p.options, open: p.open, named: p.named, counts, total: mine.length,
      mine: sid ? mine.find((v) => v.session_id === sid)?.choice ?? null : null,
      ...(p.named || owner ? { voters: mine.map((v) => ({ name: v.name, choice: v.choice })) } : {}),
    };
  });
}
const cleanPoll = (b: any) => {
  const question = typeof b?.question === 'string' ? b.question.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 140) : '';
  const options = Array.isArray(b?.options) ? b.options.map((o: unknown) => (typeof o === 'string' ? o.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 60) : '')).filter(Boolean).slice(0, 4) : [];
  return question && options.length >= 2 ? { question, options, named: b?.named === true } : null;
};
shareRoutes.get('/note/:id/polls', async (req, res, next) => {
  try {
    const row = await owned('note', req.params.id, req.user!.id);
    if (!row) return res.status(404).json({ error: 'Not found.' });
    res.json({ polls: await pollsFor(row.id, null, true) });
  } catch (e) { next(e); }
});
shareRoutes.post('/note/:id/polls', async (req, res, next) => {
  try {
    const row = await owned('note', req.params.id, req.user!.id);
    if (!row) return res.status(404).json({ error: 'Not found.' });
    const p = cleanPoll(req.body);
    if (!p) return res.status(400).json({ error: 'A poll needs a question and at least two options.' });
    const n = (await prisma.$queryRawUnsafe<{ n: number }[]>('SELECT COUNT(*)::int AS n FROM share_polls WHERE note_id = $1', row.id))[0]?.n ?? 0;
    if (n >= 5) return res.status(400).json({ error: 'A page can hold five polls.' });
    const id = crypto.randomBytes(6).toString('hex');
    await prisma.$executeRawUnsafe('INSERT INTO share_polls (id, note_id, question, options, named) VALUES ($1, $2, $3, $4::jsonb, $5)', id, row.id, p.question, JSON.stringify(p.options), p.named);
    res.status(201).json({ id });
  } catch (e) { next(e); }
});
for (const verb of ['close', 'reopen', 'reset', 'remove'] as const) {
  shareRoutes.post(`/note/:id/polls/:pid/${verb}`, async (req, res, next) => {
    try {
      const row = await owned('note', req.params.id, req.user!.id);
      if (!row) return res.status(404).json({ error: 'Not found.' });
      const has = await prisma.$queryRawUnsafe<{ id: string }[]>('SELECT id FROM share_polls WHERE id = $1 AND note_id = $2', req.params.pid, row.id);
      if (!has.length) return res.status(404).json({ error: 'That poll is gone.' });
      if (verb === 'close' || verb === 'reopen') await prisma.$executeRawUnsafe('UPDATE share_polls SET open = $2 WHERE id = $1', req.params.pid, verb === 'reopen');
      else {
        await prisma.$executeRawUnsafe('DELETE FROM share_poll_votes WHERE poll_id = $1', req.params.pid);
        if (verb === 'remove') await prisma.$executeRawUnsafe('DELETE FROM share_polls WHERE id = $1', req.params.pid);
      }
      res.json({ ok: true });
    } catch (e) { next(e); }
  });
}

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
    // numbers for the owner: visits, different people, edits, and visits per day for the last 7 days
    const sum = await prisma.$queryRawUnsafe<{ visits: number; people: number; edits: number }[]>(
      "SELECT COUNT(*) FILTER (WHERE action = 'viewed')::int AS visits, COUNT(DISTINCT actor) FILTER (WHERE action IN ('viewed','edited'))::int AS people, COUNT(*) FILTER (WHERE action = 'edited')::int AS edits FROM share_activity WHERE note_id = $1", row.id,
    );
    const days = await prisma.$queryRawUnsafe<{ d: number; n: number }[]>(
      "SELECT (CURRENT_DATE - at::date)::int AS d, COUNT(*)::int AS n FROM share_activity WHERE note_id = $1 AND action = 'viewed' AND at >= CURRENT_DATE - 6 GROUP BY 1", row.id,
    );
    const perDay = Array.from({ length: 7 }, (_, i) => days.find((x) => x.d === 6 - i)?.n ?? 0);
    const rd = row.shareToken ? await prisma.$queryRawUnsafe<{ name: string; progress: number; secs: number; last_at: Date }[]>('SELECT name, progress, secs, last_at FROM share_reads WHERE kind = $1 AND share_token = $2 ORDER BY last_at DESC LIMIT 20', 'note', row.shareToken) : [];
    const stops = Array.from({ length: 10 }, (_, i) => rd.filter((r) => Math.min(9, Math.floor(r.progress / 10)) === i).length);
    const finished = rd.filter((r) => r.progress >= 90).length;
    const readers = { count: rd.length, finishRate: rd.length ? Math.round((finished / rd.length) * 100) : 0, avgSecs: rd.length ? Math.round(rd.reduce((a, r) => a + r.secs, 0) / rd.length) : 0, stops, people: rd.map((r) => ({ name: r.name, progress: r.progress, secs: r.secs, lastAt: r.last_at })) };
    res.json({ activity: rows, stats: { visits: sum[0]?.visits ?? 0, people: sum[0]?.people ?? 0, edits: sum[0]?.edits ?? 0, perDay, readers } });
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
    await prisma.$executeRawUnsafe('UPDATE share_settings SET extend_at = NULL, extend_by = NULL WHERE kind = $1 AND share_token = $2', kind, token).catch(() => {});
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
    const old = row.shareToken;
    await setToken(kind, row.id, null);
    if (old) await purgeToken(kind, old);
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
  prisma.$executeRawUnsafe("DELETE FROM share_guests WHERE status = 'waiting' AND at < NOW() - INTERVAL '1 hour'"),
  prisma.$executeRawUnsafe("DELETE FROM share_guests WHERE status = 'declined' AND role IS NULL AND at < NOW() - INTERVAL '1 day'"),
  prisma.$executeRawUnsafe("DELETE FROM share_reads WHERE last_at < NOW() - INTERVAL '30 days'"),
]).then(() => { const now = Date.now(); for (const [k, v] of viewerNames) if (v.expiresAt <= now) viewerNames.delete(k); }).catch(() => {});
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
  const roleRows = await prisma.$queryRawUnsafe<{ session_id: string; role: string | null }[]>('SELECT session_id, role FROM share_guests WHERE kind = $1 AND share_token = $2 AND role IS NOT NULL', kind, token);
  const roles = new Map(roleRows.map((r) => [r.session_id, r.role]));
  const can = (v: { session_id: string }) => (roles.has(v.session_id) ? roles.get(v.session_id) === 'edit' : canEdit);
  return rows.map((v) => ({
    id: viewerHash(v.session_id),
    canEdit: can(v),
    custom: roles.has(v.session_id),
    name: v.display_name,
    self: v.session_id === mySession,
    typing: !!v.typing,
    // editing: typed in the last few seconds; idle: no sign of life for 20 s (a hidden tab slows its heartbeat);
    // reading: on a view-only link; viewing: on an editable link without typing
    status: v.typing ? 'editing' : Number(v.idle_s) >= 20 ? 'idle' : can(v) ? 'viewing' : 'reading',
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
    await purgeToken(kind, String(req.params.token));
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// Anonymous visitors are represented as Guests; signed-in visitors may appear by their Peblo display name.
// No email, IP address, or other account detail is returned. Inactive sessions expire automatically.
publicRoutes.post('/:kind/:token/presence', (req, res, next) => guestPresenceLimit(req, res, next), async (req, res, next) => {
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
    const owner = user ? !!(await shareOwner(kind, token, user.id)) : false;
    const acc = await accessFor(kind, token, sessionId, !!record.shareEdit, owner);
    if (!acc.allowed) return res.status(403).json({ error: 'Waiting for the owner to let you in.', waiting: acc.waiting || 'waiting' });
    let name = cleanName(req.body?.name);
    if (user) {
      const cached = viewerNames.get(user.id);
      if (cached && cached.expiresAt > Date.now()) name = cached.name;
      else {
        const profile = await prisma.user.findUnique({ where: { id: user.id }, select: { name: true } });
        name = profile?.name?.trim().slice(0, 80) || 'Peblo member';
        if (viewerNames.size >= 1000) viewerNames.delete(viewerNames.keys().next().value as string); // oldest entry out: the cache cannot grow without bound
        viewerNames.set(user.id, { name, expiresAt: Date.now() + 5 * 60_000 });
      }
    }

    if (req.body?.active === false) {
      await prisma.$executeRawUnsafe('DELETE FROM share_viewers WHERE kind = $1 AND share_token = $2 AND session_id = $3', kind, token, sessionId);
    } else {
      const fresh = await touchViewer(kind, token, sessionId, name, req.body?.typing === true, cleanCursor(req.body?.cursor), cleanCursor(req.body?.selStart), cleanCursor(req.body?.selEnd));
      if (fresh && kind === 'note') void logActivity(record.id, name, 'viewed');
      if (kind === 'note' && !owner) {
        const progress = Math.max(0, Math.min(100, Math.round(Number(req.body?.progress) || 0)));
        void prisma.$executeRawUnsafe('INSERT INTO share_reads (kind, share_token, session_id, name, progress) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (kind, share_token, session_id) DO UPDATE SET name = EXCLUDED.name, progress = GREATEST(share_reads.progress, EXCLUDED.progress), secs = share_reads.secs + LEAST(EXTRACT(EPOCH FROM (NOW() - share_reads.last_at))::int, 15), last_at = NOW()', kind, token, sessionId, name, progress).catch(() => {});
      }
    }
    res.json({ viewers: await listViewers(kind, token, sessionId, !!record.shareEdit), canEdit: acc.canEdit });
  } catch (e) { next(e); }
});

// POST /api/public/:kind/:token/knock { sessionId, name } -> a guest asks to be let in (only matters when the owner asked for approval).
publicRoutes.post('/:kind/:token/knock', (req, res, next) => guestKnockLimit(req, res, next), async (req, res, next) => {
  try {
    const kind = kindOf(String(req.params.kind));
    const { token } = req.params;
    const sessionId = req.body?.sessionId;
    if (!kind || !validToken(token)) return res.status(404).json({ error: 'This link is not shared any more.' });
    if (typeof sessionId !== 'string' || !SESSION_RE.test(sessionId)) return res.status(400).json({ error: 'A valid viewer session is required.' });
    const live = kind === 'note'
      ? await prisma.note.count({ where: { shareToken: token, ...LIVE(), isDeleted: false } })
      : await prisma.todo.count({ where: { shareToken: token, ...LIVE() } });
    if (!live) return res.status(404).json({ error: 'This link is not shared any more.' });
    if (await isBlocked(kind, token, sessionId)) return res.status(403).json({ error: 'The owner removed you from this page.', removed: true });
    if (!(await approvalOn(kind, token))) return res.json({ status: 'admitted' });
    const seen = await prisma.$queryRawUnsafe<{ n: number }[]>('SELECT COUNT(*)::int AS n FROM share_guests WHERE kind = $1 AND share_token = $2 AND status = \'waiting\' AND session_id <> $3', kind, token, sessionId);
    if ((seen[0]?.n ?? 0) >= 500) return res.status(429).json({ error: 'Too many people are waiting. Try again later.' });
    const rows = await prisma.$queryRawUnsafe<{ status: string }[]>(
      "INSERT INTO share_guests (kind, share_token, session_id, name, status, at) VALUES ($1, $2, $3, $4, 'waiting', NOW()) ON CONFLICT (kind, share_token, session_id) DO UPDATE SET name = EXCLUDED.name, at = NOW() RETURNING status",
      kind, token, sessionId, cleanName(req.body?.name));
    res.json({ status: rows[0]?.status || 'waiting' });
  } catch (e) { next(e); }
});

publicRoutes.get('/note/:token/polls', async (req, res, next) => {
  try {
    if (!validToken(req.params.token)) return res.status(404).json({ error: 'This link is not shared any more.' });
    const note = await prisma.note.findFirst({ where: { shareToken: req.params.token, ...LIVE(), isDeleted: false }, select: { id: true, shareEdit: true } });
    if (!note) return res.status(404).json({ error: 'This link is not shared any more.' });
    const acc = await accessFor('note', req.params.token, req.query.sid, !!note.shareEdit, await ownerReq(req, 'note', req.params.token));
    if (!acc.allowed || (await isBlocked('note', req.params.token, req.query.sid))) return res.json({ polls: [] });
    const sid = typeof req.query.sid === 'string' && SESSION_RE.test(req.query.sid) ? req.query.sid : null;
    res.json({ polls: await pollsFor(note.id, sid, false) });
  } catch (e) { next(e); }
});
publicRoutes.post('/note/:token/polls/:pid/vote', (req, res, next) => guestWriteLimit(req, res, next), async (req, res, next) => {
  try {
    if (!validToken(req.params.token)) return res.status(404).json({ error: 'This link is not shared any more.' });
    const sid = req.body?.sessionId;
    if (typeof sid !== 'string' || !SESSION_RE.test(sid)) return res.status(400).json({ error: 'A valid viewer session is required.' });
    const note = await prisma.note.findFirst({ where: { shareToken: req.params.token, ...LIVE(), isDeleted: false }, select: { id: true, shareEdit: true } });
    if (!note) return res.status(404).json({ error: 'This link is not shared any more.' });
    if (await isBlocked('note', req.params.token, sid)) return res.status(403).json({ error: 'The owner removed you from this page.', removed: true });
    const acc = await accessFor('note', req.params.token, sid, !!note.shareEdit, await ownerReq(req, 'note', req.params.token));
    if (!acc.allowed) return res.status(403).json({ error: 'Waiting for the owner to let you in.', waiting: acc.waiting || 'waiting' });
    const poll = (await prisma.$queryRawUnsafe<PollRow[]>('SELECT id, question, options, open, named FROM share_polls WHERE id = $1 AND note_id = $2', req.params.pid, note.id))[0];
    if (!poll) return res.status(404).json({ error: 'That poll is gone.' });
    if (!poll.open) return res.status(409).json({ error: 'This poll is closed.' });
    const choice = Number(req.body?.choice);
    if (!Number.isInteger(choice) || choice < 0 || choice >= poll.options.length) return res.status(400).json({ error: 'Pick one of the options.' });
    await prisma.$executeRawUnsafe('INSERT INTO share_poll_votes (poll_id, session_id, name, choice) VALUES ($1, $2, $3, $4) ON CONFLICT (poll_id, session_id) DO UPDATE SET choice = EXCLUDED.choice, name = EXCLUDED.name, at = NOW()', poll.id, sid, cleanName(req.body?.name), choice);
    res.json({ ok: true, polls: await pollsFor(note.id, sid, false) });
  } catch (e) { next(e); }
});

// POST /api/public/:kind/:token/extend-request { sessionId, name } -> "please keep this link going": the owner is told
publicRoutes.post('/:kind/:token/extend-request', (req, res, next) => guestWriteLimit(req, res, next), async (req, res, next) => {
  try {
    const kind = kindOf(String(req.params.kind));
    const { token } = req.params;
    if (!kind || !validToken(token)) return res.status(404).json({ error: 'This link is not shared any more.' });
    const live = kind === 'note' ? await prisma.note.count({ where: { shareToken: token, ...LIVE(), isDeleted: false } }) : await prisma.todo.count({ where: { shareToken: token, ...LIVE() } });
    if (!live) return res.status(404).json({ error: 'This link is not shared any more.' });
    if (await isBlocked(kind, token, req.body?.sessionId)) return res.status(403).json({ error: 'The owner removed you from this page.', removed: true });
    await prisma.$executeRawUnsafe('INSERT INTO share_settings (kind, share_token, extend_at, extend_by) VALUES ($1, $2, NOW(), $3) ON CONFLICT (kind, share_token) DO UPDATE SET extend_at = NOW(), extend_by = EXCLUDED.extend_by', kind, token, cleanName(req.body?.name));
    res.json({ ok: true });
  } catch (e) { next(e); }
});

export async function shortRedirect(req: any, res: any, next: any) {
  try {
    const code = String(req.params.code || '');
    if (!/^[a-z0-9]{4,12}$/.test(code)) return res.redirect(302, '/');
    const r = (await prisma.$queryRawUnsafe<{ kind: string; share_token: string }[]>('SELECT kind, share_token FROM share_settings WHERE short_code = $1', code))[0];
    if (!r || !validToken(r.share_token)) return res.redirect(302, '/');
    res.redirect(302, `/s/${r.kind === 'todo' ? 'todo' : 'note'}/${r.share_token}`);
  } catch (e) { next(e); }
}

async function ownerReq(req: any, kind: 'note' | 'todo', token: string) {
  const auth = String(req.headers.authorization || '');
  if (!auth.startsWith('Bearer ')) return false;
  const u = await verifyToken(auth.slice(7));
  return !!u && !!(await shareOwner(kind, token, u.id));
}

publicRoutes.get('/note/:token', async (req, res, next) => {
  try {
    if (!validToken(req.params.token)) return res.status(404).json({ error: 'This link is not shared any more.' });
    const note = await prisma.note.findFirst({
      where: { shareToken: req.params.token, ...LIVE(), isDeleted: false },
      select: { title: true, content: true, updatedAt: true, shareEdit: true, shareExpiresAt: true, user: { select: { name: true } } },
    });
    if (!note) return res.status(404).json({ error: 'This link is not shared any more.' });
    const acc = await accessFor('note', req.params.token, req.query.sid, !!note.shareEdit, await ownerReq(req, 'note', req.params.token));
    if (!acc.allowed) return res.json({ kind: 'note', waiting: acc.waiting || 'waiting' });
    if (await isBlocked('note', req.params.token, req.query.sid)) return res.status(403).json({ error: 'The owner removed you from this page.', removed: true });
    const st = (await prisma.$queryRawUnsafe<{ style: string | null }[]>('SELECT style FROM share_settings WHERE kind = $1 AND share_token = $2', 'note', req.params.token))[0]?.style || null;
    res.json({ ownerStyle: st, kind: 'note', title: note.title, content: note.content, updatedAt: note.updatedAt, canEdit: acc.canEdit, expiresAt: note.shareExpiresAt ?? null, author: note.user?.name || null });
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
    const acc = await accessFor('todo', req.params.token, req.query.sid, !!t.shareEdit, await ownerReq(req, 'todo', req.params.token));
    if (!acc.allowed) return res.json({ kind: 'todo', waiting: acc.waiting || 'waiting' });
    if (await isBlocked('todo', req.params.token, req.query.sid)) return res.status(403).json({ error: 'The owner removed you from this page.', removed: true });
    res.json({
      kind: 'todo', text: t.text, completed: t.completed, priority: t.priority, deadline: t.deadline,
      tags: Array.isArray(t.todoTags) ? t.todoTags : [], updatedAt: t.updatedAt, canEdit: acc.canEdit, author: t.user?.name || null,
      note: t.note && !t.note.isDeleted ? { title: t.note.title, content: t.note.content } : null,
    });
  } catch (e) { next(e); }
});

const MAX_NOTE = 8_000_000;
// Unauthenticated writes: a tighter per-address cap than the global API limit (poll votes and extension requests).
const guestWriteLimit = rateLimit({ windowMs: 60_000, max: 30, message: 'Too many requests. Wait a minute and try again.' });
// Per-address caps for the public link handlers. Autosave through an edit link is frequent, so saves get a roomy limit.
const guestSaveLimit = rateLimit({ windowMs: 60_000, max: 300, message: 'Saving too fast. Wait a moment and try again.' });
const guestKnockLimit = rateLimit({ windowMs: 60_000, max: 30, message: 'Too many requests. Wait a minute and try again.' });
const guestPresenceLimit = rateLimit({ windowMs: 60_000, max: 120, message: 'Too many requests. Wait a moment and try again.' });

// PUT /api/public/note/:token { title?, content, baseUpdatedAt, force? } -> save an edit made through an "can edit" link.
// If the owner (or someone else) saved after the editor opened the note, answer 409 with the latest copy instead of overwriting.
publicRoutes.put('/note/:token', (req, res, next) => guestSaveLimit(req, res, next), async (req, res, next) => {
  try {
    if (!validToken(req.params.token)) return res.status(404).json({ error: 'This link is not shared any more.' });
    const note = await prisma.note.findFirst({ where: { shareToken: req.params.token, ...LIVE(), isDeleted: false }, select: { id: true, userId: true, shareEdit: true } });
    if (!note) return res.status(404).json({ error: 'This link is not shared any more.' });
    const acc = await accessFor('note', req.params.token, req.body?.sessionId, !!note.shareEdit);
    if (!acc.allowed) return res.status(403).json({ error: 'Waiting for the owner to let you in.', waiting: acc.waiting || 'waiting' });
    if (!acc.canEdit) return res.status(403).json({ error: 'This link is view only.' });
    if (await isBlocked('note', req.params.token, req.body?.sessionId)) return res.status(403).json({ error: 'The owner removed you from this page.', removed: true });
    const { title, content, baseUpdatedAt, baseContent, keepBoth, collab } = req.body || {};
    const force = req.body?.force || collab === true; // live-room editors already hold the merged text
    if (typeof content !== 'string' || content.length > MAX_NOTE) return res.status(400).json({ error: 'That note is too big to save.' });
    // Both people's edits are merged; the write is conditional so two saves at the same moment cannot overwrite each other.
    const r = await saveNoteMerged(
      { id: note.id, shareToken: req.params.token, isDeleted: false },
      { content, title: typeof title === 'string' ? title.slice(0, 500) : undefined, baseUpdatedAt, baseContent: typeof baseContent === 'string' ? baseContent : null, force: !!force, keepBoth: !!keepBoth, collab: collab === true, by: req.body?.name ? cleanName(req.body.name) : undefined },
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
publicRoutes.put('/todo/:token', (req, res, next) => guestSaveLimit(req, res, next), async (req, res, next) => {
  try {
    if (!validToken(req.params.token)) return res.status(404).json({ error: 'This link is not shared any more.' });
    const t = await prisma.todo.findFirst({ where: { shareToken: req.params.token, ...LIVE() }, select: { id: true, shareEdit: true } });
    if (!t) return res.status(404).json({ error: 'This link is not shared any more.' });
    const acc = await accessFor('todo', req.params.token, req.body?.sessionId, !!t.shareEdit);
    if (!acc.allowed) return res.status(403).json({ error: 'Waiting for the owner to let you in.', waiting: acc.waiting || 'waiting' });
    if (!acc.canEdit) return res.status(403).json({ error: 'This link is view only.' });
    if (await isBlocked('todo', req.params.token, req.body?.sessionId)) return res.status(403).json({ error: 'The owner removed you from this page.', removed: true });
    const data: { completed?: boolean; text?: string } = {};
    if (typeof req.body?.completed === 'boolean') data.completed = req.body.completed;
    if (typeof req.body?.text === 'string' && req.body.text.trim()) data.text = req.body.text.trim().slice(0, 500);
    const saved = await prisma.todo.update({ where: { id: t.id }, data, select: { updatedAt: true, completed: true, text: true } });
    res.json({ ok: true, ...saved });
  } catch (e) { next(e); }
});

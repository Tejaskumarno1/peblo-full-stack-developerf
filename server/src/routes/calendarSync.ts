import { Router } from 'express';
import crypto from 'crypto';
import prisma from '../db.js';
import { authenticate } from '../middleware/auth.js';
import { buildIcs, FeedError, feedWindow, readFeed, zonedToUtc, type FeedEvent } from '../services/icsFeeds.js';

/*
 * Calendar sync: subscribe to other calendars by their .ics link (read only), hand out an .ics link and a free-time link
 * for your own calendar. Signed in with a person's own login only (not an AI access token). Raw SQL, tables in 034_calendar_sync.sql.
 */
const router = Router();
const publicRouter = Router();
router.use(authenticate);

const COLORS = ['sky', 'mint', 'peach', 'lilac', 'butter', 'rose'];
const STALE_MS = 6 * 3600 * 1000;
const newToken = () => crypto.randomBytes(24).toString('base64url');
const newId = () => crypto.randomUUID();
const hostKind = (url: string) => { try { const h = new URL(url.replace(/^webcal:/i, 'https:')).hostname; return /google/.test(h) ? 'Google' : /outlook|office|live\.com|microsoft/.test(h) ? 'Outlook' : /icloud|apple/.test(h) ? 'Apple' : 'Link'; } catch { return 'Link'; } };

type FeedRow = { id: string; name: string; url: string; color: string; enabled: boolean; events: FeedEvent[]; last_synced_at: Date | null; last_error: string | null };
const shape = (f: FeedRow) => ({ id: f.id, name: f.name, kind: hostKind(f.url), color: f.color, enabled: f.enabled, lastSyncedAt: f.last_synced_at, error: f.last_error, count: Array.isArray(f.events) ? f.events.length : 0 });

const inflight = new Set<string>();
async function refresh(f: FeedRow, userId: string): Promise<void> {
  if (inflight.has(f.id)) return;
  inflight.add(f.id);
  try {
    const events = await readFeed(f.url);
    await prisma.$executeRaw`UPDATE calendar_feeds SET events = ${JSON.stringify(events)}::jsonb, last_synced_at = now(), last_error = NULL WHERE id = ${f.id} AND user_id = ${userId}`;
  } catch (e: any) {
    const msg = e instanceof FeedError ? e.message : 'Could not read that calendar right now.';
    await prisma.$executeRaw`UPDATE calendar_feeds SET last_error = ${msg}, last_synced_at = COALESCE(last_synced_at, NULL) WHERE id = ${f.id} AND user_id = ${userId}`;
    if (!(e instanceof FeedError)) console.warn('[calendar-sync] refresh failed:', e?.message || e);
  } finally { inflight.delete(f.id); }
}
const feedsOf = (userId: string) => prisma.$queryRaw<FeedRow[]>`SELECT id, name, url, color, enabled, events, last_synced_at, last_error FROM calendar_feeds WHERE user_id = ${userId} ORDER BY created_at`;
function refreshStale(rows: FeedRow[], userId: string) {
  for (const f of rows) if (f.enabled && (!f.last_synced_at || Date.now() - new Date(f.last_synced_at).getTime() > STALE_MS)) void refresh(f, userId);
}

async function shareRow(userId: string) {
  await prisma.$executeRaw`INSERT INTO calendar_share (user_id, feed_token, free_token) VALUES (${userId}, ${newToken()}, ${newToken()}) ON CONFLICT (user_id) DO NOTHING`;
  const [r] = await prisma.$queryRaw<{ feed_token: string; feed_on: boolean; free_token: string; free_on: boolean }[]>`SELECT feed_token, feed_on, free_token, free_on FROM calendar_share WHERE user_id = ${userId}`;
  return r;
}
const origin = (req: any) => (process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
const shareOut = (req: any, r: Awaited<ReturnType<typeof shareRow>>) => ({ feedOn: r.feed_on, feedUrl: `${origin(req)}/api/public/calendar/${r.feed_token}.ics`, freeOn: r.free_on, freeUrl: `${origin(req)}/api/public/calendar/free/${r.free_token}` });

// GET /api/calendar-sync -> { feeds, share }
router.get('/', async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const rows = await feedsOf(userId);
    refreshStale(rows, userId);
    res.json({ feeds: rows.map(shape), share: shareOut(req, await shareRow(userId)) });
  } catch (e) { next(e); }
});

// POST /api/calendar-sync/feeds { url, name?, color? } -> reads it now; refuses a link that is not a calendar
router.post('/feeds', async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const url = String(req.body?.url || '').trim().slice(0, 2000);
    const [{ n }] = await prisma.$queryRaw<{ n: number }[]>`SELECT COUNT(*)::int AS n FROM calendar_feeds WHERE user_id = ${userId}`;
    if (n >= 10) return res.status(400).json({ error: 'You can follow up to 10 calendar links.' });
    let events: FeedEvent[];
    try { events = await readFeed(url); } catch (e: any) { if (e instanceof FeedError) return res.status(400).json({ error: e.message }); throw e; }
    const kind = hostKind(url);
    const name = String(req.body?.name || '').trim().slice(0, 60) || (kind === 'Link' ? 'Calendar link' : `${kind} calendar`);
    const color = COLORS.includes(req.body?.color) ? req.body.color : COLORS[n % COLORS.length];
    const id = newId();
    await prisma.$executeRaw`INSERT INTO calendar_feeds (id, user_id, name, url, color, events, last_synced_at) VALUES (${id}, ${userId}, ${name}, ${url}, ${color}, ${JSON.stringify(events)}::jsonb, now())`;
    const rows = await feedsOf(userId);
    res.status(201).json({ feed: shape(rows.find((r) => r.id === id)!) });
  } catch (e) { next(e); }
});

router.patch('/feeds/:id', async (req, res, next) => {
  try {
    const userId = req.user!.id; const id = String(req.params.id);
    const name = req.body?.name !== undefined ? String(req.body.name).trim().slice(0, 60) : null;
    const color = COLORS.includes(req.body?.color) ? req.body.color : null;
    const enabled = typeof req.body?.enabled === 'boolean' ? req.body.enabled : null;
    const n = await prisma.$executeRaw`UPDATE calendar_feeds SET name = COALESCE(NULLIF(${name}::text, ''), name), color = COALESCE(${color}::text, color), enabled = COALESCE(${enabled}::boolean, enabled) WHERE id = ${id} AND user_id = ${userId}`;
    if (!n) return res.status(404).json({ error: 'Not found.' });
    const f = (await feedsOf(userId)).find((r) => r.id === id)!;
    res.json({ feed: shape(f) });
  } catch (e) { next(e); }
});

// DELETE forgets the link and the copy of its events; the other calendar is never touched
router.delete('/feeds/:id', async (req, res, next) => {
  try {
    const n = await prisma.$executeRaw`DELETE FROM calendar_feeds WHERE id = ${String(req.params.id)} AND user_id = ${req.user!.id}`;
    if (!n) return res.status(404).json({ error: 'Not found.' });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.post('/feeds/:id/refresh', async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const f = (await feedsOf(userId)).find((r) => r.id === String(req.params.id));
    if (!f) return res.status(404).json({ error: 'Not found.' });
    await refresh(f, userId);
    res.json({ feed: shape((await feedsOf(userId)).find((r) => r.id === f.id)!) });
  } catch (e) { next(e); }
});

// GET /api/calendar-sync/events?from=YYYY-MM-DD&to=YYYY-MM-DD -> events of every switched-on link in that range
router.get('/events', async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const rows = await feedsOf(userId);
    refreshStale(rows, userId);
    const w = feedWindow();
    const fromMs = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.from)) ? Date.parse(String(req.query.from) + 'T00:00:00Z') - 86400000 : w.from;
    const toMs = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.to)) ? Date.parse(String(req.query.to) + 'T00:00:00Z') + 2 * 86400000 : w.to;
    const events = rows.filter((f) => f.enabled).flatMap((f) => (Array.isArray(f.events) ? f.events : []).filter((e) => {
      const s = e.allDay ? Date.parse(e.start + 'T00:00:00Z') : Date.parse(e.start);
      const en = e.allDay ? Date.parse(e.end + 'T00:00:00Z') : Date.parse(e.end);
      return en >= fromMs && s <= toMs;
    }).map((e) => ({ ...e, feedId: f.id, color: f.color, feed: f.name })));
    res.json({ events });
  } catch (e) { next(e); }
});

// PUT /api/calendar-sync/share { feedOn?, freeOn?, renew?: 'feed' | 'free' }
router.put('/share', async (req, res, next) => {
  try {
    const userId = req.user!.id;
    await shareRow(userId);
    if (typeof req.body?.feedOn === 'boolean') await prisma.$executeRaw`UPDATE calendar_share SET feed_on = ${req.body.feedOn} WHERE user_id = ${userId}`;
    if (typeof req.body?.freeOn === 'boolean') await prisma.$executeRaw`UPDATE calendar_share SET free_on = ${req.body.freeOn} WHERE user_id = ${userId}`;
    if (req.body?.renew === 'feed') await prisma.$executeRaw`UPDATE calendar_share SET feed_token = ${newToken()} WHERE user_id = ${userId}`;
    if (req.body?.renew === 'free') await prisma.$executeRaw`UPDATE calendar_share SET free_token = ${newToken()} WHERE user_id = ${userId}`;
    res.json({ share: shareOut(req, await shareRow(userId)) });
  } catch (e) { next(e); }
});

// ---------- public, no sign-in: the link itself is the key ----------
const dayInZone = (d: Date, tz: string) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
async function ownerOf(column: 'feed_token' | 'free_token', token: string) {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
  const rows = column === 'feed_token'
    ? await prisma.$queryRaw<{ user_id: string; tz: string }[]>`SELECT s.user_id, u.timezone AS tz FROM calendar_share s JOIN users u ON u.id = s.user_id WHERE s.feed_token = ${token} AND s.feed_on`
    : await prisma.$queryRaw<{ user_id: string; tz: string }[]>`SELECT s.user_id, u.timezone AS tz FROM calendar_share s JOIN users u ON u.id = s.user_id WHERE s.free_token = ${token} AND s.free_on`;
  return rows[0] || null;
}
function startEnd(t: { deadline: Date | null; startTime: string | null; endTime: string | null }, tz: string): { start: Date | null; end: Date | null; day: string | null } {
  if (!t.deadline) return { start: null, end: null, day: null };
  const day = dayInZone(t.deadline, tz);
  const at = (hhmm: string) => { const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm); return m ? new Date(zonedToUtc(+day.slice(0, 4), +day.slice(5, 7), +day.slice(8, 10), +m[1], +m[2], 0, tz)) : null; };
  const start = t.startTime ? at(t.startTime) : null;
  return { start, end: t.endTime ? at(t.endTime) : null, day };
}

// GET /api/public/calendar/<token>.ics -> the person's tasks and meetings
publicRouter.get('/calendar/:file', async (req, res, next) => {
  try {
    const m = /^([A-Za-z0-9_-]+)\.ics$/.exec(req.params.file);
    const owner = m && await ownerOf('feed_token', m[1]);
    if (!owner) return res.status(404).type('text/plain').send('Not found.');
    const since = new Date(Date.now() - 60 * 86400000);
    const todos = await prisma.todo.findMany({ where: { userId: owner.user_id, deadline: { gte: since } }, select: { id: true, text: true, deadline: true, startTime: true, endTime: true, completed: true, updatedAt: true }, orderBy: { deadline: 'asc' }, take: 1500 });
    const items = todos.map((t) => { const x = startEnd(t, owner.tz); return { id: t.id, text: t.text, start: x.start, end: x.end, day: x.day, done: t.completed, updated: t.updatedAt }; });
    res.set({ 'Content-Type': 'text/calendar; charset=utf-8', 'Cache-Control': 'private, max-age=300', 'Content-Disposition': 'inline; filename="peblo.ics"' }).send(buildIcs('Peblo', items));
  } catch (e) { next(e); }
});

// GET /api/public/calendar/free/<token> -> busy blocks only, never titles
publicRouter.get('/calendar/free/:token', async (req, res, next) => {
  try {
    const owner = await ownerOf('free_token', String(req.params.token));
    if (!owner) return res.status(404).json({ error: 'This link is not active.' });
    const now = Date.now();
    const todos = await prisma.todo.findMany({ where: { userId: owner.user_id, completed: false, startTime: { not: null }, deadline: { gte: new Date(now - 2 * 86400000), lte: new Date(now + 15 * 86400000) } }, select: { deadline: true, startTime: true, endTime: true } });
    const busy: { start: string; end: string }[] = [];
    for (const t of todos) { const x = startEnd(t, owner.tz); if (x.start) busy.push({ start: x.start.toISOString(), end: (x.end && x.end > x.start ? x.end : new Date(x.start.getTime() + 3600000)).toISOString() }); }
    const feeds = await feedsOf(owner.user_id);
    for (const f of feeds) if (f.enabled) for (const e of Array.isArray(f.events) ? f.events : []) if (!e.allDay && Date.parse(e.end) > now - 2 * 86400000 && Date.parse(e.start) < now + 15 * 86400000) busy.push({ start: e.start, end: e.end });
    busy.sort((a, b) => a.start.localeCompare(b.start));
    const [u] = await prisma.$queryRaw<{ name: string | null }[]>`SELECT name FROM users WHERE id = ${owner.user_id}`.catch(() => [{ name: null }]);
    res.set('Cache-Control', 'no-store');
    if (req.accepts(['json', 'html']) === 'html') {
      const esc = (x: string) => x.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
      const fmt = (iso: string) => new Intl.DateTimeFormat('en-GB', { timeZone: owner.tz, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
      const who = u?.name ? esc(u.name) : 'This person';
      const rows = busy.length ? busy.map((b) => `<li>${esc(fmt(b.start))} to ${esc(new Intl.DateTimeFormat('en-GB', { timeZone: owner.tz, hour: '2-digit', minute: '2-digit' }).format(new Date(b.end)))}</li>`).join('') : '<li>Nothing booked in the next two weeks.</li>';
      return res.type('html').send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Free time</title><style>body{font:16px/1.5 system-ui,sans-serif;max-width:520px;margin:40px auto;padding:0 20px;background:#faf6ef;color:#1d1b17}h1{font-size:28px;margin:0 0 4px}p{color:#6b655b}ul{padding:0;list-style:none;display:grid;gap:8px}li{background:#fff;border-radius:18px;padding:12px 16px}</style></head><body><h1>${who} is busy at these times</h1><p>Next two weeks, times in ${esc(owner.tz)}. Everything else is free.</p><ul>${rows}</ul></body></html>`);
    }
    res.json({ name: u?.name || null, timezone: owner.tz, busy });
  } catch (e) { next(e); }
});

export { router as calendarSyncRoutes, publicRouter as calendarPublicRoutes };

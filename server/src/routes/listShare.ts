import { Router, Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import prisma from '../db.js';
import { authenticate } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rateLimit.js';

/*
 * Sharing a whole task list. The owner makes one link per list and picks what people with it may do:
 * view, tick and comment, add (the owner approves each one), or edit. The link holds a long random secret,
 * may end on a date, and turning it off removes the guests and comments with it.
 */
export const PERMS = ['view', 'tick', 'add', 'edit'] as const;
type Perm = (typeof PERMS)[number];
const TOKEN_RE = /^[A-Za-z0-9_-]{20,40}$/;
const SESSION_RE = /^[A-Za-z0-9_-]{16,80}$/;
const newToken = () => crypto.randomBytes(18).toString('base64url');
const cleanName = (raw: unknown) => (typeof raw === 'string' ? raw.replace(/[\u0000-\u001f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 40) : '') || 'Guest';
const cleanText = (raw: unknown, max: number) => (typeof raw === 'string' ? raw.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, max) : '');

type Row = { token: string; user_id: string; list_name: string; perm: Perm; expires_at: Date | null; show_progress: boolean };

async function liveShare(token: string): Promise<Row | null> {
  if (!TOKEN_RE.test(token)) return null;
  const rows = await prisma.$queryRawUnsafe<Row[]>('SELECT token, user_id, list_name, perm, expires_at, show_progress FROM task_list_shares WHERE token = $1 AND (expires_at IS NULL OR expires_at > NOW())', token);
  return rows[0] || null;
}

/** The tasks of a list as guests see them: repeating tasks once (next open date), proposals left out. */
async function listTasks(userId: string, name: string) {
  const todos = await prisma.todo.findMany({
    where: { userId, meta: { path: ['list'], equals: name } },
    select: { id: true, text: true, completed: true, priority: true, deadline: true, todoTags: true, seriesId: true, meta: true, updatedAt: true },
    orderBy: [{ completed: 'asc' }, { deadline: 'asc' }, { createdAt: 'asc' }],
    take: 800,
  });
  const seen = new Set<string>();
  return todos.filter((t) => {
    if ((t.meta as any)?.proposal) return false;
    if (t.seriesId && !t.completed) { if (seen.has(t.seriesId)) return false; seen.add(t.seriesId); }
    return true;
  });
}
const stepsOf = (t: { meta: unknown }) => (Array.isArray((t.meta as any)?.subtasks) ? (t.meta as any).subtasks.map((s: any) => ({ text: String(s.text || ''), done: !!s.done })) : []);

async function touchGuest(token: string, sid: string, name: string, act: string) {
  await prisma.$executeRawUnsafe('INSERT INTO task_list_guests (token, session_id, name, last_act, last_at) VALUES ($1, $2, $3, $4, NOW()) ON CONFLICT (token, session_id) DO UPDATE SET name = EXCLUDED.name, last_act = EXCLUDED.last_act, last_at = NOW()', token, sid, name, act).catch(() => {});
}

/** ---- Owner side: /api/task-lists ---- */
export const listShareRoutes = Router();
listShareRoutes.use(authenticate);

async function describe(userId: string, r: Row) {
  const [guests, comments] = await Promise.all([
    prisma.$queryRawUnsafe<{ name: string; last_act: string | null }[]>('SELECT name, last_act FROM task_list_guests WHERE token = $1 ORDER BY last_at DESC LIMIT 20', r.token),
    prisma.$queryRawUnsafe<{ n: number }[]>('SELECT COUNT(*)::int AS n FROM task_list_comments WHERE token = $1', r.token),
  ]);
  const tasks = await listTasks(userId, r.list_name);
  return {
    list: r.list_name, token: r.token, perm: r.perm, expiresAt: r.expires_at, showProgress: r.show_progress,
    open: tasks.filter((t) => !t.completed).length, done: tasks.filter((t) => t.completed).length,
    guests: guests.map((g) => ({ name: g.name, act: g.last_act })), comments: comments[0]?.n ?? 0,
  };
}

// GET /api/task-lists/shares -> every list link this person has
listShareRoutes.get('/shares', async (req, res, next) => {
  try {
    const rows = await prisma.$queryRawUnsafe<Row[]>('SELECT token, user_id, list_name, perm, expires_at, show_progress FROM task_list_shares WHERE user_id = $1 ORDER BY created_at DESC', req.user!.id);
    res.json({ shares: await Promise.all(rows.map((r) => describe(req.user!.id, r))) });
  } catch (e) { next(e); }
});

// POST /api/task-lists/share { list, perm?, expiresInDays?, showProgress? } -> make or change the link for a list
listShareRoutes.post('/share', async (req, res, next) => {
  try {
    const uid = req.user!.id;
    const list = cleanText(req.body?.list, 60);
    if (!list) return res.status(400).json({ error: 'Which list?' });
    const perm = req.body?.perm;
    if (perm !== undefined && !(PERMS as readonly string[]).includes(perm)) return res.status(400).json({ error: 'That permission is not available.' });
    const old = (await prisma.$queryRawUnsafe<Row[]>('SELECT token, user_id, list_name, perm, expires_at, show_progress FROM task_list_shares WHERE user_id = $1 AND list_name = $2', uid, list))[0];
    const days = req.body?.expiresInDays;
    let expires: Date | null = old?.expires_at && old.expires_at.getTime() > Date.now() ? old.expires_at : null;
    if (days === null || days === 0) expires = null;
    else if (typeof days === 'number' && days > 0 && days <= 3650) expires = new Date(Date.now() + days * 86400000);
    const show = typeof req.body?.showProgress === 'boolean' ? req.body.showProgress : (old?.show_progress ?? true);
    const token = old?.token || newToken();
    await prisma.$executeRawUnsafe(
      'INSERT INTO task_list_shares (token, user_id, list_name, perm, expires_at, show_progress) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (user_id, list_name) DO UPDATE SET perm = EXCLUDED.perm, expires_at = EXCLUDED.expires_at, show_progress = EXCLUDED.show_progress',
      token, uid, list, perm ?? old?.perm ?? 'view', expires, show,
    );
    const row = (await prisma.$queryRawUnsafe<Row[]>('SELECT token, user_id, list_name, perm, expires_at, show_progress FROM task_list_shares WHERE token = $1', token))[0];
    res.status(201).json(await describe(uid, row));
  } catch (e) { next(e); }
});

// DELETE /api/task-lists/share?list=Exams -> stop sharing; guests and comments go with the link
listShareRoutes.delete('/share', async (req, res, next) => {
  try {
    const list = cleanText(req.query.list, 60);
    const rows = await prisma.$queryRawUnsafe<{ token: string }[]>('DELETE FROM task_list_shares WHERE user_id = $1 AND list_name = $2 RETURNING token', req.user!.id, list);
    for (const r of rows) await Promise.all(['task_list_guests', 'task_list_comments'].map((t) => prisma.$executeRawUnsafe(`DELETE FROM ${t} WHERE token = $1`, r.token))).catch(() => {});
    res.json({ ok: true, stopped: rows.length });
  } catch (e) { next(e); }
});

// GET /api/task-lists/comments?list=Exams -> what guests wrote on the tasks of a shared list
listShareRoutes.get('/comments', async (req, res, next) => {
  try {
    const list = cleanText(req.query.list, 60);
    const s = (await prisma.$queryRawUnsafe<Row[]>('SELECT token, user_id, list_name, perm, expires_at, show_progress FROM task_list_shares WHERE user_id = $1 AND list_name = $2', req.user!.id, list))[0];
    if (!s) return res.json({ comments: [] });
    const rows = await prisma.$queryRawUnsafe<{ todo_id: string; author: string; body: string; at: Date }[]>('SELECT todo_id, author, body, at FROM task_list_comments WHERE token = $1 ORDER BY at DESC LIMIT 100', s.token);
    const ids = [...new Set(rows.map((r) => r.todo_id))];
    const todos = ids.length ? await prisma.todo.findMany({ where: { id: { in: ids }, userId: req.user!.id }, select: { id: true, text: true } }) : [];
    const text = new Map(todos.map((t) => [t.id, t.text]));
    res.json({ comments: rows.map((r) => ({ task: text.get(r.todo_id) || 'a task', author: r.author, body: r.body, at: r.at })) });
  } catch (e) { next(e); }
});

/** ---- Guest side: /api/public/list/:token ---- */
export const listPublicRoutes = Router();
listPublicRoutes.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Robots-Tag', 'noindex, nofollow'); next(); });
const guestRead = rateLimit({ windowMs: 60_000, max: 240, message: 'Too many requests. Wait a minute and try again.' });
const guestWrite = rateLimit({ windowMs: 60_000, max: 40, message: 'Too many changes. Wait a minute and try again.' });
const gone = (res: Response) => res.status(404).json({ error: 'This list is not shared any more.' });

const MD_STATUS = (t: any) => (t.completed ? 'x' : ' ');
export async function listMarkdown(token: string) {
  const s = await liveShare(token);
  if (!s) return null;
  const [tasks, owner] = await Promise.all([listTasks(s.user_id, s.list_name), prisma.user.findUnique({ where: { id: s.user_id }, select: { name: true } })]);
  const done = tasks.filter((t) => t.completed).length;
  const next = tasks.find((t) => !t.completed);
  const out = [`# ${s.list_name}`, '', `Shared by ${owner?.name || 'the owner'} on Peblo. ${done} of ${tasks.length} done. Access: ${s.perm === 'view' ? 'read only' : s.perm === 'tick' ? 'can tick and comment' : s.perm === 'add' ? 'can propose tasks (the owner approves)' : 'can edit'}.`];
  if (next) out.push(`Next up: ${next.text}${next.deadline ? `, due ${new Date(next.deadline).toISOString().slice(0, 16).replace('T', ' ')} UTC` : ''}`);
  out.push('');
  for (const t of tasks) {
    const tags = Array.isArray(t.todoTags) ? (t.todoTags as string[]).map((g) => `#${g}`).join(' ') : '';
    const due = t.deadline ? ` (due ${new Date(t.deadline).toISOString().slice(0, 16).replace('T', ' ')} UTC)` : '';
    out.push(`- [${MD_STATUS(t)}] ${t.text}${due}${t.priority === 'high' ? ' [high]' : ''}${tags ? ` ${tags}` : ''}`);
    for (const st of stepsOf(t)) out.push(`  - [${st.done ? 'x' : ' '}] ${st.text}`);
    const src = (t.meta as any)?.source?.quote;
    if (src) out.push(`  > ${String(src).replace(/\s+/g, ' ').slice(0, 200)}`);
  }
  if (s.perm === 'add' || s.perm === 'edit') out.push('', `To propose a task, POST JSON {"text": "..."} to /api/public/list/${token}/tasks.`);
  return out.join('\n') + '\n';
}

// GET /api/public/list/:token -> the list for a guest
listPublicRoutes.get('/:token', guestRead, async (req, res, next) => {
  try {
    const s = await liveShare(String(req.params.token));
    if (!s) return gone(res);
    const [tasks, owner, comments] = await Promise.all([
      listTasks(s.user_id, s.list_name),
      prisma.user.findUnique({ where: { id: s.user_id }, select: { name: true } }),
      prisma.$queryRawUnsafe<{ todo_id: string; author: string; body: string; at: Date }[]>('SELECT todo_id, author, body, at FROM task_list_comments WHERE token = $1 ORDER BY at ASC LIMIT 500', s.token),
    ]);
    const byTask = new Map<string, { author: string; body: string; at: Date }[]>();
    for (const c of comments) byTask.set(c.todo_id, [...(byTask.get(c.todo_id) || []), { author: c.author, body: c.body, at: c.at }]);
    const done = tasks.filter((t) => t.completed).length;
    const next = tasks.find((t) => !t.completed);
    res.json({
      list: s.list_name, owner: owner?.name || null, perm: s.perm, expiresAt: s.expires_at, showProgress: s.show_progress,
      progress: { done, total: tasks.length }, next: next ? { text: next.text, deadline: next.deadline } : null,
      updatedAt: tasks.reduce((m, t) => (t.updatedAt > m ? t.updatedAt : m), new Date(0)),
      tasks: tasks.map((t) => ({ id: t.id, text: t.text, completed: t.completed, priority: t.priority, deadline: t.deadline, tags: Array.isArray(t.todoTags) ? t.todoTags : [], steps: stepsOf(t), comments: byTask.get(t.id) || [] })),
    });
  } catch (e) { next(e); }
});

async function guestAccess(req: Request, res: Response, need: 'tick' | 'add' | 'edit') {
  const s = await liveShare(String(req.params.token));
  if (!s) { gone(res); return null; }
  const sid = req.body?.sessionId;
  if (typeof sid !== 'string' || !SESSION_RE.test(sid)) { res.status(400).json({ error: 'Missing session.' }); return null; }
  const rank: Record<Perm, number> = { view: 0, tick: 1, add: 1, edit: 2 };
  const ok = need === 'tick' ? rank[s.perm] >= 1 : need === 'add' ? (s.perm === 'add' || s.perm === 'edit') : s.perm === 'edit';
  if (!ok) { res.status(403).json({ error: 'This link does not allow that.' }); return null; }
  return { s, sid, name: cleanName(req.body?.name) };
}
const inList = async (s: Row, id: string) => prisma.todo.findFirst({ where: { id, userId: s.user_id, meta: { path: ['list'], equals: s.list_name } }, select: { id: true, meta: true } });

// PUT /api/public/list/:token/tasks/:id { completed?, text?, sessionId, name } -> tick (tick, edit) or reword (edit)
listPublicRoutes.put('/:token/tasks/:id', guestWrite, async (req, res, next) => {
  try {
    const wantsText = typeof req.body?.text === 'string';
    const a = await guestAccess(req, res, wantsText ? 'edit' : 'tick');
    if (!a) return;
    const t = await inList(a.s, String(req.params.id));
    if (!t || (t.meta as any)?.proposal) return res.status(404).json({ error: 'That task is not on this list.' });
    const data: { completed?: boolean; text?: string } = {};
    if (typeof req.body?.completed === 'boolean') data.completed = req.body.completed;
    if (wantsText && cleanText(req.body.text, 500)) data.text = cleanText(req.body.text, 500);
    if (!Object.keys(data).length) return res.status(400).json({ error: 'Nothing to change.' });
    const saved = await prisma.todo.update({ where: { id: t.id }, data, select: { completed: true, text: true } });
    await touchGuest(a.s.token, a.sid, a.name, data.completed !== undefined ? (data.completed ? 'ticked a task' : 'unticked a task') : 'edited a task');
    res.json({ ok: true, ...saved });
  } catch (e) { next(e); }
});

// POST /api/public/list/:token/tasks { text, sessionId, name } -> "add": waits for the owner. "edit": lands straight in the list.
listPublicRoutes.post('/:token/tasks', guestWrite, async (req, res, next) => {
  try {
    const a = await guestAccess(req, res, 'add');
    if (!a) return;
    const text = cleanText(req.body?.text, 500);
    if (!text) return res.status(400).json({ error: 'Write the task first.' });
    const approve = a.s.perm === 'add';
    const todo = await prisma.todo.create({
      data: { userId: a.s.user_id, text, priority: 'medium', todoTags: [], recurrence: 'none', meta: { list: a.s.list_name, ...(approve ? { proposal: { by: a.name, from: `guest on ${a.s.list_name}` } } : {}) } },
      select: { id: true },
    });
    await touchGuest(a.s.token, a.sid, a.name, approve ? 'proposed a task' : 'added a task');
    res.status(201).json({ ok: true, id: todo.id, waiting: approve });
  } catch (e) { next(e); }
});

// POST /api/public/list/:token/tasks/:id/comments { body, sessionId, name }
listPublicRoutes.post('/:token/tasks/:id/comments', guestWrite, async (req, res, next) => {
  try {
    const a = await guestAccess(req, res, 'tick');
    if (!a) return;
    const body = cleanText(req.body?.body, 300);
    if (!body) return res.status(400).json({ error: 'Write a comment first.' });
    const t = await inList(a.s, String(req.params.id));
    if (!t || (t.meta as any)?.proposal) return res.status(404).json({ error: 'That task is not on this list.' });
    await prisma.$executeRawUnsafe('INSERT INTO task_list_comments (id, token, todo_id, author, body) VALUES ($1, $2, $3, $4, $5)', crypto.randomUUID(), a.s.token, t.id, a.name, body);
    await touchGuest(a.s.token, a.sid, a.name, 'commented');
    res.status(201).json({ ok: true });
  } catch (e) { next(e); }
});

export const listMarkdownHandler = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const md = await listMarkdown(String(req.params[0] || ''));
    if (md === null) return res.status(404).type('text/plain').send('This list is not shared any more.\n');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.type('text/markdown; charset=utf-8').send(md);
  } catch (e) { next(e); }
};

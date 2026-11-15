import crypto from 'crypto';
import prisma from '../db.js';
import { spaceAccess, can } from '../utils/access.js';
import { taskVisible, assigneesOf, columnOf } from '../utils/taskAccess.js';
import { notifyUsers, nameOf, spaceUserIds } from '../services/notify.js';

/*
 * Batch 4 and 5: talking about a task and seeing who is doing what.
 *   GET  /api/todos/:id/thread       comments and the activity trail of one task
 *   POST /api/todos/:id/comments     { body, mentions?: userId[] }
 *   POST /api/todos/:id/review       { to: userId[], note? }  asks people to review (moves the task to In review)
 *   GET  /api/workspaces/:spaceId/feed        what happened in the team lately
 *   GET  /api/workspaces/:spaceId/workload    each member's open / overdue / in progress / done this week, plus a weekly summary
 *   PUT  /api/workspaces/:spaceId/availability { status: 'available'|'busy'|'away', note? }
 */
const clean = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

export async function logActivity(todoId: string, spaceId: string, userId: string, kind: string, detail = '') {
  try { await prisma.$executeRaw`INSERT INTO task_activity (id, todo_id, space_id, user_id, kind, detail) VALUES (${crypto.randomUUID()}, ${todoId}, ${spaceId}, ${userId}, ${kind}, ${detail.slice(0, 200)})`; } catch { /* never blocks the action */ }
}

async function taskOf(req: any, res: any) {
  const userId = req.user.id as string;
  const rows = await prisma.$queryRaw<any[]>`SELECT id, text, user_id AS "userId", space_id AS "spaceId", assignee_id AS "assigneeId", is_completed AS completed, meta FROM todos WHERE id = ${req.params.id}`;
  const t = rows[0];
  if (!t || !t.spaceId || !(await spaceAccess(userId, t.spaceId)) || !taskVisible(t, userId)) { res.status(404).json({ error: 'Task not found.' }); return null; }
  return t;
}

export async function getThread(req: any, res: any, next: any) {
  try {
    const t = await taskOf(req, res); if (!t) return;
    const comments = await prisma.$queryRaw<any[]>`SELECT c.id, c.body, c.mentions, c.created_at AS "createdAt", c.user_id AS "userId", u.name FROM task_comments c LEFT JOIN users u ON u.id = c.user_id WHERE c.todo_id = ${t.id} ORDER BY c.created_at`;
    const activity = await prisma.$queryRaw<any[]>`SELECT a.id, a.kind, a.detail, a.created_at AS "createdAt", a.user_id AS "userId", u.name FROM task_activity a LEFT JOIN users u ON u.id = a.user_id WHERE a.todo_id = ${t.id} ORDER BY a.created_at`;
    res.json({ comments, activity });
  } catch (e) { next(e); }
}

export async function postComment(req: any, res: any, next: any) {
  try {
    const t = await taskOf(req, res); if (!t) return;
    const userId = req.user.id as string;
    const body = clean(req.body?.body, 2000);
    if (!body) return res.status(400).json({ error: 'Write something first.' });
    const members = await spaceUserIds(t.spaceId);
    const mentions: string[] = [...new Set<string>((Array.isArray(req.body?.mentions) ? req.body.mentions : []).filter((m: unknown): m is string => typeof m === 'string' && members.includes(m) && m !== userId))];
    const id = crypto.randomUUID();
    await prisma.$executeRaw`INSERT INTO task_comments (id, todo_id, space_id, user_id, body, mentions) VALUES (${id}, ${t.id}, ${t.spaceId}, ${userId}, ${body}, ${JSON.stringify(mentions)}::jsonb)`;
    await logActivity(t.id, t.spaceId, userId, 'comment', body.slice(0, 80));
    const from = await nameOf(userId);
    const watchers: string[] = Array.isArray(t.meta?.watchers) ? t.meta.watchers : [];
    const people = [...new Set([t.userId, ...assigneesOf(t), ...watchers])].filter((u) => u !== userId && members.includes(u) && !mentions.includes(u));
    if (mentions.length) await notifyUsers(req.app, mentions, { kind: 'mention', title: t.text, body, from, spaceId: t.spaceId, todoId: t.id });
    if (people.length) await notifyUsers(req.app, people, { kind: 'comment', title: t.text, body, from, spaceId: t.spaceId, todoId: t.id });
    req.app.get('io')?.to(t.spaceId).emit('todos_changed');
    res.status(201).json({ ok: true, id });
  } catch (e) { next(e); }
}

export async function requestReview(req: any, res: any, next: any) {
  try {
    const t = await taskOf(req, res); if (!t) return;
    const userId = req.user.id as string;
    const members = await spaceUserIds(t.spaceId);
    const to: string[] = [...new Set<string>((Array.isArray(req.body?.to) ? req.body.to : []).filter((m: unknown): m is string => typeof m === 'string' && members.includes(m) && m !== userId))];
    if (!to.length) return res.status(400).json({ error: 'Choose who should review it.' });
    const meta = { ...(t.meta || {}), status: 'review' };
    const watchers = new Set<string>(Array.isArray(meta.watchers) ? meta.watchers : []); to.forEach((u) => watchers.add(u)); meta.watchers = [...watchers];
    await prisma.$executeRaw`UPDATE todos SET meta = ${JSON.stringify(meta)}::jsonb, is_completed = false, updated_at = NOW() WHERE id = ${t.id}`;
    const note = clean(req.body?.note, 300);
    await logActivity(t.id, t.spaceId, userId, 'review', note || 'asked for a review');
    await notifyUsers(req.app, to, { kind: 'review', title: t.text, body: note, from: await nameOf(userId), spaceId: t.spaceId, todoId: t.id });
    req.app.get('io')?.to(userId).emit('todos_changed');
    res.json({ ok: true, to });
  } catch (e) { next(e); }
}

export async function getFeed(req: any, res: any, next: any) {
  try {
    const userId = req.user.id as string;
    const spaceId = req.params.spaceId as string;
    if (!(await spaceAccess(userId, spaceId))) return res.status(404).json({ error: 'Team not found.' });
    const rows = await prisma.$queryRaw<any[]>`
      SELECT a.id, a.kind, a.detail, a.created_at AS "createdAt", a.user_id AS "userId", u.name, t.id AS "todoId", t.text, t.user_id AS "ownerId", t.assignee_id AS "assigneeId", t.meta
      FROM task_activity a JOIN todos t ON t.id = a.todo_id LEFT JOIN users u ON u.id = a.user_id
      WHERE a.space_id = ${spaceId} ORDER BY a.created_at DESC LIMIT 120`;
    res.json({ items: rows.filter((r) => taskVisible({ userId: r.ownerId, spaceId, assigneeId: r.assigneeId, meta: r.meta }, userId)).slice(0, 60).map(({ ownerId, assigneeId, meta, ...r }) => r) });
  } catch (e) { next(e); }
}

export async function getWorkload(req: any, res: any, next: any) {
  try {
    const userId = req.user.id as string;
    const spaceId = req.params.spaceId as string;
    if (!(await spaceAccess(userId, spaceId))) return res.status(404).json({ error: 'Team not found.' });
    const people = await prisma.$queryRaw<any[]>`SELECT sm.user_id AS id, u.name, COALESCE(av.status, 'available') AS availability, av.note AS "availabilityNote" FROM space_members sm JOIN users u ON u.id = sm.user_id LEFT JOIN member_availability av ON av.space_id = sm.space_id AND av.user_id = sm.user_id WHERE sm.space_id = ${spaceId} ORDER BY u.name`;
    const todos = await prisma.$queryRaw<any[]>`SELECT id, text, user_id AS "userId", assignee_id AS "assigneeId", is_completed AS completed, deadline, meta, updated_at AS "updatedAt", created_at AS "createdAt" FROM todos WHERE space_id = ${spaceId}`;
    const mine = todos.filter((t) => taskVisible({ ...t, spaceId }, userId));
    const now = new Date(); const weekAgo = new Date(now.getTime() - 7 * 864e5);
    const endToday = new Date(now); endToday.setHours(23, 59, 59, 999);
    const rows = people.map((p) => {
      const own = mine.filter((t) => assigneesOf(t).includes(p.id));
      const open = own.filter((t) => !t.completed);
      return {
        ...p,
        open: open.length,
        doing: open.filter((t) => columnOf(t) === 'doing').length,
        review: open.filter((t) => columnOf(t) === 'review').length,
        overdue: open.filter((t) => t.deadline && new Date(t.deadline) < now).length,
        today: open.filter((t) => t.deadline && new Date(t.deadline) <= endToday).map((t) => ({ id: t.id, text: t.text, deadline: t.deadline })).slice(0, 8),
        doneThisWeek: own.filter((t) => t.completed && new Date(t.updatedAt) >= weekAgo).length,
      };
    });
    const unassigned = mine.filter((t) => !t.completed && assigneesOf(t).length === 0).length;
    const overdueList = mine.filter((t) => !t.completed && t.deadline && new Date(t.deadline) < now).sort((a, b) => +new Date(a.deadline) - +new Date(b.deadline)).slice(0, 20).map((t) => ({ id: t.id, text: t.text, deadline: t.deadline, assignees: assigneesOf(t) }));
    const summary = {
      doneThisWeek: mine.filter((t) => t.completed && new Date(t.updatedAt) >= weekAgo).length,
      createdThisWeek: mine.filter((t) => new Date(t.createdAt) >= weekAgo).length,
      open: mine.filter((t) => !t.completed).length,
      overdue: overdueList.length,
      unassigned,
    };
    res.json({ people: rows, overdue: overdueList, summary });
  } catch (e) { next(e); }
}

export async function setAvailability(req: any, res: any, next: any) {
  try {
    const userId = req.user.id as string;
    const spaceId = req.params.spaceId as string;
    if (!(await spaceAccess(userId, spaceId))) return res.status(404).json({ error: 'Team not found.' });
    const status = ['available', 'busy', 'away'].includes(req.body?.status) ? req.body.status : null;
    if (!status) return res.status(400).json({ error: 'Choose available, busy or away.' });
    const note = clean(req.body?.note, 80) || null;
    await prisma.$executeRaw`INSERT INTO member_availability (space_id, user_id, status, note) VALUES (${spaceId}, ${userId}, ${status}, ${note}) ON CONFLICT (space_id, user_id) DO UPDATE SET status = ${status}, note = ${note}, updated_at = NOW()`;
    res.json({ ok: true, status, note });
  } catch (e) { next(e); }
}

/* ---- Batch 6: templates, projects, handover ---- */
const BUILTIN_TEMPLATES = [
  { id: 'builtin:reel', name: 'Reel production', builtin: true, items: [['Write the script', 0], ['Shoot the B-roll', 2], ['Record the voice-over', 3], ['Edit the cuts', 5], ['Design the thumbnail', 5], ['Review and caption', 6], ['Publish', 7]].map(([text, day]) => ({ text, day })) },
  { id: 'builtin:weekly', name: 'Weekly review', builtin: true, items: [['Review last week', 0], ['Check what is overdue', 0], ['Plan the week', 0], ['Update the team', 1], ['Clean up the board', 1]].map(([text, day]) => ({ text, day })) },
  { id: 'builtin:onboarding', name: 'New teammate onboarding', builtin: true, items: [['Share the team guidelines', 0], ['Add them to the board', 0], ['Pair on a first task', 1], ['Check in after the first week', 7]].map(([text, day]) => ({ text, day })) },
];

export async function listTemplates(req: any, res: any, next: any) {
  try {
    const userId = req.user.id as string; const spaceId = req.params.spaceId as string;
    if (!(await spaceAccess(userId, spaceId))) return res.status(404).json({ error: 'Team not found.' });
    const mine = await prisma.$queryRaw<any[]>`SELECT id, name, items FROM task_templates WHERE space_id = ${spaceId} ORDER BY created_at DESC`;
    res.json({ templates: [...mine, ...BUILTIN_TEMPLATES] });
  } catch (e) { next(e); }
}

export async function saveTemplate(req: any, res: any, next: any) {
  try {
    const userId = req.user.id as string; const spaceId = req.params.spaceId as string;
    const acc = await spaceAccess(userId, spaceId);
    if (!acc || !can('space.write', acc.org, acc.role)) return res.status(acc ? 403 : 404).json({ error: acc ? 'You can read this team but not change it.' : 'Team not found.' });
    const name = clean(req.body?.name, 60);
    const items = (Array.isArray(req.body?.items) ? req.body.items : []).map((i: any) => ({ text: clean(i?.text, 200), day: Math.min(365, Math.max(0, Number.isFinite(+i?.day) ? Math.round(+i.day) : 0)) })).filter((i: any) => i.text).slice(0, 30);
    if (!name || !items.length) return res.status(400).json({ error: 'A template needs a name and at least one task.' });
    const id = crypto.randomUUID();
    await prisma.$executeRaw`INSERT INTO task_templates (id, space_id, name, items, created_by) VALUES (${id}, ${spaceId}, ${name}, ${JSON.stringify(items)}::jsonb, ${userId})`;
    res.status(201).json({ id, name, items });
  } catch (e) { next(e); }
}

export async function deleteTemplate(req: any, res: any, next: any) {
  try {
    const userId = req.user.id as string; const spaceId = req.params.spaceId as string;
    const acc = await spaceAccess(userId, spaceId);
    if (!acc || !can('space.write', acc.org, acc.role)) return res.status(acc ? 403 : 404).json({ error: acc ? 'You can read this team but not change it.' : 'Team not found.' });
    await prisma.$executeRaw`DELETE FROM task_templates WHERE id = ${req.params.id} AND space_id = ${spaceId}`;
    res.json({ ok: true });
  } catch (e) { next(e); }
}

export async function getProjects(req: any, res: any, next: any) {
  try {
    const userId = req.user.id as string; const spaceId = req.params.spaceId as string;
    if (!(await spaceAccess(userId, spaceId))) return res.status(404).json({ error: 'Team not found.' });
    const rows = await prisma.$queryRaw<any[]>`SELECT id, user_id AS "userId", assignee_id AS "assigneeId", is_completed AS completed, deadline, meta FROM todos WHERE space_id = ${spaceId}`;
    const map = new Map<string, { name: string; total: number; done: number; people: Set<string>; next: Date | null }>();
    for (const t of rows) {
      if (!taskVisible({ ...t, spaceId }, userId)) continue;
      const name = typeof t.meta?.list === 'string' && t.meta.list ? t.meta.list : 'Inbox';
      const p = map.get(name) || { name, total: 0, done: 0, people: new Set<string>(), next: null };
      p.total++; if (t.completed) p.done++;
      assigneesOf(t).forEach((a) => p.people.add(a));
      if (!t.completed && t.deadline && (!p.next || new Date(t.deadline) < p.next)) p.next = new Date(t.deadline);
      map.set(name, p);
    }
    res.json({ projects: [...map.values()].map((p) => ({ name: p.name, total: p.total, done: p.done, people: [...p.people], next: p.next })).sort((a, b) => (a.name === 'Inbox' ? 1 : b.name === 'Inbox' ? -1 : a.name.localeCompare(b.name))) });
  } catch (e) { next(e); }
}

/** GET /api/workspaces/:spaceId/people/:userId/open: the open tasks someone is on (for a lead preparing a handover). */
export async function openTasksOf(req: any, res: any, next: any) {
  try {
    const userId = req.user.id as string; const spaceId = req.params.spaceId as string;
    const acc = await spaceAccess(userId, spaceId);
    if (!acc || !can('space.manage', acc.org, acc.role)) return res.status(acc ? 403 : 404).json({ error: acc ? 'Only a team lead can hand work over.' : 'Team not found.' });
    const rows = await prisma.$queryRaw<any[]>`SELECT id, text, user_id AS "userId", assignee_id AS "assigneeId", deadline, meta FROM todos WHERE space_id = ${spaceId} AND is_completed = false ORDER BY deadline ASC NULLS LAST`;
    res.json({ tasks: rows.filter((t) => assigneesOf({ ...t, spaceId }).includes(req.params.userId)).map((t) => ({ id: t.id, text: t.text, deadline: t.deadline })) });
  } catch (e) { next(e); }
}

/** POST /api/workspaces/:spaceId/handover { from, to, ids?, note? } */
export async function handover(req: any, res: any, next: any) {
  try {
    const userId = req.user.id as string; const spaceId = req.params.spaceId as string;
    const acc = await spaceAccess(userId, spaceId);
    if (!acc || !can('space.manage', acc.org, acc.role)) return res.status(acc ? 403 : 404).json({ error: acc ? 'Only a team lead can hand work over.' : 'Team not found.' });
    const members = await spaceUserIds(spaceId);
    const from = String(req.body?.from || ''); const to = String(req.body?.to || '');
    if (!members.includes(from) || !members.includes(to) || from === to) return res.status(400).json({ error: 'Choose two different people in this team.' });
    const only: string[] | null = Array.isArray(req.body?.ids) ? req.body.ids.filter((x: unknown) => typeof x === 'string') : null;
    const rows = await prisma.$queryRaw<any[]>`SELECT id, text, user_id AS "userId", assignee_id AS "assigneeId", meta FROM todos WHERE space_id = ${spaceId} AND is_completed = false`;
    const mine = rows.filter((t) => assigneesOf({ ...t, spaceId }).includes(from) && (!only || only.includes(t.id)));
    for (const t of mine) {
      const list = [...new Set(assigneesOf({ ...t, spaceId }).map((a) => (a === from ? to : a)))];
      const meta = { ...(t.meta || {}), assignees: list };
      await prisma.$executeRaw`UPDATE todos SET meta = ${JSON.stringify(meta)}::jsonb, assignee_id = ${list[0]}, updated_at = NOW() WHERE id = ${t.id}`;
      await logActivity(t.id, spaceId, userId, 'handover', `${await nameOf(from)} to ${await nameOf(to)}`);
    }
    const note = clean(req.body?.note, 200);
    if (mine.length && to !== userId) await notifyUsers(req.app, [to], { kind: 'assigned', title: `${mine.length} task${mine.length === 1 ? '' : 's'} handed over to you`, body: note || mine.slice(0, 3).map((t) => t.text).join(', '), from: await nameOf(userId), spaceId, todoId: mine[0].id });
    req.app.get('io')?.to(userId).emit('todos_changed');
    res.json({ ok: true, moved: mine.length });
  } catch (e) { next(e); }
}


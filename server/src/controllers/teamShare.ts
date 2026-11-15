import prisma from '../db.js';
import { audit, can, spaceAccess } from '../utils/access.js';
import { isOffice } from '../utils/noteAccess.js';
import { syncDoneTag } from '../utils/doneTag.js';
import { notifyUsers, nameOf, spaceUserIds } from '../services/notify.js';

/*
 * Sharing a note with a team (mockups T01 to T07). The author's note stays in Personal; a copy lands in the team and is marked
 * meta.teamShare = { from, level, at }. Every member who shared something gets a folder under "Shared by members".
 * level 'view' means the other members read it, 'edit' means they can change it. A to-do list can go with it (tasks linked to the copy).
 */
type Level = 'view' | 'edit';

const clean = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');

/** POST /api/notes/:id/team-share  { spaceId, level?, tasks?: string[] } */
export async function shareToTeam(req: any, res: any, next: any) {
  try {
    if (req.user.viaToken) return res.status(403).json({ error: 'Not allowed with an access token.' });
    const userId = req.user.id as string;
    const spaceId = typeof req.body?.spaceId === 'string' ? req.body.spaceId : '';
    const level: Level = req.body?.level === 'view' ? 'view' : 'edit';
    const tasks: string[] = Array.isArray(req.body?.tasks) ? req.body.tasks.map((t: unknown) => clean(t, 200)).filter(Boolean).slice(0, 20) : [];
    if (!spaceId) return res.status(400).json({ error: 'Choose a team.' });
    const note = await prisma.note.findFirst({ where: { id: req.params.id, userId, isDeleted: false, spaceId: null } });
    if (!note) return res.status(404).json({ error: 'Note not found. Only your own Personal notes can be shared with a team.' });
    const acc = await spaceAccess(userId, spaceId);
    if (!acc) return res.status(404).json({ error: 'Team not found.' });
    if (await isOffice(spaceId)) return res.status(400).json({ error: 'Use the Office sharing settings for an Office.' });
    if (!can('space.write', acc.org, acc.role)) return res.status(403).json({ error: 'You can read that team but not add to it.' });

    const copy = await prisma.note.create({
      data: { userId, spaceId, title: note.title, content: note.content, category: note.category, meta: { teamShare: { from: note.id, level, at: new Date().toISOString() } } },
      select: { id: true, title: true },
    });
    for (const text of tasks) await prisma.todo.create({ data: { userId, spaceId, text, noteId: copy.id, todoTags: [] } });

    const team = (await prisma.$queryRaw<{ name: string }[]>`SELECT name FROM spaces WHERE id = ${spaceId}`)[0]?.name ?? 'the team';
    const others = (await spaceUserIds(spaceId)).filter((u) => u !== userId);
    if (others.length) await notifyUsers(req.app, others, { kind: 'note_shared', title: copy.title || 'Untitled', body: `Shared with ${team}${tasks.length ? ` with ${tasks.length} task${tasks.length === 1 ? '' : 's'}` : ''}`, from: await nameOf(userId), spaceId, noteId: copy.id });
    await audit(acc.org.orgId, userId, 'note.shared_to_team', copy.id, { level, tasks: tasks.length });
    const io = req.app.get('io');
    if (io) { io.to(userId).emit('notes_changed'); if (tasks.length) io.to(userId).emit('todos_changed'); }
    res.status(201).json({ ok: true, note: copy, tasks: tasks.length, level });
  } catch (error) { next(error); }
}

type FolderRow = { userId: string; name: string; notes: number; withTodos: number; done: number; lastAt: Date; titles: string[] };

/** GET /api/workspaces/:spaceId/shared : one folder per member who shared a note here. */
export async function listFolders(req: any, res: any, next: any) {
  try {
    const spaceId = String(req.params.spaceId);
    const acc = await spaceAccess(req.user.id, spaceId);
    if (!acc || !can('space.read', acc.org, acc.role)) return res.status(404).json({ error: 'Team not found.' });
    const rows = await prisma.$queryRaw<FolderRow[]>`
      SELECT n.user_id AS "userId", u.name, u.avatar, count(*)::int AS notes,
             count(*) FILTER (WHERE d.total > 0)::int AS "withTodos",
             count(*) FILTER (WHERE d.total > 0 AND d.open = 0)::int AS done,
             max(n.created_at) AS "lastAt",
             (array_agg(n.title ORDER BY n.created_at DESC))[1:2] AS titles
      FROM notes n
      JOIN users u ON u.id = n.user_id
      LEFT JOIN LATERAL (SELECT count(*)::int AS total, count(*) FILTER (WHERE NOT t.is_completed)::int AS open FROM todos t WHERE t.linked_note_id = n.id) d ON true
      WHERE n.space_id = ${spaceId} AND NOT n.is_deleted AND NOT n.is_archived AND n.meta -> 'teamShare' IS NOT NULL
      GROUP BY n.user_id, u.name, u.avatar ORDER BY max(n.created_at) DESC`;
    res.json({ me: req.user.id, members: rows, total: rows.reduce((s, r) => s + r.notes, 0), withTodos: rows.reduce((s, r) => s + r.withTodos, 0), done: rows.reduce((s, r) => s + r.done, 0) });
  } catch (error) { next(error); }
}

type NoteRow = { id: string; title: string; preview: string; createdAt: Date; updatedAt: Date; level: Level; total: number; open: number };

/** GET /api/workspaces/:spaceId/shared/:userId : what one member shared, with the progress of each to-do list. */
export async function memberFolder(req: any, res: any, next: any) {
  try {
    const spaceId = String(req.params.spaceId);
    const acc = await spaceAccess(req.user.id, spaceId);
    if (!acc || !can('space.read', acc.org, acc.role)) return res.status(404).json({ error: 'Team not found.' });
    const who = String(req.params.userId);
    const person = (await prisma.$queryRaw<{ id: string; name: string; avatar: string | null }[]>`SELECT u.id, u.name, u.avatar FROM users u JOIN space_members sm ON sm.user_id = u.id AND sm.space_id = ${spaceId} WHERE u.id = ${who}`)[0];
    const role = (await prisma.$queryRaw<{ role: string }[]>`SELECT role FROM space_members WHERE space_id = ${spaceId} AND user_id = ${who}`)[0]?.role ?? 'member';
    const rows = await prisma.$queryRaw<NoteRow[]>`
      SELECT n.id, n.title, left(regexp_replace(n.content, '[#*>\`\\[\\]!()_{}"]|\\n', ' ', 'g'), 120) AS preview,
             n.created_at AS "createdAt", n.updated_at AS "updatedAt", COALESCE(n.meta -> 'teamShare' ->> 'level', 'edit') AS level,
             d.total, d.open
      FROM notes n
      LEFT JOIN LATERAL (SELECT count(*)::int AS total, count(*) FILTER (WHERE NOT t.is_completed)::int AS open FROM todos t WHERE t.linked_note_id = n.id) d ON true
      WHERE n.space_id = ${spaceId} AND n.user_id = ${who} AND NOT n.is_deleted AND NOT n.is_archived AND n.meta -> 'teamShare' IS NOT NULL
      ORDER BY n.created_at DESC LIMIT 200`;
    const notes = rows.map((r) => ({ id: r.id, title: r.title, preview: (r.preview || '').replace(/\s+/g, ' ').trim(), createdAt: r.createdAt, level: r.level, todoTotal: r.total || 0, todoDone: (r.total || 0) - (r.open || 0), done: (r.total || 0) > 0 && !r.open }));
    res.json({ person: person ? { ...person, role } : { id: who, name: 'Someone', role }, notes });
  } catch (error) { next(error); }
}

export { syncDoneTag };

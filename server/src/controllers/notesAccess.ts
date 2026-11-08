import prisma from '../db.js';
import { audit, can, spaceAccess } from '../utils/access.js';
import { isOffice, noteLevel, type Level } from '../utils/noteAccess.js';
import { notifyUsers, nameOf, spaceUserIds } from '../services/notify.js';

/* Who can see a note written in an Office (mockups WsE01 to WsE03). Rules and tables: utils/noteAccess.ts, 040_office_private_notes.sql. */
const LEVELS: Level[] = ['view', 'edit'];

/** Loads the note and checks the caller may know it exists. Sends the error itself and returns null when not. */
async function load(req: any, res: any) {
  const id = String(req.params.id);
  const rows = await prisma.$queryRaw<{ id: string; user_id: string; space_id: string | null; everyone: Level | null }[]>`SELECT id, user_id, space_id, office_everyone AS everyone FROM notes WHERE id = ${id}`;
  const n = rows[0];
  if (!n || !n.space_id) { res.status(404).json({ error: 'Note not found.' }); return null; }
  const acc = await spaceAccess(req.user.id, n.space_id);
  if (!acc) { res.status(404).json({ error: 'Note not found.' }); return null; }
  if (!(await isOffice(n.space_id))) { res.status(400).json({ error: 'Only notes in an Office have access settings.', code: 'not_office' }); return null; }
  const lv = await noteLevel(req.user.id, id, n.space_id);
  if (lv.level === null) {
    res.status(403).json({ error: 'This note is private. Ask the author to share it with you.', code: 'no_access', owner: lv.ownerId ? { id: lv.ownerId, name: lv.ownerName ?? 'Someone' } : null });
    return null;
  }
  return { id, spaceId: n.space_id, ownerId: n.user_id, acc, lv };
}

async function shape(ctx: { id: string; spaceId: string; ownerId: string; lv: { level: any } }, userId: string) {
  const [owner, everyoneRow, people, candidates] = await Promise.all([
    prisma.$queryRaw<{ id: string; name: string; email: string }[]>`SELECT id, name, email FROM users WHERE id = ${ctx.ownerId}`,
    prisma.$queryRaw<{ everyone: Level | null }[]>`SELECT office_everyone AS everyone FROM notes WHERE id = ${ctx.id}`,
    ctx.lv.level === 'owner'
      ? prisma.$queryRaw<{ userId: string; name: string; email: string; level: Level }[]>`SELECT a.user_id AS "userId", u.name, u.email, a.level FROM note_access a JOIN users u ON u.id = a.user_id WHERE a.note_id = ${ctx.id} ORDER BY a.created_at`
      : Promise.resolve([] as any[]),
    ctx.lv.level === 'owner'
      ? prisma.$queryRaw<{ userId: string; name: string; email: string }[]>`
          SELECT u.id AS "userId", u.name, u.email FROM space_members sm JOIN users u ON u.id = sm.user_id
          WHERE sm.space_id = ${ctx.spaceId} AND sm.user_id <> ${ctx.ownerId} AND NOT EXISTS (SELECT 1 FROM note_access a WHERE a.note_id = ${ctx.id} AND a.user_id = sm.user_id) ORDER BY u.name`
      : Promise.resolve([] as any[]),
  ]);
  void userId;
  return {
    noteId: ctx.id,
    owner: { id: owner[0]?.id ?? ctx.ownerId, name: owner[0]?.name ?? 'Someone', email: owner[0]?.email ?? null },
    level: ctx.lv.level as 'owner' | Level,
    everyone: (everyoneRow[0]?.everyone ?? null) as Level | null,
    people,
    candidates,
  };
}

export async function getAccess(req: any, res: any, next: any) {
  try {
    const ctx = await load(req, res); if (!ctx) return;
    res.json(await shape(ctx, req.user.id));
  } catch (error) { next(error); }
}

/** Author only. Body: { everyone?: null | 'view' | 'edit', people?: [{ userId, level }] } (people replaces the list when sent). */
export async function setAccess(req: any, res: any, next: any) {
  try {
    const ctx = await load(req, res); if (!ctx) return;
    if (ctx.lv.level !== 'owner') return res.status(403).json({ error: 'Only the author can change who sees this note.', code: 'owner_only', owner: { id: ctx.ownerId, name: ctx.lv.ownerName ?? 'Someone' } });
    if (!can('space.write', ctx.acc.org, ctx.acc.role)) return res.status(403).json({ error: 'You can read this space but not change it.' });
    const body = req.body ?? {};
    let everyone: Level | null | undefined;
    if ('everyone' in body) {
      if (body.everyone !== null && !LEVELS.includes(body.everyone)) return res.status(400).json({ error: 'everyone must be null, "view" or "edit".' });
      everyone = body.everyone;
    }
    let wanted: { userId: string; level: Level }[] | undefined;
    if ('people' in body) {
      if (!Array.isArray(body.people)) return res.status(400).json({ error: 'people must be a list.' });
      const seen = new Map<string, Level>();
      for (const p of body.people) {
        if (!p || typeof p.userId !== 'string' || !LEVELS.includes(p.level)) return res.status(400).json({ error: 'Each person needs a userId and a level of "view" or "edit".' });
        if (p.userId === ctx.ownerId) continue;
        seen.set(p.userId, p.level);
      }
      const members = new Set(await spaceUserIds(ctx.spaceId));
      for (const uid of seen.keys()) if (!members.has(uid)) return res.status(400).json({ error: 'You can only share with people in this Office.', code: 'not_member' });
      wanted = [...seen].map(([userId, level]) => ({ userId, level }));
    }
    const before = await prisma.$queryRaw<{ user_id: string; level: Level }[]>`SELECT user_id, level FROM note_access WHERE note_id = ${ctx.id}`;
    const beforeEveryone = (await prisma.$queryRaw<{ e: Level | null }[]>`SELECT office_everyone AS e FROM notes WHERE id = ${ctx.id}`)[0]?.e ?? null;
    const ops: any[] = [];
    if (everyone !== undefined) ops.push(prisma.$executeRaw`UPDATE notes SET office_everyone = ${everyone} WHERE id = ${ctx.id}`);
    const added: string[] = [];
    const removed: string[] = [];
    if (wanted) {
      const was = new Map(before.map((b) => [b.user_id, b.level]));
      for (const w of wanted) if (was.get(w.userId) !== w.level) added.push(w.userId);
      for (const b of before) if (!wanted.some((w) => w.userId === b.user_id)) removed.push(b.user_id);
      ops.push(prisma.$executeRaw`DELETE FROM note_access WHERE note_id = ${ctx.id} AND NOT (user_id = ANY(${wanted.map((w) => w.userId)}::text[]))`);
      for (const w of wanted) ops.push(prisma.$executeRaw`INSERT INTO note_access (note_id, user_id, level, granted_by) VALUES (${ctx.id}, ${w.userId}, ${w.level}, ${req.user.id}) ON CONFLICT (note_id, user_id) DO UPDATE SET level = EXCLUDED.level, granted_by = EXCLUDED.granted_by`);
    }
    if (ops.length) await prisma.$transaction(ops);

    // tell the people who gained access, once; then keep a record in the organization's audit log (never the note text)
    const title = (await prisma.note.findFirst({ where: { id: ctx.id, spaceId: { not: null } }, select: { title: true } }))?.title || 'Untitled';
    const me = await nameOf(req.user.id);
    const tell: string[] = [...added];
    if (everyone && everyone !== beforeEveryone) tell.push(...(await spaceUserIds(ctx.spaceId)).filter((u) => u !== req.user.id));
    if (tell.length) await notifyUsers(req.app, [...new Set(tell)], { kind: 'note_shared', title, body: everyone && everyone !== beforeEveryone ? `Shared with everyone in the Office (${everyone === 'edit' ? 'can edit' : 'can read'})` : 'Shared with you', from: me, spaceId: ctx.spaceId, noteId: ctx.id });
    if (added.length || removed.length || (everyone !== undefined && everyone !== beforeEveryone)) {
      const org = (await prisma.$queryRaw<{ org_id: string }[]>`SELECT org_id FROM spaces WHERE id = ${ctx.spaceId}`)[0]?.org_id;
      if (org) await audit(org, req.user.id, 'note.access_changed', ctx.id, { everyone: everyone === undefined ? beforeEveryone : everyone, added: added.length, removed: removed.length });
    }
    req.app.get('io')?.to(req.user.id).emit('notes_changed');
    res.json(await shape(ctx, req.user.id));
  } catch (error) { next(error); }
}

/** The author removes one person, or any person removes themselves from a note that was shared with them. */
export async function removeAccess(req: any, res: any, next: any) {
  try {
    const ctx = await load(req, res); if (!ctx) return;
    const target = String(req.params.userId);
    const self = target === req.user.id;
    if (ctx.lv.level !== 'owner' && !self) return res.status(403).json({ error: 'Only the author can remove someone.', code: 'owner_only' });
    const n = await prisma.$executeRaw`DELETE FROM note_access WHERE note_id = ${ctx.id} AND user_id = ${target}`;
    if (!n) return res.status(404).json({ error: 'That person was not given access.' });
    const org = (await prisma.$queryRaw<{ org_id: string }[]>`SELECT org_id FROM spaces WHERE id = ${ctx.spaceId}`)[0]?.org_id;
    if (org) await audit(org, req.user.id, 'note.access_changed', ctx.id, { removed: 1 });
    res.json({ ok: true });
  } catch (error) { next(error); }
}

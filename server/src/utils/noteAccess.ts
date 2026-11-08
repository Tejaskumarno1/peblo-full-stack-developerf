import prisma from '../db.js';

/*
 * Private notes in an Office (mockups WsE01 to WsE03). A note written in an Office is private to its author until the author
 * opens it up: to everyone in the Office (notes.office_everyone = 'view' | 'edit') and/or to named people (note_access rows).
 * Teams are not affected. Tables: 040_office_private_notes.sql. Raw SQL, because Prisma's schema does not list these columns.
 */
export type Level = 'view' | 'edit';
export type Effective = 'owner' | Level | null;

export async function isOffice(spaceId: string): Promise<boolean> {
  const r = await prisma.$queryRaw<{ kind: string }[]>`SELECT kind FROM spaces WHERE id = ${spaceId}`;
  return r[0]?.kind === 'office';
}

/** Notes of this Office the person may not read (`read`) or may not change (`write`). */
export async function hiddenNoteIds(userId: string, spaceId: string, need: 'read' | 'write'): Promise<string[]> {
  const rows = need === 'read'
    ? await prisma.$queryRaw<{ id: string }[]>`
        SELECT n.id FROM notes n WHERE n.space_id = ${spaceId} AND n.user_id <> ${userId} AND n.office_everyone IS NULL
          AND NOT EXISTS (SELECT 1 FROM note_access a WHERE a.note_id = n.id AND a.user_id = ${userId})`
    : await prisma.$queryRaw<{ id: string }[]>`
        SELECT n.id FROM notes n WHERE n.space_id = ${spaceId} AND n.user_id <> ${userId} AND COALESCE(n.office_everyone, '') <> 'edit'
          AND NOT EXISTS (SELECT 1 FROM note_access a WHERE a.note_id = n.id AND a.user_id = ${userId} AND a.level = 'edit')`;
  return rows.map((r) => r.id);
}

/** What one person may do with one note of an Office. exists=false when the note is not in that space. */
export async function noteLevel(userId: string, noteId: string, spaceId: string): Promise<{ exists: boolean; level: Effective; ownerId: string | null; ownerName: string | null }> {
  const rows = await prisma.$queryRaw<{ user_id: string; everyone: Level | null; grant: Level | null; owner_name: string | null }[]>`
    SELECT n.user_id, n.office_everyone AS everyone, (SELECT a.level FROM note_access a WHERE a.note_id = n.id AND a.user_id = ${userId}) AS grant,
           (SELECT u.name FROM users u WHERE u.id = n.user_id) AS owner_name
    FROM notes n WHERE n.id = ${noteId} AND n.space_id = ${spaceId}`;
  const r = rows[0];
  if (!r) return { exists: false, level: null, ownerId: null, ownerName: null };
  const level: Effective = r.user_id === userId ? 'owner' : (r.everyone === 'edit' || r.grant === 'edit') ? 'edit' : (r.everyone === 'view' || r.grant === 'view') ? 'view' : null;
  return { exists: true, level, ownerId: r.user_id, ownerName: r.owner_name };
}

/** Adds owner / access / everyone / sharedCount to notes read from an Office. Notes outside an Office are left as they are. */
export async function decorateNotes(userId: string, spaceId: string | null | undefined, notes: any[]): Promise<void> {
  if (!spaceId || !notes.length || !(await isOffice(spaceId))) return;
  const ids = notes.map((n) => n.id);
  const rows = await prisma.$queryRaw<{ id: string; everyone: Level | null; grant: Level | null; shared: number; owner_name: string | null }[]>`
    SELECT n.id, n.office_everyone AS everyone, (SELECT a.level FROM note_access a WHERE a.note_id = n.id AND a.user_id = ${userId}) AS grant,
           (SELECT count(*)::int FROM note_access a WHERE a.note_id = n.id) AS shared, (SELECT u.name FROM users u WHERE u.id = n.user_id) AS owner_name
    FROM notes n WHERE n.id = ANY(${ids}::text[])`;
  const by = new Map(rows.map((r) => [r.id, r]));
  for (const n of notes) {
    const r = by.get(n.id);
    if (!r) continue;
    const mine = n.userId === userId;
    n.owner = { id: n.userId, name: r.owner_name ?? 'Someone' };
    n.everyone = r.everyone ?? null;
    n.sharedCount = r.shared;
    n.access = mine ? 'owner' : (r.everyone === 'edit' || r.grant === 'edit') ? 'edit' : 'view';
  }
}

/** The where-fragment that hides an Office's private notes from a lookup that did not come through noteScope (task links). */
export async function seeable(userId: string, own: { userId: string } | { spaceId: string }): Promise<{ AND?: any[] }> {
  if (!('spaceId' in own) || !(await isOffice(own.spaceId))) return {};
  const hidden = await hiddenNoteIds(userId, own.spaceId, 'read');
  return hidden.length ? { AND: [{ id: { notIn: hidden } }] } : {};
}

import prisma from '../db.js';
import { can, spaceAccess } from './access.js';

/*
 * Notes of a Team space (audit R26, R27, R33). The notes list and GET /notes/:id add, for every note read from a Team:
 *   team: true            marks it as a Team note (the client then skips the Office-only "Only you" chip)
 *   owner: { id, name }   who wrote it
 *   level: 'view' | 'edit' | null   the share level the author gave it (meta.teamShare.level); null when it was not shared with the team
 *   access: 'owner' | 'edit' | 'view'   what the signed-in person may do in the editor: the author edits; a viewer, or a note shared "can view", is read only
 *   canManage: boolean    may trash, archive, move, pin, duplicate and share it: the author or a team lead (same rule as noteScope 'manage')
 *   lastEditedBy: string  name of whoever saved the latest version (from the version history; the author's name when there is none yet)
 * Office notes are decorated by decorateNotes in noteAccess.ts, which calls this for everything that is not an Office.
 */
export async function decorateTeamNotes(userId: string, spaceId: string, notes: any[]): Promise<void> {
  const acc = await spaceAccess(userId, spaceId);
  if (!acc) return;
  const ids = notes.map((n) => n.id);
  const rows = await prisma.$queryRaw<{ id: string; uid: string; owner_name: string | null }[]>`
    SELECT n.id, n.user_id AS uid, (SELECT u.name FROM users u WHERE u.id = n.user_id) AS owner_name FROM notes n WHERE n.id = ANY(${ids}::text[]) AND n.space_id = ${spaceId}`;
  const editors = await prisma.$queryRaw<{ note_id: string; saved_by: string }[]>`
    SELECT DISTINCT ON (note_id) note_id, saved_by FROM note_backups WHERE note_id = ANY(${ids}::text[]) AND saved_by IS NOT NULL ORDER BY note_id, created_at DESC`;
  const by = new Map(rows.map((r) => [r.id, r]));
  const last = new Map(editors.map((e) => [e.note_id, e.saved_by]));
  const writer = can('space.write', acc.org, acc.role);
  for (const n of notes) {
    const r = by.get(n.id);
    if (!r) continue;
    const mine = r.uid === userId;
    const level = n.meta?.teamShare?.level === 'view' ? 'view' : n.meta?.teamShare?.level === 'edit' ? 'edit' : null;
    n.team = true;
    n.owner = { id: r.uid, name: r.owner_name ?? 'Someone' };
    n.level = level;
    n.access = mine ? 'owner' : (!writer || level === 'view') ? 'view' : 'edit';
    n.canManage = mine || acc.role === 'lead';
    n.lastEditedBy = last.get(n.id) ?? n.owner.name;
  }
}

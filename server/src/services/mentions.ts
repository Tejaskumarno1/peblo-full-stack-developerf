import prisma from '../db.js';
import { spaceMembers } from '../utils/access.js';
import { noteLevel, isOffice } from '../utils/noteAccess.js';
import { notifyUsers, nameOf } from './notify.js';

/*
 * @mentions in notes. The editor writes a mention as a markdown link: [@Name](peblo-user:<userId>).
 * When a note is saved, the people who are in the new text but were not in the previous text get ONE notification,
 * if they are in the note's team or Office and can read the note. Never for yourself, never more than once per note per 24 hours
 * (table note_mentions, 052_note_mentions.sql). The notification holds the note's title only, never any of its text.
 */
export const MENTION_RE = /\]\(peblo-user:([A-Za-z0-9_-]{8,64})\)/g;
export const mentionedIds = (text: string | null | undefined): string[] => [...new Set([...String(text ?? '').matchAll(MENTION_RE)].map((m) => m[1]))].slice(0, 50);

/** Tell the people newly mentioned in `next` (compared with `prev`). Best effort: a failure here never fails the save. */
export async function notifyMentions(app: any, actorId: string, noteId: string, prev: string | null | undefined, next: string | null | undefined): Promise<number> {
  try {
    const before = new Set(mentionedIds(prev));
    const added = mentionedIds(next).filter((id) => id !== actorId && !before.has(id));
    if (!added.length) return 0;
    const note = await prisma.note.findFirst({ where: { id: noteId, isDeleted: false }, select: { id: true, title: true, spaceId: true } });
    if (!note?.spaceId) return 0; // Personal notes have nobody to mention
    const inSpace = new Set(await spaceMembers(note.spaceId));
    let who = added.filter((id) => inSpace.has(id));
    if (who.length && (await isOffice(note.spaceId))) {
      const keep: string[] = [];
      for (const id of who) if ((await noteLevel(id, noteId, note.spaceId)).level) keep.push(id); // an Office note is private until its author opens it up
      who = keep;
    }
    if (!who.length) return 0;
    // one claim per person per note per 24 hours: the row is inserted, or refreshed only when the last notice is older than a day
    const fresh = await prisma.$queryRaw<{ user_id: string }[]>`
      INSERT INTO note_mentions (note_id, user_id, notified_at) SELECT ${noteId}, x, now() FROM unnest(${who}::text[]) AS x
      ON CONFLICT (note_id, user_id) DO UPDATE SET notified_at = now() WHERE note_mentions.notified_at < now() - interval '24 hours'
      RETURNING user_id`;
    if (!fresh.length) return 0;
    const from = await nameOf(actorId);
    await notifyUsers(app, fresh.map((r) => r.user_id), { kind: 'note_mention', title: `${from} mentioned you in a note`, body: (note.title || 'Untitled').slice(0, 200), from, spaceId: note.spaceId, noteId });
    return fresh.length;
  } catch { return 0; }
}

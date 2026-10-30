import crypto from 'crypto';
import prisma from '../db.js';
import { decField, encField } from '../dataCrypto.js';

/*
 * Comments and suggestions on a note. A comment points at a quoted piece of the note's text (not a position), so it
 * survives edits around it. A suggestion carries the replacement text; accepting it is done in the editor, which then
 * marks the suggestion accepted here. People on an editing share link can write comments too; the owner is told.
 */

export type Author = { name: string; color: string; userId?: string | null; session?: string | null };
export type CommentRow = {
  id: string; parentId: string | null; kind: 'comment' | 'suggestion'; status: 'open' | 'resolved' | 'accepted' | 'rejected';
  author: { name: string; color: string; owner: boolean; self: boolean };
  body: string; quote: string | null; replacement: string | null; mentions: string[]; createdAt: string;
};

const COLOR = /^#[0-9a-fA-F]{6}$/;
const clean = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\u0000/g, '').trim().slice(0, max) : '');

export async function listComments(noteId: string, me: { userId?: string | null; session?: string | null }): Promise<CommentRow[]> {
  const rows = await prisma.$queryRawUnsafe<any[]>(
    'SELECT id, parent_id, kind, author_name, author_color, author_user_id, author_session, body, quote, replacement, mentions, status, created_at FROM note_comments WHERE note_id = $1 ORDER BY created_at ASC LIMIT 500',
    noteId,
  );
  return rows.map((r) => ({
    id: r.id,
    parentId: r.parent_id,
    kind: r.kind === 'suggestion' ? 'suggestion' : 'comment',
    status: ['resolved', 'accepted', 'rejected'].includes(r.status) ? r.status : 'open',
    author: {
      name: r.author_name,
      color: r.author_color || '#2563eb',
      owner: !!r.author_user_id,
      self: (!!me.userId && r.author_user_id === me.userId) || (!!me.session && r.author_session === me.session),
    },
    body: decField('note_comments', 'body', r.id, r.body) ?? '',
    quote: decField('note_comments', 'quote', r.id, r.quote),
    replacement: decField('note_comments', 'replacement', r.id, r.replacement),
    mentions: Array.isArray(r.mentions) ? r.mentions.filter((m: unknown) => typeof m === 'string') : [],
    createdAt: new Date(r.created_at).toISOString(),
  }));
}

export async function addComment(noteId: string, author: Author, input: any): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const kind = input?.kind === 'suggestion' ? 'suggestion' : 'comment';
  const body = clean(input?.body, 2000);
  const quote = clean(input?.quote, 500) || null;
  const replacement = kind === 'suggestion' ? clean(input?.replacement, 2000) : null;
  if (kind === 'comment' && !body) return { ok: false, error: 'Write a comment first.' };
  if (kind === 'suggestion' && (!quote || replacement === null)) return { ok: false, error: 'Select some text and write what it should say instead.' };
  let parentId: string | null = null;
  if (typeof input?.parentId === 'string' && input.parentId) {
    const p = await prisma.$queryRawUnsafe<{ id: string }[]>('SELECT id FROM note_comments WHERE id = $1 AND note_id = $2 AND parent_id IS NULL', input.parentId, noteId);
    if (!p.length) return { ok: false, error: 'That comment is gone.' };
    parentId = p[0].id;
  }
  const mentions = Array.isArray(input?.mentions) ? [...new Set((input.mentions as unknown[]).map((m) => clean(m, 40)).filter(Boolean))].slice(0, 10) : [];
  const count = await prisma.$queryRawUnsafe<{ n: number }[]>('SELECT COUNT(*)::int AS n FROM note_comments WHERE note_id = $1', noteId);
  if ((count[0]?.n ?? 0) >= 500) return { ok: false, error: 'This note has too many comments.' };
  const id = crypto.randomUUID();
  const color = COLOR.test(author.color) ? author.color : '#2563eb';
  await prisma.$executeRawUnsafe(
    'INSERT INTO note_comments (id, note_id, parent_id, kind, author_name, author_color, author_user_id, author_session, body, quote, replacement, mentions) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)',
    id, noteId, parentId, kind, clean(author.name, 40) || 'Someone', color, author.userId ?? null, author.session ?? null,
    encField('note_comments', 'body', id, body), encField('note_comments', 'quote', id, quote), encField('note_comments', 'replacement', id, replacement), JSON.stringify(mentions),
  );
  return { ok: true, id };
}

export async function setStatus(noteId: string, id: string, status: string): Promise<boolean> {
  if (!['open', 'resolved', 'accepted', 'rejected'].includes(status)) return false;
  const n = await prisma.$executeRawUnsafe('UPDATE note_comments SET status = $1 WHERE note_id = $3 AND (id = $2 OR parent_id = $2)', status, id, noteId);
  return n > 0;
}

export async function removeComment(noteId: string, id: string, who: { userId?: string | null; session?: string | null; owner: boolean }): Promise<boolean> {
  const rows = await prisma.$queryRawUnsafe<{ author_user_id: string | null; author_session: string | null }[]>('SELECT author_user_id, author_session FROM note_comments WHERE id = $1 AND note_id = $2', id, noteId);
  const r = rows[0];
  if (!r) return false;
  const mine = (!!who.userId && r.author_user_id === who.userId) || (!!who.session && r.author_session === who.session);
  if (!who.owner && !mine) return false; // the note's owner may remove any comment; others only their own
  await prisma.$executeRawUnsafe('DELETE FROM note_comments WHERE (id = $1 OR parent_id = $1) AND note_id = $2', id, noteId);
  return true;
}

/** Tell the note's owner something happened (a stored notification plus a live nudge to their open windows). */
export async function notifyOwner(app: any, ownerId: string, n: { kind: string; noteId: string; title: string; body?: string; from: string }) {
  const nid = crypto.randomUUID();
  await prisma.$executeRawUnsafe(
    'INSERT INTO user_notifications (id, user_id, kind, note_id, title, body, from_name) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    nid, ownerId, n.kind, n.noteId, n.title.slice(0, 200), encField('user_notifications', 'body', nid, (n.body || '').slice(0, 300)), n.from.slice(0, 40),
  );
  // keep the list short
  await prisma.$executeRawUnsafe('DELETE FROM user_notifications WHERE user_id = $1 AND id NOT IN (SELECT id FROM user_notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 100)', ownerId);
  try { app?.get?.('io')?.to(ownerId).emit('notifications_changed'); } catch { /* live nudge is best-effort */ }
}

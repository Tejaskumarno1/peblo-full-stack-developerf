import prisma from '../db.js';
import { audit, can, spaceAccess } from './access.js';
import { isOffice, noteLevel, teamViewOnly } from './noteAccess.js';
import { policyOfSpace } from './orgPolicy.js';

import { ANY_SPACE } from '../personalGuard.js';
/*
 * Who may make a public link, and the revoking of links when a policy or a team switch turns them off.
 * Kept out of routes/share.ts so that file only calls three small functions from here.
 */

export const NOTE_SHARE_SELECT = { id: true, userId: true, spaceId: true, shareToken: true, shareEdit: true, shareExpiresAt: true } as const;

/**
 * The note, when this person may manage its public link; otherwise null.
 * A Personal note: its author. A note in a Team or the Office: a person who can write in that space (a viewer cannot), and in the Office
 * only the author or someone the author let edit; in a Team a note shared "can view" is the author's to share.
 */
export async function shareableNote(userId: string, id: string) {
  const n = await prisma.note.findFirst({ where: { id, isDeleted: false, ...ANY_SPACE }, select: NOTE_SHARE_SELECT });
  if (!n) return null;
  if (!n.spaceId) return n.userId === userId ? n : null;
  const acc = await spaceAccess(userId, n.spaceId);
  if (!acc || !can('space.write', acc.org, acc.role)) return null;
  if (await isOffice(n.spaceId)) {
    const lv = await noteLevel(userId, id, n.spaceId);
    return lv.level === 'owner' || lv.level === 'edit' ? n : null;
  }
  if (n.userId !== userId && (await teamViewOnly(userId, id, n.spaceId))) return null;
  return n;
}

export const TODO_SHARE_SELECT = { id: true, userId: true, spaceId: true, shareToken: true, shareEdit: true, shareExpiresAt: true, shareNote: true } as const;

/**
 * The task, when this person may manage its public link; otherwise null.
 * A Personal task: its author. A task in a Team or the Office: anyone who can write in that space, so a task another
 * member created or reassigned can still be shared (it used to answer "Not found" unless you were its creator).
 */
export async function shareableTodo(userId: string, id: string) {
  const t = await prisma.todo.findFirst({ where: { id, ...ANY_SPACE }, select: TODO_SHARE_SELECT });
  if (!t) return null;
  if (!t.spaceId) return t.userId === userId ? t : null;
  const acc = await spaceAccess(userId, t.spaceId);
  if (!acc || !can('space.write', acc.org, acc.role)) return null;
  return t;
}

export type ShareBlock = { code: 'org_policy' | 'team_off'; reason: string };

/** Why a new public link cannot be made for something in this space (null when it can). Personal items have no space and are never blocked. */
export async function shareBlockReason(spaceId: string | null | undefined): Promise<ShareBlock | null> {
  if (!spaceId) return null;
  const pol = await policyOfSpace(spaceId);
  if (pol && !pol.publicShares) return { code: 'org_policy', reason: 'Your organization has turned public links off.' };
  const sp = await prisma.$queryRaw<{ public_links: boolean }[]>`SELECT public_links FROM spaces WHERE id = ${spaceId}`;
  if (sp[0] && sp[0].public_links === false) return { code: 'team_off', reason: 'This team does not allow public links. A team lead can turn them on in the team settings.' };
  return null;
}

/** The answer the client shows instead of a "Share link" button that would fail. */
export async function shareVerdict(userId: string, kind: 'note' | 'todo', id: string): Promise<{ allowed: boolean; code?: string; reason?: string }> {
  if (kind === 'note') {
    const raw = await prisma.note.findFirst({ where: { id, isDeleted: false, ...ANY_SPACE }, select: { userId: true, spaceId: true } });
    if (!raw || (!raw.spaceId && raw.userId !== userId)) return { allowed: false, code: 'not_found', reason: 'This note was not found.' };
    if (raw.spaceId) {
      const acc = await spaceAccess(userId, raw.spaceId);
      if (!acc) return { allowed: false, code: 'not_found', reason: 'This note was not found.' };
      if (!(await shareableNote(userId, id))) {
        const view = !can('space.write', acc.org, acc.role);
        return { allowed: false, code: view ? 'read_only' : 'not_yours', reason: view ? 'You can read this team but not change it, so you cannot share its notes by link.' : 'Only the author (or someone they let edit) can share this note by link.' };
      }
    }
    const b = await shareBlockReason(raw.spaceId);
    return b ? { allowed: false, code: b.code, reason: b.reason } : { allowed: true };
  }
  const t = await shareableTodo(userId, id);
  if (!t) return { allowed: false, code: 'not_found', reason: 'This task was not found, or you cannot share it.' };
  const b = await shareBlockReason(t.spaceId);
  return b ? { allowed: false, code: b.code, reason: b.reason } : { allowed: true };
}

const TOKEN_TABLES = ['share_viewers', 'share_guests', 'share_blocked', 'share_reads', 'share_settings'];

/**
 * Turns off every public link of notes and tasks in these spaces (all spaces of an organization when a policy turns off, one team when its switch turns off).
 * Guests, presence, blocks, read stats and short codes of each link are removed as when the owner turns a link off.
 */
export async function revokeSpaceLinks(spaceIds: string[]): Promise<{ notes: number; tasks: number }> {
  if (!spaceIds.length) return { notes: 0, tasks: 0 };
  const noteTokens = await prisma.$queryRaw<{ share_token: string }[]>`
    UPDATE notes SET share_token = NULL, share_edit = FALSE, share_expires_at = NULL WHERE space_id = ANY(${spaceIds}::text[]) AND share_token IS NOT NULL RETURNING share_token`;
  const taskTokens = await prisma.$queryRaw<{ share_token: string }[]>`
    UPDATE todos SET share_token = NULL, share_edit = FALSE, share_note = FALSE, share_expires_at = NULL WHERE space_id = ANY(${spaceIds}::text[]) AND share_token IS NOT NULL RETURNING share_token`;
  for (const [kind, rows] of [['note', noteTokens], ['todo', taskTokens]] as const) {
    for (const r of rows) await Promise.all(TOKEN_TABLES.map((t) => prisma.$executeRawUnsafe(`DELETE FROM ${t} WHERE kind = $1 AND share_token = $2`, kind, r.share_token))).catch(() => {});
  }
  return { notes: noteTokens.length, tasks: taskTokens.length };
}

/** Revoke every public link in an organization's spaces and write one audit entry. */
export async function revokeOrgLinks(orgId: string, actorId: string | null, why: string): Promise<{ notes: number; tasks: number }> {
  const sp = await prisma.$queryRaw<{ id: string }[]>`SELECT id FROM spaces WHERE org_id = ${orgId}`;
  const r = await revokeSpaceLinks(sp.map((s) => s.id));
  await audit(orgId, actorId, 'shares.revoked', orgId, { why, ...r });
  return r;
}

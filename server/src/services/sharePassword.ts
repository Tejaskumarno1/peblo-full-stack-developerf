import crypto from 'crypto';
import prisma from '../db.js';
import { JWT_SECRET } from '../middleware/auth.js';

/*
 * Optional password on a share link. The owner sets it from the Share panel; people on the link type it once and get a
 * signed "unlock" value (tied to this link and this password) that they send with every request. Changing or removing the
 * password makes every old unlock value stop working.
 */
export async function pwHashOf(kind: string, token: string): Promise<string | null> {
  const r = await prisma.$queryRawUnsafe<{ pw_hash: string | null }[]>('SELECT pw_hash FROM share_settings WHERE kind = $1 AND share_token = $2', kind, token).catch(() => []);
  return r[0]?.pw_hash || null;
}
export function hashPassword(pw: string): string {
  const salt = crypto.randomBytes(16);
  return `${salt.toString('hex')}:${crypto.scryptSync(pw, salt, 32).toString('hex')}`;
}
export function verifyPassword(pw: string, stored: string): boolean {
  const [s, h] = stored.split(':');
  if (!s || !h) return false;
  const want = Buffer.from(h, 'hex');
  const got = crypto.scryptSync(pw, Buffer.from(s, 'hex'), want.length);
  return want.length === got.length && crypto.timingSafeEqual(want, got);
}
export function unlockFor(kind: string, token: string, stored: string): string {
  return crypto.createHmac('sha256', JWT_SECRET).update(`share-unlock:${kind}:${token}:${stored}`).digest('base64url');
}
/** True when the link has no password, or the given unlock value belongs to the current password. */
export async function unlockOk(kind: string, token: string, given: unknown): Promise<boolean> {
  const stored = await pwHashOf(kind, token);
  if (!stored) return true;
  if (typeof given !== 'string' || !given) return false;
  const want = Buffer.from(unlockFor(kind, token, stored));
  const got = Buffer.from(given);
  return want.length === got.length && crypto.timingSafeEqual(want, got);
}

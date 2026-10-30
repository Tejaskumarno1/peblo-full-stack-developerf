import crypto from 'node:crypto';
import prisma from '../db.js';

/*
 * Password-reset links, pending sign-ups (mail-confirmed sign-up) and the short-lived tickets that open a live-editing
 * WebSocket. A link is a random secret; only its SHA-256 is stored, so a database leak does not leak live links.
 * Nothing in this file ever logs a secret.
 */
export const RESET_TTL_MS = 30 * 60_000;
export const SIGNUP_TTL_MS = 24 * 3600_000;
export const hashOf = (t: string) => crypto.createHash('sha256').update(t).digest('hex');
const newSecret = () => crypto.randomBytes(32).toString('base64url');
// Times are written as UTC with to_timestamp(...) AT TIME ZONE 'UTC': a JS Date passed as a raw parameter would be converted in the
// database session's own time zone, while Prisma reads these columns back as UTC.
const utcAt = (n: number) => `(to_timestamp($${n}::double precision / 1000.0) AT TIME ZONE 'UTC')`;
const looksLikeSecret = (raw: string) => typeof raw === 'string' && raw.length >= 20 && raw.length <= 200;

/** A new reset link for this person; any older link of theirs stops working. Returns the secret to mail. */
export async function issueReset(userId: string): Promise<string> {
  const raw = newSecret();
  await prisma.$executeRawUnsafe('DELETE FROM password_resets WHERE user_id = $1', userId);
  await prisma.$executeRawUnsafe(`INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES ($1, $2, ${utcAt(3)})`, userId, hashOf(raw), Date.now() + RESET_TTL_MS);
  return raw;
}

/** Uses up a reset link (atomically, so it works once even if opened twice at the same moment). userId, or null if unknown/expired. */
export async function consumeReset(raw: string): Promise<string | null> {
  if (!looksLikeSecret(raw)) return null;
  const rows = await prisma.$queryRawUnsafe<{ user_id: string; expires_at: Date }[]>('DELETE FROM password_resets WHERE token_hash = $1 RETURNING user_id, expires_at', hashOf(raw));
  const row = rows[0];
  if (!row || new Date(row.expires_at).getTime() < Date.now()) return null;
  return row.user_id;
}

/** Remember a sign-up until its email link is opened. A newer attempt for the same address replaces the older one. */
export async function storePendingSignup(email: string, name: string, passwordHash: string): Promise<string> {
  const raw = newSecret();
  await prisma.$executeRawUnsafe('DELETE FROM pending_signups WHERE email = $1', email);
  await prisma.$executeRawUnsafe(`INSERT INTO pending_signups (email, name, password_hash, token_hash, expires_at) VALUES ($1, $2, $3, $4, ${utcAt(5)})`, email, name, passwordHash, hashOf(raw), Date.now() + SIGNUP_TTL_MS);
  return raw;
}
export async function dropPendingSignup(email: string) {
  await prisma.$executeRawUnsafe('DELETE FROM pending_signups WHERE email = $1', email);
}

/** Opens a sign-up link: creates the account (email already confirmed). null = not a sign-up link, 'bad' = expired/used/address taken. */
export async function completeSignup(raw: string): Promise<{ email: string } | 'bad' | null> {
  if (!looksLikeSecret(raw)) return null;
  const rows = await prisma.$queryRawUnsafe<{ email: string; name: string; password_hash: string; expires_at: Date }[]>('DELETE FROM pending_signups WHERE token_hash = $1 RETURNING email, name, password_hash, expires_at', hashOf(raw));
  const row = rows[0];
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) return 'bad';
  try {
    await prisma.user.create({ data: { email: row.email, name: row.name, passwordHash: row.password_hash, settings: {}, emailVerifiedAt: new Date() } });
  } catch (e: any) {
    if (e?.code === 'P2002') return 'bad'; // the address got an account some other way meanwhile
    throw e;
  }
  return { email: row.email };
}

/** Removes expired rows. Runs every hour (and from tests). */
export async function sweepAccountRows(): Promise<void> {
  const cutoff = Date.now() - 3600_000;
  await prisma.$executeRawUnsafe(`DELETE FROM password_resets WHERE expires_at < ${utcAt(1)}`, cutoff);
  await prisma.$executeRawUnsafe(`DELETE FROM pending_signups WHERE expires_at < ${utcAt(1)}`, cutoff);
}
const sweepTimer = setInterval(() => { sweepAccountRows().catch(() => {}); }, 3600_000);
sweepTimer.unref();
setTimeout(() => { sweepAccountRows().catch(() => {}); }, 60_000).unref();

// ---- live-editing tickets ----
// The WebSocket used to carry the sign-in token in its address (which lands in logs and browser history). Now the app asks
// (signed in) for a ticket for one note, and the WebSocket address carries only that: it works once, for 30 seconds,
// for that person and that note. Kept in memory: a restart simply makes open pages ask for a new one.
export const TICKET_TTL_MS = Number(process.env.PEBLO_TICKET_TTL_MS) > 0 ? Number(process.env.PEBLO_TICKET_TTL_MS) : 30_000; // the override is for tests
const MAX_TICKETS = 20_000;
const tickets = new Map<string, { userId: string; noteId: string; exp: number }>();
export function issueTicket(userId: string, noteId: string): string {
  const now = Date.now();
  if (tickets.size >= MAX_TICKETS) purgeTickets(now);
  if (tickets.size >= MAX_TICKETS) tickets.delete(tickets.keys().next().value as string); // oldest first
  const raw = newSecret();
  tickets.set(hashOf(raw), { userId, noteId, exp: now + TICKET_TTL_MS });
  return raw;
}
/** Uses the ticket up (even when it does not match, so a stolen ticket cannot be tried against other notes). userId, or null. */
export function consumeTicket(raw: string, noteId: string): string | null {
  if (!looksLikeSecret(raw)) return null;
  const key = hashOf(raw);
  const t = tickets.get(key);
  if (!t) return null;
  tickets.delete(key);
  if (t.exp < Date.now() || t.noteId !== noteId) return null;
  return t.userId;
}
function purgeTickets(now = Date.now()) { for (const [k, t] of tickets) if (t.exp < now) tickets.delete(k); }
const ticketSweep = setInterval(purgeTickets, 15_000);
ticketSweep.unref();

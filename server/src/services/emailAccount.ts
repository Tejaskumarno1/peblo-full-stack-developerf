import crypto from 'node:crypto';
import type { Request } from 'express';
import prisma from '../db.js';
import { changeEmailMail, emailChangedNotice, mailConfigured, publicBase, sendMail, verifyEmailMail } from './mailer.js';

/*
 * Email ownership. A link is a random secret; only its SHA-256 is stored, so a database leak does not leak live links.
 * Links work once and last 24 hours. Asking again replaces the older link of the same kind.
 */
const TTL_MS = 24 * 3600_000;
const hashOf = (t: string) => crypto.createHash('sha256').update(t).digest('hex');

async function issue(userId: string, kind: 'verify' | 'change', email: string): Promise<string> {
  const raw = crypto.randomBytes(32).toString('base64url');
  await prisma.emailToken.deleteMany({ where: { userId, kind } });
  await prisma.emailToken.create({ data: { userId, kind, newEmail: email, tokenHash: hashOf(raw), expiresAt: new Date(Date.now() + TTL_MS) } });
  return raw;
}

/** Mails a "confirm this address" link. false = the mail could not be sent (not set up, or the provider refused). */
export async function sendVerification(req: Request, userId: string, email: string): Promise<boolean> {
  if (!mailConfigured()) return false;
  const raw = await issue(userId, 'verify', email);
  return sendMail(verifyEmailMail(email, `${publicBase(req)}/verify-email?token=${raw}`));
}

/** Mails the NEW address a link; the account keeps its old address until that link is opened. */
export async function sendChange(req: Request, userId: string, newEmail: string): Promise<boolean> {
  const raw = await issue(userId, 'change', newEmail);
  const ok = await sendMail(changeEmailMail(newEmail, `${publicBase(req)}/verify-email?token=${raw}`));
  if (!ok) await prisma.emailToken.deleteMany({ where: { userId, kind: 'change' } });
  return ok;
}

export async function cancelChange(userId: string) {
  await prisma.emailToken.deleteMany({ where: { userId, kind: 'change' } });
}

export type Consumed = { ok: true; kind: 'verify' | 'change'; email: string } | { ok: false; error: string };

/** Opens a link from an email. */
export async function consumeToken(raw: string): Promise<Consumed> {
  const bad = { ok: false as const, error: 'This link is not valid or has expired. Ask for a new one from Settings.' };
  if (!raw || raw.length < 20 || raw.length > 200) return bad;
  const row = await prisma.emailToken.findUnique({ where: { tokenHash: hashOf(raw) } });
  if (!row || row.expiresAt.getTime() < Date.now() || !row.newEmail) return bad;
  const user = await prisma.user.findUnique({ where: { id: row.userId }, select: { id: true, email: true } });
  if (!user) return bad;

  if (row.kind === 'verify') {
    if (user.email.toLowerCase() !== row.newEmail.toLowerCase()) return bad; // the address changed after the link was sent
    await prisma.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date() } });
    await prisma.emailToken.deleteMany({ where: { userId: user.id, kind: 'verify' } });
    return { ok: true, kind: 'verify', email: user.email };
  }

  const taken = await prisma.user.findFirst({ where: { email: row.newEmail, NOT: { id: user.id } }, select: { id: true } });
  if (taken) return { ok: false, error: 'That email is already used by another account.' };
  const old = user.email;
  await prisma.user.update({ where: { id: user.id }, data: { email: row.newEmail, emailVerifiedAt: new Date() } });
  await prisma.emailToken.deleteMany({ where: { userId: user.id } });
  void sendMail(emailChangedNotice(old, row.newEmail)); // tells the old address; best effort
  return { ok: true, kind: 'change', email: row.newEmail };
}

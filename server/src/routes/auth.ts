import { Router } from 'express';
import bcrypt from 'bcryptjs';
import prisma from '../db.js';
import { authenticate, signToken } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { loadProfile } from '../services/profile.js';
import { cancelChange, consumeToken, sendVerification } from '../services/emailAccount.js';
import { mailConfigured } from '../services/mailer.js';

/*
 * Real accounts: anyone can sign up, and their notes/tasks/quizzes are theirs alone.
 * Passwords are hashed with bcrypt before they ever reach the database.
 */
const router = Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Brute-force protection. Sign-in is limited twice: per address (generous, many people can share one) and
// per account (tight, and it still holds when someone fakes their address). Only failed attempts count.
// Trade-off: someone can lock a known email out for 15 minutes by failing on purpose.
const emailOf = (req: any) => String(req.body?.email || '').trim().toLowerCase();
const loginIpLimit = rateLimit({ windowMs: 15 * 60_000, max: 40, skipSuccessful: true, message: 'Too many sign-in attempts. Wait a few minutes and try again.' });
const loginAccountLimit = rateLimit({ windowMs: 15 * 60_000, max: 10, skipSuccessful: true, key: (req) => { const e = emailOf(req); return e ? `acct:${e}` : ''; }, message: 'Too many sign-in attempts. Wait a few minutes and try again.' });
const loginLimit = [loginIpLimit, loginAccountLimit];
// An unknown email still costs one bcrypt comparison, so the reply time does not reveal whether an account exists.
const DUMMY_HASH = bcrypt.hashSync('peblo-timing-placeholder', 12);
const signupLimit = rateLimit({ windowMs: 60 * 60_000, max: Number(process.env.SIGNUP_RATE_MAX) || 10, message: 'Too many sign-ups from this address. Try again later.' });
const passwordLimit = rateLimit({ windowMs: 15 * 60_000, max: 8, message: 'Too many attempts. Wait a few minutes and try again.' });

const mailLimit = rateLimit({ windowMs: 15 * 60_000, max: 6, message: 'Too many emails requested. Wait a few minutes and try again.' });
const linkLimit = rateLimit({ windowMs: 15 * 60_000, max: 30, message: 'Too many attempts. Wait a few minutes and try again.' });

router.post('/signup', signupLimit, async (req, res, next) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    const name = String(req.body?.name || '').trim().slice(0, 80) || email.split('@')[0];

    if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    if (Buffer.byteLength(password, 'utf8') > 72) return res.status(400).json({ error: 'Password is too long (72 bytes at most; some characters count as more than one).' });

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) return res.status(409).json({ error: 'An account with that email already exists.' });

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({ data: { email, name, passwordHash, settings: {} } });

    void sendVerification(req, user.id, user.email).catch(() => {}); // best effort: signing up never fails because of mail
    const token = signToken(user);
    res.status(201).json({ token, user: await loadProfile(user.id) });
  } catch (error) {
    next(error);
  }
});

router.post('/login', ...loginLimit, async (req, res, next) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '').slice(0, 200);

    const user = await prisma.user.findUnique({ where: { email } });
    const matches = await bcrypt.compare(password, user ? user.passwordHash : DUMMY_HASH);
    const ok = !!user && matches;
    if (!ok) return res.status(401).json({ error: 'Incorrect email or password.' });

    res.json({ token: signToken(user!), user: await loadProfile(user!.id) });
  } catch (error) {
    next(error);
  }
});

// Mail the signed-in person a "confirm this address" link.
router.post('/send-verification', authenticate, mailLimit, async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user!.id }, select: { id: true, email: true, emailVerifiedAt: true } });
    if (!user) return res.status(404).json({ error: 'Account not found.' });
    if (user.emailVerifiedAt) return res.json({ alreadyVerified: true });
    if (!mailConfigured()) return res.status(503).json({ error: 'Email sending is not set up on this server yet, so Peblo cannot send the link.', mailConfigured: false });
    const sent = await sendVerification(req, user.id, user.email);
    if (!sent) return res.status(502).json({ error: 'The email could not be sent. Try again in a few minutes.' });
    res.json({ sent: true });
  } catch (error) {
    next(error);
  }
});

// Open a link from an email (confirm an address, or finish an address change). No sign-in needed: the secret is the proof.
router.post('/verify-email', linkLimit, async (req, res, next) => {
  try {
    const result = await consumeToken(String(req.body?.token || ''));
    if (!result.ok) return res.status(400).json({ error: result.error });
    res.json({ ok: true, kind: result.kind, email: result.email });
  } catch (error) {
    next(error);
  }
});

// Drop a pending address change.
router.post('/cancel-email-change', authenticate, async (req, res, next) => {
  try {
    await cancelChange(req.user!.id);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

// Change the password. Every other device is signed out; this one gets a fresh token.
// (Wrong current password answers 403, not 401, so the app does not mistake it for an expired session.)
router.post('/change-password', authenticate, passwordLimit, async (req, res, next) => {
  try {
    const current = String(req.body?.currentPassword || '').slice(0, 200);
    const next_ = String(req.body?.newPassword || '');
    if (next_.length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters.' });
    if (Buffer.byteLength(next_, 'utf8') > 72) return res.status(400).json({ error: 'Password is too long (72 bytes at most; some characters count as more than one).' });

    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
    if (!user || !(await bcrypt.compare(current, user.passwordHash))) {
      return res.status(403).json({ error: 'Your current password is not correct.' });
    }
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await bcrypt.hash(next_, 12), tokenVersion: { increment: 1 } },
    });
    (req.app.get('disconnectUser') as ((id: string) => void) | undefined)?.(user.id);
    res.json({ token: signToken(updated), message: 'Password changed. Other devices were signed out.' });
  } catch (error) {
    next(error);
  }
});

// "Sign out everywhere": invalidates every token, including this device's.
router.post('/logout-all', authenticate, async (req, res, next) => {
  try {
    await prisma.user.update({ where: { id: req.user!.id }, data: { tokenVersion: { increment: 1 } } });
    (req.app.get('disconnectUser') as ((id: string) => void) | undefined)?.(req.user!.id);
    res.json({ message: 'Signed out on all devices.' });
  } catch (error) {
    next(error);
  }
});

// Delete the account and everything in it (notes, tasks, tags, saved keys, quiz history). Needs the password again.
// Every table that holds the person's data is tied to the user row with ON DELETE CASCADE, so one delete removes it all.
// There is no undo and no copy is kept; the app tells people to export first.
router.post('/delete-account', authenticate, passwordLimit, async (req, res, next) => {
  try {
    const password = String(req.body?.password || '').slice(0, 200);
    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      return res.status(403).json({ error: 'That password is not correct.' });
    }
    await prisma.user.delete({ where: { id: user.id } });
    (req.app.get('disconnectUser') as ((id: string) => void) | undefined)?.(user.id);
    res.json({ message: 'Your account and everything in it was deleted.' });
  } catch (error) {
    next(error);
  }
});

export default router;

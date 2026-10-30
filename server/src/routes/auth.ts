import { Router } from 'express';
import bcrypt from 'bcryptjs';
import prisma from '../db.js';
import { authenticate, signToken } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { loadProfile } from '../services/profile.js';
import { cancelChange, consumeToken, sendVerification } from '../services/emailAccount.js';
import { finishSignupMail, mailConfigured, passwordResetMail, publicBase, sendMail, signupAttemptNotice } from '../services/mailer.js';
import { completeSignup, consumeReset, dropPendingSignup, issueReset, storePendingSignup } from '../services/accountSafety.js';

/*
 * Real accounts: anyone can sign up, and their notes/tasks/quizzes are theirs alone.
 * Passwords are hashed with bcrypt before they ever reach the database.
 */
const router = Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Brute-force protection. Sign-in is limited twice: per address (generous, many people can share one) and
// per account (tight, and it still holds when someone fakes their address). Only failed attempts count.
// Trade-off: someone can lock a known email out for 15 minutes by failing on purpose.
const emailOf = (req: any) => String(req.body?.email || '').trim().toLowerCase().slice(0, 254);
const userKeyOf = (req: any) => (req.user?.id ? `user:${req.user.id}` : '');
const loginIpLimit = rateLimit({ windowMs: 15 * 60_000, max: 40, skipSuccessful: true, message: 'Too many sign-in attempts. Wait a few minutes and try again.' });
const loginAccountLimit = rateLimit({ windowMs: 15 * 60_000, max: 10, skipSuccessful: true, key: (req) => { const e = emailOf(req); return e ? `acct:${e}` : ''; }, message: 'Too many sign-in attempts. Wait a few minutes and try again.' });
const loginLimit = [loginIpLimit, loginAccountLimit];
// An unknown email still costs one bcrypt comparison, so the reply time does not reveal whether an account exists.
const DUMMY_HASH = bcrypt.hashSync('peblo-timing-placeholder', 12);
const signupLimit = rateLimit({ windowMs: 60 * 60_000, max: Number(process.env.SIGNUP_RATE_MAX) || 10, message: 'Too many sign-ups from this address. Try again later.' });
// Counted per signed-in account (not just per address) and only on failures, so a stolen session cannot guess the current password from many addresses.
const passwordLimit = rateLimit({ windowMs: 15 * 60_000, max: 8, skipSuccessful: true, key: userKeyOf, message: 'Too many attempts. Wait a few minutes and try again.' });

// Password reset and mail-confirmed sign-up. Both count every request (not only failures), because each one can send an email:
// per address of the caller, and per email address asked about (the same answer whether or not it has an account).
const envNum = (name: string, fallback: number) => { const n = Number(process.env[name]); return Number.isFinite(n) && n > 0 ? n : fallback; };
const forgotIpLimit = rateLimit({ windowMs: 15 * 60_000, max: envNum('PEBLO_FORGOT_IP_MAX', 10), message: 'Too many requests. Wait a few minutes and try again.' });
const forgotEmailLimit = rateLimit({ windowMs: 15 * 60_000, max: envNum('PEBLO_FORGOT_EMAIL_MAX', 3), key: (req) => { const e = emailOf(req); return e ? `forgot:${e}` : ''; }, message: 'Too many requests. Wait a few minutes and try again.' });
const resetLimit = rateLimit({ windowMs: 15 * 60_000, max: envNum('PEBLO_RESET_RATE_MAX', 20), message: 'Too many attempts. Wait a few minutes and try again.' });
const signupEmailLimit = rateLimit({ windowMs: 60 * 60_000, max: envNum('PEBLO_SIGNUP_EMAIL_MAX', 5), key: (req) => { const e = emailOf(req); return e ? `signup:${e}` : ''; }, message: 'Too many sign-ups from this address. Try again later.' });

/** The rules for a new password, shared by sign-up, change and reset. null = fine. */
function passwordProblem(password: string): string | null {
  if (password.length < 8) return 'Password must be at least 8 characters.';
  if (Buffer.byteLength(password, 'utf8') > 72) return 'Password is too long (72 bytes at most; some characters count as more than one).';
  return null;
}
const FORGOT_REPLY = { message: 'If an account exists for that email, a reset link is on its way. It works once and expires in 30 minutes.' };
const SIGNUP_PENDING_REPLY = { pending: true, message: 'Check your email. If this address can be used to sign up, a link to finish is on its way.' };

const mailLimit = rateLimit({ windowMs: 15 * 60_000, max: 6, key: userKeyOf, message: 'Too many emails requested. Wait a few minutes and try again.' });
const linkLimit = rateLimit({ windowMs: 15 * 60_000, max: 30, message: 'Too many attempts. Wait a few minutes and try again.' });

router.post('/signup', signupLimit, signupEmailLimit, async (req, res, next) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    const name = String(req.body?.name || '').trim().slice(0, 80) || email.split('@')[0];

    if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
    const problem = passwordProblem(password);
    if (problem) return res.status(400).json({ error: problem });

    // Where this server can send mail, sign-up gives the same answer whether or not the address has an account (so it cannot be
    // used to find out who is registered): new addresses get a "finish signing up" link, existing ones a "someone tried" notice.
    // Without a mail transport that cannot work (nobody could ever finish), so the older behaviour stays: the account is
    // created at once, and a taken address is answered with 409. Both paths pay one bcrypt hash and one mail, so timing matches.
    const passwordHash = await bcrypt.hash(password, 12);
    const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });

    if (mailConfigured()) {
      if (existing) {
        if (await sendMail(signupAttemptNotice(email, `${publicBase(req)}/`))) return res.status(202).json(SIGNUP_PENDING_REPLY);
        return res.status(409).json({ error: 'An account with that email already exists.' }); // mail is down: the older behaviour
      }
      const raw = await storePendingSignup(email, name, passwordHash);
      if (await sendMail(finishSignupMail(email, `${publicBase(req)}/verify-email?token=${raw}`))) return res.status(202).json(SIGNUP_PENDING_REPLY);
      await dropPendingSignup(email).catch(() => {}); // mail is down: do not lock people out, create the account at once like before
    } else if (existing) {
      return res.status(409).json({ error: 'An account with that email already exists.' });
    }

    let user;
    try {
      user = await prisma.user.create({ data: { email, name, passwordHash, settings: {} } });
    } catch (e: any) {
      if (e?.code === 'P2002') return res.status(409).json({ error: 'An account with that email already exists.' }); // two sign-ups raced
      throw e;
    }

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
    const raw = String(req.body?.token || '');
    const signup = await completeSignup(raw); // a link from a "finish signing up" email
    if (signup === 'bad') return res.status(400).json({ error: 'This link is not valid or has expired. Sign up again to get a new one.' });
    if (signup) return res.json({ ok: true, kind: 'signup', email: signup.email });
    const result = await consumeToken(raw);
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
    const problem = passwordProblem(next_);
    if (problem) return res.status(400).json({ error: problem.replace(/^Password/, 'New password') });

    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
    if (!user || !(await bcrypt.compare(current, user.passwordHash))) {
      return res.status(403).json({ error: 'Your current password is not correct.' });
    }
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await bcrypt.hash(next_, 12), tokenVersion: { increment: 1 } },
    });
    await prisma.$executeRawUnsafe('DELETE FROM password_resets WHERE user_id = $1', user.id).catch(() => {}); // a reset link sent earlier is now pointless
    (req.app.get('disconnectUser') as ((id: string) => void) | undefined)?.(user.id);
    res.json({ token: signToken(updated), message: 'Password changed. Other devices were signed out.' });
  } catch (error) {
    next(error);
  }
});

// Forgot password. Always the same answer and (almost) the same time, whether or not the address has an account: the lookup is
// the only work done before replying; the token and the email happen afterwards.
router.post('/forgot-password', forgotIpLimit, forgotEmailLimit, async (req, res, next) => {
  try {
    const email = emailOf(req);
    if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
    const user = await prisma.user.findUnique({ where: { email }, select: { id: true, email: true } });
    res.json(FORGOT_REPLY);
    void (async () => {
      if (!mailConfigured()) {
        console.warn('[auth] A password reset was asked for, but this server has no mail transport (set SMTP_HOST, SMTP_USER and SMTP_PASS, or RESEND_API_KEY), so no email was sent.');
        return;
      }
      if (!user) return;
      const raw = await issueReset(user.id);
      if (!(await sendMail(passwordResetMail(user.email, `${publicBase(req)}/reset-password?token=${raw}`)))) console.error('[auth] The password reset email could not be sent.');
    })().catch((e) => console.error('[auth] password reset failed:', e?.message || 'error'));
  } catch (error) {
    next(error);
  }
});

// Choose a new password with the emailed link. Signs everyone out (tokenVersion), revokes access tokens (a reset can mean the account
// was taken over), and uses up every reset link of that person. They sign in again afterwards: nothing here hands out a session.
router.post('/reset-password', resetLimit, async (req, res, next) => {
  try {
    const raw = String(req.body?.token || '');
    const password = String(req.body?.password || '');
    const problem = passwordProblem(password);
    if (problem) return res.status(400).json({ error: problem });
    const passwordHash = await bcrypt.hash(password, 12); // before the link is checked, so a bad link costs the same time
    const userId = await consumeReset(raw);
    if (!userId) return res.status(400).json({ error: 'This link is not valid or has expired. Ask for a new one.' });
    await prisma.$transaction([
      prisma.user.update({ where: { id: userId }, data: { passwordHash, tokenVersion: { increment: 1 } } }),
      prisma.apiToken.deleteMany({ where: { userId } }),
      prisma.$executeRawUnsafe('DELETE FROM password_resets WHERE user_id = $1', userId),
      prisma.user.updateMany({ where: { id: userId, emailVerifiedAt: null }, data: { emailVerifiedAt: new Date() } }), // opening a link sent to the address proves it is theirs
    ]);
    (req.app.get('disconnectUser') as ((id: string) => void) | undefined)?.(userId);
    res.json({ ok: true, message: 'Password changed. Sign in with your new password.' });
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

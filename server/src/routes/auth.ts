import { Router } from 'express';
import bcrypt from 'bcryptjs';
import prisma from '../db.js';
import { signToken } from '../middleware/auth.js';

/*
 * Real accounts: anyone can sign up, and their notes/tasks/quizzes are theirs alone.
 * Passwords are hashed with bcrypt before they ever reach the database.
 */
const router = Router();

function publicUser(u: any) {
  return { id: u.id, name: u.name, email: u.email, jobTitle: u.jobTitle, bio: u.bio, timezone: u.timezone, settings: u.settings };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

router.post('/signup', async (req, res, next) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    const name = String(req.body?.name || '').trim().slice(0, 80) || email.split('@')[0];

    if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) return res.status(409).json({ error: 'An account with that email already exists.' });

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({ data: { email, name, passwordHash, settings: {} } });

    const token = signToken({ id: user.id, email: user.email });
    res.status(201).json({ token, user: publicUser(user) });
  } catch (error) {
    next(error);
  }
});

router.post('/login', async (req, res, next) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');

    const user = await prisma.user.findUnique({ where: { email } });
    const ok = user && (await bcrypt.compare(password, user.passwordHash));
    if (!ok) return res.status(401).json({ error: 'Incorrect email or password.' });

    const token = signToken({ id: user!.id, email: user!.email });
    res.json({ token, user: publicUser(user) });
  } catch (error) {
    next(error);
  }
});

export default router;

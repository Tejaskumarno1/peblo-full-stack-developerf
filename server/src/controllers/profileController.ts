import { Request, Response, NextFunction } from 'express';
import prisma from '../db.js';
import bcrypt from 'bcryptjs';
import { KEY_FIELDS, loadProfile, saveKeys } from '../services/profile.js';
import { validZone } from '../utils/userTime.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function getProfile(req: Request, res: Response, next: NextFunction) {
  try {
    res.json({ user: await loadProfile(req.user!.id) });
  } catch (error) {
    next(error);
  }
}

export async function updateProfile(req: Request, res: Response, next: NextFunction) {
  try {
    const { name, email, jobTitle, bio, timezone, settings, currentPassword } = req.body;
    const userId = req.user!.id;

    // Sizes and types (PEB-66): nothing unbounded is stored.
    const bad = (m: string) => res.status(400).json({ error: m });
    if (name !== undefined && typeof name !== 'string') return bad('Name must be text.');
    if (jobTitle !== undefined && (typeof jobTitle !== 'string' || jobTitle.length > 100)) return bad('Job title must be text of at most 100 characters.');
    if (bio !== undefined && (typeof bio !== 'string' || bio.length > 500)) return bad('Bio must be text of at most 500 characters.');
    if (timezone !== undefined && timezone !== '' && !validZone(timezone)) return bad('Unknown time zone.');
    if (settings !== undefined && (typeof settings !== 'object' || settings === null || Array.isArray(settings) || JSON.stringify(settings).length > 20_000)) return bad('Settings must be an object of at most 20 KB.');

    let newEmail: string | undefined;
    if (email !== undefined) {
      newEmail = String(email).trim().toLowerCase();
      if (!EMAIL_RE.test(newEmail)) return res.status(400).json({ error: 'Enter a valid email address.' });
      // Changing the sign-in email needs the current password (a stolen session alone must not be enough).
      const me = await prisma.user.findUnique({ where: { id: userId }, select: { email: true, passwordHash: true } });
      if (me && me.email !== newEmail) {
        const okPw = typeof currentPassword === 'string' && currentPassword.length > 0 && (await bcrypt.compare(currentPassword.slice(0, 200), me.passwordHash));
        if (!okPw) return res.status(403).json({ error: 'Enter your current password to change your email.' });
      }
      const taken = await prisma.user.findFirst({ where: { email: newEmail, NOT: { id: userId } }, select: { id: true } });
      if (taken) return res.status(409).json({ error: 'That email is already used by another account.' });
    }

    let mergedSettings: any;
    if (settings && typeof settings === 'object') {
      const current = await prisma.user.findUnique({ where: { id: userId }, select: { settings: true } });
      mergedSettings = { ...((current?.settings as any) || {}), ...settings };
      // API keys are stored encrypted in their own table, never in the settings JSON.
      for (const k of KEY_FIELDS) delete mergedSettings[k];
    }

    await prisma.user.update({
      where: { id: userId },
      data: {
        ...(name && { name: String(name).trim().slice(0, 80) }),
        ...(newEmail !== undefined && { email: newEmail }),
        ...(jobTitle !== undefined && { jobTitle }),
        ...(bio !== undefined && { bio }),
        ...(timezone !== undefined && { timezone }),
        ...(mergedSettings && { settings: mergedSettings }),
      },
    });

    if (settings && typeof settings === 'object') await saveKeys(userId, settings);

    res.json({ message: 'Profile updated', user: await loadProfile(userId) });
  } catch (error) {
    next(error);
  }
}

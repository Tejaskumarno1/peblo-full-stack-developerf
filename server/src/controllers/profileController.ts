import { Request, Response, NextFunction } from 'express';
import prisma from '../db.js';
import { KEY_FIELDS, loadProfile, saveKeys } from '../services/profile.js';

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
    const { name, email, jobTitle, bio, timezone, settings } = req.body;
    const userId = req.user!.id;

    let newEmail: string | undefined;
    if (email !== undefined) {
      newEmail = String(email).trim().toLowerCase();
      if (!EMAIL_RE.test(newEmail)) return res.status(400).json({ error: 'Enter a valid email address.' });
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

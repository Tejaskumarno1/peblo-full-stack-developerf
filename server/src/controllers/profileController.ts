import { Request, Response, NextFunction } from 'express';
import prisma from '../db.js';

const profileSelect = { id: true, name: true, email: true, jobTitle: true, bio: true, timezone: true, settings: true };

export async function getProfile(req: Request, res: Response, next: NextFunction) {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user!.id }, select: profileSelect });
    res.json({ user });
  } catch (error) {
    next(error);
  }
}

export async function updateProfile(req: Request, res: Response, next: NextFunction) {
  try {
    const { name, email, jobTitle, bio, timezone, settings } = req.body;
    const userId = req.user!.id;

    let mergedSettings: any;
    if (settings && typeof settings === 'object') {
      const current = await prisma.user.findUnique({ where: { id: userId }, select: { settings: true } });
      mergedSettings = { ...((current?.settings as any) || {}), ...settings };
    }

    const user = await prisma.user.update({
      where: { id: userId },
      data: {
        ...(name && { name }),
        ...(email !== undefined && { email }),
        ...(jobTitle !== undefined && { jobTitle }),
        ...(bio !== undefined && { bio }),
        ...(timezone !== undefined && { timezone }),
        ...(mergedSettings && { settings: mergedSettings }),
      },
      select: profileSelect,
    });

    if (settings) {
      const apiKeysData: any = {};
      for (const k of ['openAiKey', 'geminiKey', 'groqKey', 'huggingFaceKey']) {
        if (settings[k] !== undefined) apiKeysData[k] = settings[k];
      }
      if (Object.keys(apiKeysData).length > 0) {
        await prisma.userApiKeys.upsert({
          where: { userId },
          create: { userId, ...apiKeysData },
          update: apiKeysData,
        });
      }
    }

    res.json({ message: 'Profile updated', user });
  } catch (error) {
    next(error);
  }
}

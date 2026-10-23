import { Request, Response, NextFunction } from 'express';
import prisma from '../db.js';

export const AI_OFF_MESSAGE = 'AI is turned off in your settings, so nothing is sent to any model. Turn it back on in Settings > AI Providers.';

/**
 * "Turn off all AI" (PEB-106): when the account has it on, every route that would call a model answers 403 AI_OFF
 * before anything is read or sent. Use it after `authenticate`. The providers also refuse in aiService.ts,
 * so a code path that forgets this gate still cannot reach a model.
 */
export async function aiOffGate(req: Request, res: Response, next: NextFunction) {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user!.id }, select: { settings: true } });
    if ((user?.settings as any)?.aiOff === true) {
      return res.status(403).json({ error: AI_OFF_MESSAGE, code: 'AI_OFF' });
    }
    next();
  } catch (error) {
    next(error);
  }
}

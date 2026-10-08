import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import prisma from '../db.js';

// Each request proves who it's acting as with a JWT (issued at /api/auth/login or /signup).
// The token also carries the account's "token version": changing the password or choosing
// "sign out everywhere" bumps it in the database, which makes every older token stop working.
const DEV_SECRET = 'dev-only-insecure-secret-change-me';
const configured = process.env.JWT_SECRET?.trim();
if (process.env.NODE_ENV === 'production' && (!configured || configured === DEV_SECRET || configured.length < 16)) {
  throw new Error(
    'JWT_SECRET is missing or too short. Set it to a long random string before running Peblo in production — ' +
    'generate one with: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"'
  );
}
export const JWT_SECRET = configured || DEV_SECRET;
if (!configured) {
  console.warn('[auth] JWT_SECRET is not set — using an insecure development default.');
}

export interface AuthedUser {
  id: string;
  email: string;
}

export function signToken(user: { id: string; email: string; tokenVersion?: number }): string {
  return jwt.sign({ sub: user.id, email: user.email, v: user.tokenVersion ?? 0 }, JWT_SECRET, { expiresIn: '30d' });
}

/** Who a token belongs to, or null if it is missing, forged, expired or signed out since. */
export async function verifyToken(token: string | null | undefined): Promise<AuthedUser | null> {
  if (!token) return null;
  try {
    const payload = jwt.verify(token, JWT_SECRET) as { sub: string; email: string; v?: number };
    const row = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: { email: true, tokenVersion: true },
    });
    if (!row || row.tokenVersion !== (payload.v ?? 0)) return null;
    return { id: payload.sub, email: row.email };
  } catch {
    return null;
  }
}

export async function authenticate(req: Request, res: Response, next: NextFunction) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Sign in to continue.' });

    const user = await verifyToken(token);
    if (!user) return res.status(401).json({ error: 'Your session has expired. Please sign in again.' });
    req.user = user;
    next();
  } catch (error) {
    next(error);
  }
}

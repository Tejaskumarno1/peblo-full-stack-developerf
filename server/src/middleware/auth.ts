import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
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

/** Personal access tokens start with this, so they are never mistaken for a sign-in token. */
export const TOKEN_PREFIX = 'pbl_';
export const hashToken = (token: string) => crypto.createHash('sha256').update(token).digest('hex');

export interface AuthedUser {
  id: string;
  email: string;
  /** True when the request used a personal access token instead of a sign-in. */
  viaToken?: boolean;
  /** A read-only token may only make GET requests. */
  readOnly?: boolean;
}

export function signToken(user: { id: string; email: string; tokenVersion?: number }): string {
  return jwt.sign({ sub: user.id, email: user.email, v: user.tokenVersion ?? 0 }, JWT_SECRET, { expiresIn: '30d', algorithm: 'HS256' });
}

/** Who a token belongs to, or null if it is missing, forged, expired or signed out since. */
export async function verifyToken(token: string | null | undefined): Promise<AuthedUser | null> {
  if (!token) return null;
  if (token.startsWith(TOKEN_PREFIX)) {
    try {
      const row = await prisma.apiToken.findUnique({ where: { tokenHash: hashToken(token) }, select: { id: true, userId: true, scope: true, user: { select: { email: true } } } });
      if (!row) return null;
      prisma.apiToken.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } }).catch(() => {});
      return { id: row.userId, email: row.user.email, viaToken: true, readOnly: row.scope === 'read' };
    } catch {
      return null;
    }
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] }) as { sub: string; email: string; v?: number };
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
    // A token is for notes and tasks. Account settings, passwords, keys and the tokens themselves need a real sign-in.
    if (user.viaToken && /^\/api\/(auth|tokens|profile)(\/|\?|$)/i.test(req.originalUrl)) {
      return res.status(403).json({ error: 'An access token cannot change account settings. Sign in to do that.' });
    }
    if (user.readOnly && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      return res.status(403).json({ error: 'This access token is read-only.' });
    }
    req.user = user;
    next();
  } catch (error) {
    next(error);
  }
}

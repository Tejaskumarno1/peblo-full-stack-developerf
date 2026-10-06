import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

// Multiple people can now sign up and log in; each request proves who it's acting as
// with a JWT (issued at /api/auth/login or /api/auth/signup), not a hardcoded local user.
export const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-insecure-secret-change-me';
if (!process.env.JWT_SECRET) {
  console.warn('[auth] JWT_SECRET is not set — using an insecure default. Set it before deploying.');
}

export interface AuthedUser {
  id: string;
  email: string;
}

export function signToken(user: AuthedUser): string {
  return jwt.sign({ sub: user.id, email: user.email }, JWT_SECRET, { expiresIn: '30d' });
}

export function authenticate(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Sign in to continue.' });

  try {
    const payload = jwt.verify(token, JWT_SECRET) as { sub: string; email: string };
    req.user = { id: payload.sub, email: payload.email } as any;
    next();
  } catch {
    res.status(401).json({ error: 'Your session has expired. Please sign in again.' });
  }
}

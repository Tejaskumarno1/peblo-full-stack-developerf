import crypto from 'crypto';
import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { Request, Response, NextFunction } from 'express';
import type { CorsOptionsDelegate } from 'cors';

/*
 * Security headers (PEB-65).
 *  - Every response: no MIME sniffing, no framing, no referrer, microphone only for this origin.
 *  - API answers are never cached (they hold private notes).
 *  - The web app (served from staticDir) also gets a Content-Security-Policy: scripts only from this
 *    origin plus the one inline theme script in index.html (allowed by its hash, so a script injected
 *    into a note or AI reply cannot run).
 */

/** sha256 hashes of the inline <script> blocks in index.html, in CSP syntax. */
export function inlineScriptHashes(html: string): string[] {
  const out: string[] = [];
  const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    if (!m[1].trim()) continue;
    // The browser's HTML parser turns CRLF into LF before it hashes the script, so the hash must be taken the same way.
    const text = m[1].replace(/\r\n?/g, '\n');
    out.push(`'sha256-${crypto.createHash('sha256').update(text, 'utf8').digest('base64')}'`);
  }
  return out;
}

export function buildCsp(scriptHashes: string[], extraConnect: string[] = []): string {
  const connect = ["'self'", ...extraConnect].join(' ');
  return [
    "default-src 'self'",
    `script-src 'self' ${scriptHashes.join(' ')}`.trim(),
    "style-src 'self' 'unsafe-inline'", // React inline style={} attributes
    "img-src 'self' data: blob: https: http:", // link previews and images in notes come from anywhere
    "font-src 'self' data:",
    `connect-src ${connect}`,
    "media-src 'self' blob: data:",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

export function securityHeaders(staticDir?: string) {
  let csp = '';
  if (staticDir) {
    const indexFile = path.join(staticDir, 'index.html');
    const hashes = existsSync(indexFile) ? inlineScriptHashes(readFileSync(indexFile, 'utf8')) : [];
    csp = buildCsp(hashes);
  }
  return (req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'microphone=(self), camera=(), geolocation=(), payment=(), usb=()');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    if (req.secure) res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
    if (req.path.startsWith('/api')) res.setHeader('Cache-Control', 'no-store');
    else if (csp) res.setHeader('Content-Security-Policy', csp);
    next();
  };
}

/**
 * Which browser origins may call the API.
 *  - No Origin header (the desktop shell, curl): allowed.
 *  - The server's own origin: always allowed (the web app and the desktop app are served from it).
 *  - ALLOWED_ORIGINS: a hosted web client on another address.
 *  - Any localhost port: only outside production (Vite dev server). A packaged/production server refuses
 *    other local pages, so a page on another port cannot talk to the user's notes.
 */
export const corsDelegate: CorsOptionsDelegate<Request> = (req, cb) => {
  const origin = req.headers.origin;
  const extra = (process.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const own = `${req.protocol}://${req.headers.host}`;
  const dev = process.env.NODE_ENV !== 'production';
  const ok = !origin || origin === own || extra.includes(origin) || (dev && /^https?:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin));
  if (ok) return cb(null, { origin: true });
  cb(Object.assign(new Error('That origin is not allowed.'), { statusCode: 403 }) as any);
};

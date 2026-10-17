import { Request, Response, NextFunction, RequestHandler } from 'express';
import { aiOffGate } from './aiOff.js';

/**
 * A small in-memory limiter (per server process) for the endpoints people could brute-force.
 * Counts requests per key in a sliding window and answers 429 past the limit.
 *  - key: what to count by. Default is the client address; sign-in also counts by account (email),
 *    which still holds when someone fakes their address.
 *  - skipSuccessful: requests that end in a 2xx/3xx do not count, so normal use never locks anyone out.
 */
export function rateLimit(opts: { windowMs: number; max: number; message?: string; key?: (req: Request) => string; skipSuccessful?: boolean }) {
  const hits = new Map<string, number[]>();
  const timer = setInterval(() => {
    const cutoff = Date.now() - opts.windowMs;
    for (const [key, times] of hits) {
      const fresh = times.filter((t) => t > cutoff);
      if (fresh.length) hits.set(key, fresh); else hits.delete(key);
    }
  }, Math.max(opts.windowMs, 60_000));
  timer.unref();

  return (req: Request, res: Response, next: NextFunction) => {
    const key = (opts.key ? opts.key(req) : '') || req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const recent = (hits.get(key) || []).filter((t) => t > now - opts.windowMs);
    if (recent.length >= opts.max) {
      const retry = Math.ceil((recent[0] + opts.windowMs - now) / 1000);
      res.setHeader('Retry-After', String(retry));
      return res.status(429).json({ error: opts.message || `Too many attempts. Try again in ${Math.ceil(retry / 60)} min.` });
    }
    // make the timestamp unique so a successful request removes exactly its own entry
    const stamp = recent.length && recent[recent.length - 1] >= now ? recent[recent.length - 1] + 0.001 : now;
    recent.push(stamp);
    hits.set(key, recent);
    if (opts.skipSuccessful) {
      res.on('finish', () => {
        if (res.statusCode >= 400) return;
        const list = hits.get(key);
        if (!list) return;
        const i = list.indexOf(stamp);
        if (i >= 0) list.splice(i, 1);
        if (!list.length) hits.delete(key);
      });
    }
    next();
  };
}

// ---- PEB-26: limits on what one account can spend ----

const userKey = (req: Request) => {
  const id = (req as any).user?.id;
  return id ? `user:${id}` : '';
};

const numberFrom = (raw: string | undefined, fallback: number) => {
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
};

/**
 * Limits for requests that call an AI provider, counted per signed-in account (not per address):
 *  - AI_BURST_MAX: requests per minute (default 20, 0 = no limit)
 *  - AI_DAILY_LIMIT: requests per rolling 24 hours (default 500, 0 = no limit)
 * Use it after `authenticate`. Counts are in memory, so they reset when the server restarts.
 */
export function aiLimiter(opts: { burst?: number; daily?: number } = {}): RequestHandler[] {
  const burst = opts.burst ?? numberFrom(process.env.AI_BURST_MAX, 20);
  const daily = opts.daily ?? numberFrom(process.env.AI_DAILY_LIMIT, 500);
  const list: RequestHandler[] = [];
  if (burst > 0) {
    list.push(rateLimit({ windowMs: 60_000, max: burst, key: userKey, message: 'You are sending AI requests too fast. Wait a minute and try again.' }));
  }
  if (daily > 0) {
    list.push(rateLimit({
      windowMs: 24 * 60 * 60_000,
      max: daily,
      key: userKey,
      message: `You have used today's ${daily} AI requests. The limit is counted over a rolling 24 hours, so it frees up gradually. Whoever runs this server can change it with AI_DAILY_LIMIT.`,
    }));
  }
  return list;
}

/** What every route that calls a model goes through: "Turn off all AI" first (PEB-106), then the limits. One shared instance, so the daily count is for all AI features together. */
export const aiLimit: RequestHandler[] = [aiOffGate, ...aiLimiter()];

/** A generous limit for the whole API, per address, so one client cannot hammer the server (API_RATE_MAX per minute, default 1200, 0 = off). */
export function apiLimiter(max = numberFrom(process.env.API_RATE_MAX, 1200)): RequestHandler {
  if (max <= 0) return (_req, _res, next) => next();
  return rateLimit({ windowMs: 60_000, max, message: 'Too many requests. Slow down and try again in a minute.' });
}

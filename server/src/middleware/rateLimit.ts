import { Request, Response, NextFunction } from 'express';

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

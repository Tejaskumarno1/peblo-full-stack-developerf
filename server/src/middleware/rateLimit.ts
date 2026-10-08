import { Request, Response, NextFunction } from 'express';

/**
 * A small in-memory limiter (per server process) for the endpoints people could brute-force.
 * Counts requests per client address in a sliding window and answers 429 past the limit.
 */
export function rateLimit(opts: { windowMs: number; max: number; message?: string }) {
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
    const key = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const recent = (hits.get(key) || []).filter((t) => t > now - opts.windowMs);
    if (recent.length >= opts.max) {
      const retry = Math.ceil((recent[0] + opts.windowMs - now) / 1000);
      res.setHeader('Retry-After', String(retry));
      return res.status(429).json({ error: opts.message || `Too many attempts. Try again in ${Math.ceil(retry / 60)} min.` });
    }
    recent.push(now);
    hits.set(key, recent);
    next();
  };
}

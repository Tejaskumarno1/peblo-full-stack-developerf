// "Today" belongs to the person, not to the machine the server runs on.
// The client sends its IANA zone (e.g. "Asia/Kolkata") in the X-Timezone header; without it we use the
// server's own zone, which is right for the desktop app where server and person share a computer.
import type { Request } from 'express';

export function serverZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

export function validZone(z: unknown): string | null {
  if (typeof z !== 'string' || !z || z.length > 64) return null;
  try { new Intl.DateTimeFormat('en-US', { timeZone: z }); return z; } catch { return null; }
}

export function tzOf(req: Request): string {
  const h = req.headers['x-timezone'];
  return validZone(Array.isArray(h) ? h[0] : h) || serverZone();
}

const formatters = new Map<string, Intl.DateTimeFormat>();
function fmt(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric',
      hour: 'numeric', minute: 'numeric', second: 'numeric',
    });
    formatters.set(tz, f);
  }
  return f;
}

/** Calendar fields of an instant as seen in `tz` (m is 1-12). */
export function zoneParts(d: Date, tz: string) {
  const o: Record<string, number> = {};
  for (const p of fmt(tz).formatToParts(d)) if (p.type !== 'literal') o[p.type] = Number(p.value);
  return { y: o.year, m: o.month, d: o.day, h: o.hour % 24, mi: o.minute, s: o.second };
}

function offsetMs(instant: number, tz: string): number {
  const p = zoneParts(new Date(instant), tz);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - Math.floor(instant / 1000) * 1000;
}

/** The instant at which the wall clock in `tz` reads y-m-d h:mi:s.ms. Day numbers may overflow (d = 0 is the day before). */
export function zonedTime(y: number, m: number, d: number, h: number, mi: number, s: number, ms: number, tz: string): Date {
  const guess = Date.UTC(y, m - 1, d, h, mi, s, ms);
  let t = guess - offsetMs(guess, tz);
  const o2 = offsetMs(t, tz);
  if (guess - o2 !== t) t = guess - o2; // we crossed a daylight-saving change
  return new Date(t);
}

/** Start and last millisecond of the person's day, `offsetDays` away from the day containing `now`. */
export function dayBounds(tz: string, now: Date = new Date(), offsetDays = 0) {
  const p = zoneParts(now, tz);
  const start = zonedTime(p.y, p.m, p.d + offsetDays, 0, 0, 0, 0, tz);
  const end = new Date(zonedTime(p.y, p.m, p.d + offsetDays + 1, 0, 0, 0, 0, tz).getTime() - 1);
  return { start, end };
}

/** Bounds of a named calendar day ("2026-10-12") in `tz`. */
export function dayBoundsOf(y: number, m: number, d: number, tz: string) {
  return {
    start: zonedTime(y, m, d, 0, 0, 0, 0, tz),
    end: new Date(zonedTime(y, m, d + 1, 0, 0, 0, 0, tz).getTime() - 1),
  };
}

export function dayKey(d: Date, tz: string): string {
  const p = zoneParts(d, tz);
  return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
}

export function hourIn(tz: string, now: Date = new Date()): number {
  return zoneParts(now, tz).h;
}

export function longDate(tz: string, now: Date = new Date()): string {
  return now.toLocaleDateString('en-US', { timeZone: tz, weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

export function shortWeekday(d: Date, tz: string): string {
  return d.toLocaleDateString('en-US', { timeZone: tz, weekday: 'short' });
}

// Repeating tasks. A series is one row (the rule + the task details). Its occurrences are ordinary todo rows
// that are generated ahead of time, so every screen (Tasks, Calendar, River, voice) sees the same tasks,
// and the series never runs out: each time tasks are listed we top it up to a horizon.
import prisma from '../db.js';
import { zoneParts, zonedTime } from '../utils/userTime.js';

export const RECURRENCES = ['none', 'daily', 'weekdays', 'weekly', 'monthly', 'yearly'] as const;
export type Recurrence = typeof RECURRENCES[number];
export const isRepeating = (r: unknown): r is Exclude<Recurrence, 'none'> => typeof r === 'string' && r !== 'none' && (RECURRENCES as readonly string[]).includes(r);

const DAY = 86_400_000;
const HORIZON_DAYS: Record<string, number> = { daily: 60, weekdays: 60, weekly: 90, monthly: 130, yearly: 400 };
const MAX_PER_PASS = 400;

const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate(); // m is 1-12

/**
 * The occurrence after `last`, on the person's wall clock (so 9:00 stays 9:00 across daylight-saving changes).
 * Monthly and yearly always aim for the anchor's day of the month and fall back to the last day of a shorter
 * month (the 31st becomes Feb 28/29, Apr 30...), without drifting later.
 */
export function nextOccurrence(rule: Exclude<Recurrence, 'none'>, anchor: Date, last: Date, tz: string): Date {
  const a = zoneParts(anchor, tz);
  const l = zoneParts(last, tz);
  let y = l.y, m = l.m, d = l.d;
  if (rule === 'daily') d += 1;
  else if (rule === 'weekly') d += 7;
  else if (rule === 'weekdays') {
    d += 1;
    const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    if (dow === 6) d += 2; else if (dow === 0) d += 1;
  } else if (rule === 'monthly') {
    m += 1; if (m > 12) { m = 1; y += 1; }
    d = Math.min(a.d, daysInMonth(y, m));
  } else { // yearly
    y += 1; m = a.m;
    d = Math.min(a.d, daysInMonth(y, m));
  }
  return zonedTime(y, m, d, l.h, l.mi, l.s, last.getUTCMilliseconds(), tz);
}

/** Make sure every open series of this person has occurrences up to its horizon. Safe to call often and from parallel requests. */
export async function topUpSeries(userId: string, onlySeriesId?: string): Promise<void> {
  const list = await prisma.todoSeries.findMany({ where: { userId, endedAt: null, ...(onlySeriesId ? { id: onlySeriesId } : {}) } });
  const now = Date.now();
  for (const s of list) {
    const horizon = now + (HORIZON_DAYS[s.recurrence] ?? 60) * DAY;
    if (s.lastGenerated.getTime() >= horizon || !isRepeating(s.recurrence)) continue;

    const rows: any[] = [];
    let last = s.lastGenerated;
    let note: string | null = null;
    if (s.noteId) note = (await prisma.note.findFirst({ where: { id: s.noteId, userId }, select: { id: true } }))?.id ?? null;
    for (let n = 0; n < MAX_PER_PASS && last.getTime() < horizon; n++) {
      last = nextOccurrence(s.recurrence, s.anchor, last, s.timezone);
      if (last.getTime() < now - DAY) continue; // a series started long ago does not backfill the past
      rows.push({
        userId, seriesId: s.id, text: s.text, priority: s.priority, deadline: last,
        startTime: s.startTime, endTime: s.endTime, recurrence: s.recurrence, todoTags: s.todoTags ?? [], noteId: note,
      });
    }
    // Claim the range first, so two requests at once do not both insert the same days.
    await prisma.$transaction(async (tx) => {
      const claim = await tx.todoSeries.updateMany({ where: { id: s.id, lastGenerated: s.lastGenerated }, data: { lastGenerated: last } });
      if (claim.count === 1 && rows.length) await tx.todo.createMany({ data: rows });
    });
  }
}

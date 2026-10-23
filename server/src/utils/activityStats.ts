// Home's streak and heatmap. A "day" is the person's calendar day in their time zone, written "YYYY-MM-DD".
// Day keys are only ever compared or stepped as plain calendar dates (through UTC midnight), never through local time.
import { dayKey, serverZone } from './userTime.js';

export function toDateKey(date: Date | string | number, tz: string = serverZone()): string {
  return dayKey(new Date(date), tz);
}

const keyMs = (key: string) => {
  const [y, m, d] = key.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
};
const msKey = (ms: number) => new Date(ms).toISOString().slice(0, 10);
export const addDaysToKey = (key: string, n: number) => msKey(keyMs(key) + n * 86400000);
const weekdayOfKey = (key: string) => new Date(keyMs(key)).getUTCDay();

interface ActivityDay {
  date: string;
  created: number;
  updated: number;
  total: number;
}

export function buildDailyActivity(
  notes: { createdAt: Date | string; updatedAt: Date | string }[],
  tz: string = serverZone(),
): Record<string, ActivityDay> {
  const dayMap: Record<string, ActivityDay> = {};

  const ensureDay = (key: string): ActivityDay => {
    if (!dayMap[key]) {
      dayMap[key] = { date: key, created: 0, updated: 0, total: 0 };
    }
    return dayMap[key];
  };

  for (const note of notes) {
    const createdKey = toDateKey(note.createdAt, tz);
    const createdDay = ensureDay(createdKey);
    createdDay.created += 1;
    createdDay.total += 1;

    const updatedKey = toDateKey(note.updatedAt, tz);
    if (updatedKey !== createdKey) {
      const updatedDay = ensureDay(updatedKey);
      updatedDay.updated += 1;
      updatedDay.total += 1;
    }
  }

  return dayMap;
}

export function calculateStreakStats(dayMap: Record<string, ActivityDay>, tz: string = serverZone(), now: Date = new Date()) {
  const activeDates = Object.keys(dayMap)
    .filter((key) => dayMap[key].total > 0)
    .sort();

  const activeSet = new Set(activeDates);
  const activeDays = activeDates.length;

  let longest = 0;
  let run = 0;
  for (let i = 0; i < activeDates.length; i++) {
    run = i > 0 && addDaysToKey(activeDates[i - 1], 1) === activeDates[i] ? run + 1 : 1;
    longest = Math.max(longest, run);
  }

  // The streak is still alive if you were active yesterday and today is not over yet.
  let current = 0;
  let cursor = toDateKey(now, tz);
  if (!activeSet.has(cursor)) cursor = addDaysToKey(cursor, -1);
  while (activeSet.has(cursor)) {
    current += 1;
    cursor = addDaysToKey(cursor, -1);
  }

  const weekdayTotals = [0, 0, 0, 0, 0, 0, 0];
  const weekdayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  for (const key of activeDates) {
    weekdayTotals[weekdayOfKey(key)] += dayMap[key].total;
  }
  const maxWeekday = weekdayTotals.indexOf(Math.max(...weekdayTotals));
  const mostActiveDay = activeDays > 0 ? weekdayNames[maxWeekday] : '—';

  const recentActiveDates = [...activeDates]
    .reverse()
    .slice(0, 4)
    .map((key) => ({
      date: key,
      label: new Date(keyMs(key)).toLocaleDateString('en', { month: 'short', day: 'numeric', timeZone: 'UTC' }),
    }));

  return { current, longest, activeDays, mostActiveDay, recentActiveDates };
}

export function buildYearHeatmap(dayMap: Record<string, ActivityDay>, tz: string = serverZone(), now: Date = new Date()) {
  const end = toDateKey(now, tz);

  // 52 weeks back, then back to the Sunday that starts that week
  let start = addDaysToKey(end, -364);
  while (weekdayOfKey(start) !== 0) start = addDaysToKey(start, -1);

  const days = [];
  for (let key = start; key <= end; key = addDaysToKey(key, 1)) {
    const entry = dayMap[key] || { date: key, created: 0, updated: 0, total: 0 };
    days.push({
      date: key,
      created: entry.created,
      updated: entry.updated,
      total: entry.total,
      dayOfWeek: weekdayOfKey(key),
    });
  }

  const weeks = [];
  for (let i = 0; i < days.length; i += 7) {
    weeks.push(days.slice(i, i + 7));
  }

  return weeks;
}

export function getEditsThisMonth(dayMap: Record<string, ActivityDay>, tz: string = serverZone(), now: Date = new Date()): number {
  const month = toDateKey(now, tz).slice(0, 7);
  return Object.entries(dayMap).reduce((sum, [key, day]) => (key.startsWith(month) ? sum + day.total : sum), 0);
}

// Calendar helpers that need no browser, so they can be tested.
import { spanOf, timeOf } from './softUtils.js';

const midnight = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const same = (a, b) => midnight(a).getTime() === midnight(b).getTime();

/**
 * The first free gaps of at least `durH` hours, inside working hours, over the next `days` days.
 * Timed, open tasks and meetings count as busy. Today starts at the next quarter hour.
 * Returns [{ day: Date, start: hours, end: hours }] (at most one per gap, `count` in all).
 */
export function freeSlots(todos, from, durH, { days = 7, dayStart = 9, dayEnd = 18, count = 3, now = new Date() } = {}) {
  const out = [];
  for (let i = 0; i < days && out.length < count; i += 1) {
    const day = midnight(from);
    day.setDate(day.getDate() + i);
    let lo = dayStart;
    if (same(day, now)) lo = Math.max(lo, Math.ceil((now.getHours() + now.getMinutes() / 60) * 4) / 4);
    const busy = todos
      .filter((t) => t.deadline && !t.completed && timeOf(t) && same(t.deadline, day))
      .map((t) => spanOf(t))
      .filter(Boolean)
      .sort((a, b) => a.start - b.start);
    let cursor = lo;
    for (const b of busy) {
      if (b.start - cursor >= durH - 1e-6 && cursor + durH <= dayEnd + 1e-6) out.push({ day, start: cursor, end: cursor + durH });
      cursor = Math.max(cursor, b.end);
      if (out.length >= count) break;
    }
    if (out.length < count && dayEnd - cursor >= durH - 1e-6) out.push({ day, start: cursor, end: cursor + durH });
  }
  return out.slice(0, count);
}

/** The next `days` days with the open and done items on each, for the agenda list. Empty days are left out. */
export function agendaDays(todos, from, days = 14) {
  const out = [];
  for (let i = 0; i < days; i += 1) {
    const day = midnight(from);
    day.setDate(day.getDate() + i);
    const items = todos
      .filter((t) => t.deadline && same(t.deadline, day))
      .sort((a, b) => (timeOf(a) || '99:99').localeCompare(timeOf(b) || '99:99'));
    if (items.length) out.push({ day, items });
  }
  return out;
}

/** How busy each day of a year is: 12 months of { date, n } with n = items that day (done or not). Pure, so it can be tested. */
export function yearHeat(todos, year, mondayFirst = true) {
  const count = new Map();
  for (const t of todos) {
    if (!t.deadline) continue;
    const d = new Date(t.deadline);
    if (d.getFullYear() !== year) continue;
    const k = `${d.getMonth()}-${d.getDate()}`;
    count.set(k, (count.get(k) || 0) + 1);
  }
  return Array.from({ length: 12 }, (_, m) => {
    const len = new Date(year, m + 1, 0).getDate();
    const first = new Date(year, m, 1).getDay(); // 0 = Sunday
    const lead = mondayFirst ? (first + 6) % 7 : first;
    return { month: m, lead, days: Array.from({ length: len }, (_, i) => ({ date: new Date(year, m, i + 1), n: count.get(`${m}-${i + 1}`) || 0 })) };
  });
}
/** 0 none, 1 one item, 2 two or three, 3 four or more. */
export const heatLevel = (n) => (n <= 0 ? 0 : n === 1 ? 1 : n <= 3 ? 2 : 3);

import { startOfWeek } from '../utils/weekStart';
// Time maths and small helpers for the River screens.
import { startOfDay, addDays, sameDay, spanOf } from '../soft/softUtils';

export { startOfDay, addDays, sameDay, spanOf };

/** Awake hours are drawn to scale; the night (22:00 → 08:00) folds into a thin band. */
export const DAY_START = 8;
export const DAY_END = 22;
const AWAKE = DAY_END - DAY_START;

/**
 * Zoom levels. "time" zooms place things at their exact time;
 * "bins" zooms group them by day (Week) or by week (Quarter).
 */
export const ZOOMS = {
  hours: { label: 'Hours', mode: 'time', pxh: 150, night: 40, back: 3, ahead: 14 },
  day: { label: 'Day', mode: 'time', pxh: 78, night: 40, back: 7, ahead: 30 },
  week: { label: 'Week', mode: 'bins', bin: 'day', binW: 200, back: 14, ahead: 42 },
  quarter: { label: 'Quarter', mode: 'bins', bin: 'week', binW: 150, back: 28, ahead: 98 },
};

/** Width of one day in a time zoom. */
export const dayWidth = (z) => AWAKE * z.pxh + z.night;

/** The first day drawn for a zoom (Quarter starts on a Monday). */
export function rangeStart(z, today = startOfDay()) {
  const d = addDays(today, -z.back);
  if (z.bin === 'week') return mondayOf(d);
  return d;
}

/** First day of the week containing d (Monday, or Sunday if the account says so). */
export function mondayOf(d) {
  return startOfWeek(d);
}

/** Horizontal position of a moment, in px from the start of the range. */
export function xOf(date, z, start) {
  const d = new Date(date);
  if (z.mode === 'bins') {
    const days = (startOfDay(d) - start) / 86400000;
    const frac = (d.getHours() + d.getMinutes() / 60) / 24;
    const perDay = z.bin === 'day' ? z.binW : z.binW / 7;
    return (Math.round(days) + frac) * perDay;
  }
  const dayIndex = Math.round((startOfDay(d) - start) / 86400000);
  const h = d.getHours() + d.getMinutes() / 60;
  const base = dayIndex * dayWidth(z);
  if (h < DAY_START) {
    // early morning sits in the previous day's night band
    return base - z.night + (z.night * (h + 24 - DAY_END)) / (24 - AWAKE);
  }
  if (h <= DAY_END) return base + (h - DAY_START) * z.pxh;
  return base + AWAKE * z.pxh + (z.night * (h - DAY_END)) / (24 - AWAKE);
}

/** Total width of the range. */
export function rangeWidth(z, start) {
  const days = z.back + z.ahead + (z.bin === 'week' ? 7 : 1);
  if (z.mode === 'bins') return z.bin === 'day' ? days * z.binW : Math.ceil(days / 7) * z.binW;
  void start;
  return days * dayWidth(z);
}

/** The moment a task or meeting happens on the river. */
export function momentOf(t) {
  if (!t.deadline) return null;
  const d = new Date(t.deadline);
  if (t.startTime) {
    const [h, m] = t.startTime.split(':').map(Number);
    d.setHours(h, m || 0, 0, 0);
  }
  return d;
}

/** A meeting is a task with a start time. */
export const isMeeting = (t) => !!(t.deadline && t.startTime);

/** End of a meeting. */
export function endOf(t) {
  const s = momentOf(t);
  const span = spanOf(t);
  if (!s || !span) return s;
  const e = new Date(s);
  e.setHours(0, 0, 0, 0);
  e.setMinutes(Math.round(span.end * 60));
  return e;
}

/** Untimed deadlines (saved as 23:59) are shown at the end of the awake day. */
export function dueMomentOf(t) {
  const d = momentOf(t);
  if (!d) return null;
  if (!t.startTime && d.getHours() === 23 && d.getMinutes() === 59) {
    const x = new Date(d);
    x.setHours(DAY_END, 0, 0, 0);
    return x;
  }
  return d;
}

export const isAllDay = (t) => {
  if (!t.deadline || t.startTime) return false;
  const d = new Date(t.deadline);
  return d.getHours() === 23 && d.getMinutes() === 59;
};

/** "5 pm", "5:30 pm" */
export function clock(date) {
  const d = new Date(date);
  const h = d.getHours();
  const m = d.getMinutes();
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${hh}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h < 12 ? 'am' : 'pm'}`;
}

/** "5–6 pm", "11:00–11:45 am", "11 am–1 pm" */
export function clockRange(a, b) {
  const pa = clock(a);
  const pb = clock(b);
  if (pa.slice(-2) === pb.slice(-2)) return `${pa.slice(0, -3)}–${pb}`;
  return `${pa}–${pb}`;
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** "Today", "Tomorrow", "Yesterday", "Thu", "12 Oct" */
export function dayWord(date) {
  const n = Math.round((startOfDay(date) - startOfDay()) / 86400000);
  if (n === 0) return 'Today';
  if (n === 1) return 'Tomorrow';
  if (n === -1) return 'Yesterday';
  if (n > 1 && n < 7) return DAY_NAMES[new Date(date).getDay()];
  return new Date(date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

/** "in 20 min", "in 3 h", "2 h ago", "tomorrow" */
export function fromNow(date) {
  const diff = new Date(date).getTime() - Date.now();
  const abs = Math.abs(diff);
  const min = Math.round(abs / 60000);
  const fmt = min < 60 ? `${Math.max(min, 1)} min` : min < 60 * 24 ? `${Math.round(min / 60)} h` : `${Math.round(min / 1440)} d`;
  return diff >= 0 ? `in ${fmt}` : `${fmt} ago`;
}

/** Puts overlapping items into rows: each gets .row; returns the number of rows used. */
export function stack(items, gap = 6) {
  const ends = [];
  const sorted = [...items].sort((a, b) => a.x - b.x);
  for (const it of sorted) {
    let row = ends.findIndex((e) => e + gap <= it.x);
    if (row === -1) { row = ends.length; ends.push(0); }
    ends[row] = it.x + it.w;
    it.row = row;
  }
  return Math.max(ends.length, 1);
}

/** Tags that colour a meeting: focus time, personal, or a regular meeting. */
export function kindOf(t) {
  const tags = (Array.isArray(t.todoTags) ? t.todoTags : []).map((x) => x.toLowerCase());
  if (tags.some((x) => ['focus', 'deep', 'deepwork', 'study'].includes(x)) || /^focus\b/i.test(t.text)) return 'focus';
  if (tags.some((x) => ['personal', 'gym', 'family', 'health', 'home'].includes(x))) return 'personal';
  return 'meet';
}

/**
 * Reads times out of a capture line: "Design crit 3pm", "standup at 9:30",
 * "roadmap review 5-6pm", "call 17:00". Returns the line without them.
 */
export function parseTimes(text) {
  let start = null;
  let end = null;
  const to24 = (h, m, ap) => {
    let hh = Number(h);
    if (ap) {
      const pm = /p/i.test(ap);
      if (pm && hh < 12) hh += 12;
      if (!pm && hh === 12) hh = 0;
    }
    return `${String(hh).padStart(2, '0')}:${String(Number(m || 0)).padStart(2, '0')}`;
  };
  let out = ` ${text} `;
  out = out.replace(/\s(?:at\s|from\s)?(\d{1,2})(?::(\d{2}))?\s?(am|pm)?\s?(?:-|–|to)\s?(\d{1,2})(?::(\d{2}))?\s?(am|pm)\b/i, (m, h1, m1, ap1, h2, m2, ap2) => {
    start = to24(h1, m1, ap1 || ap2);
    end = to24(h2, m2, ap2);
    return ' ';
  });
  if (!start) {
    out = out.replace(/\s(?:at\s)?(\d{1,2})(?::(\d{2}))?\s?(am|pm)\b/i, (m, h, mm, ap) => { start = to24(h, mm, ap); return ' '; });
  }
  if (!start) {
    out = out.replace(/\s(?:at\s)?([01]?\d|2[0-3]):([0-5]\d)\b/, (m, h, mm) => { start = to24(h, mm); return ' '; });
  }
  if (start && !end) {
    const [h, m] = start.split(':').map(Number);
    end = `${String(Math.min(h + 1, 23)).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
  return { text: out.replace(/\s+/g, ' ').trim(), startTime: start, endTime: end };
}

export const tagsOfTask = (t) => (Array.isArray(t?.todoTags) ? t.todoTags : []);

export const initialsOf = (name) => {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length || name === 'You') return 'Y';
  return (parts[0][0] + (parts[1]?.[0] || '')).toUpperCase();
};

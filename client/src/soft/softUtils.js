// Small helpers shared by the Soft Studio screens.

export const TONES = ['peach', 'mint', 'butter', 'lilac', 'sky'];
const FIXED = { inbox: 'butter', exams: 'peach', exam: 'peach', ideas: 'mint', idea: 'mint', reading: 'lilac', internship: 'sky', work: 'sky', college: 'lilac', personal: 'mint', ai: 'lilac' };

/** Each tag always gets the same pastel. */
export function toneOf(tag) {
  if (!tag) return 'butter';
  const key = tag.toLowerCase();
  if (FIXED[key]) return FIXED[key];
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return TONES[h % TONES.length];
}
/** A task's tags (the API returns them as todoTags). */
export const tagsOf = (t) => (Array.isArray(t?.todoTags) ? t.todoTags : Array.isArray(t?.tags) ? t.tags : []);

export const toneVar = (tone) => `var(--s-${tone})`;

export function startOfDay(d = new Date()) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
export function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
export function sameDay(a, b) {
  return startOfDay(a).getTime() === startOfDay(b).getTime();
}
export function daysFromToday(d) {
  return Math.round((startOfDay(d) - startOfDay()) / 86400000);
}

/** "19:00", or '' for tasks with no real time. */
export function timeOf(t) {
  if (t.startTime) return t.startTime;
  if (!t.deadline) return '';
  const d = new Date(t.deadline);
  if (d.getHours() === 23 && d.getMinutes() === 59) return '';
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
}

/** Start and end hour (decimal) of a task on the day view. */
export function spanOf(t) {
  const toHours = (s) => { const [h, m] = s.split(':').map(Number); return h + (m || 0) / 60; };
  let start;
  if (t.startTime) start = toHours(t.startTime);
  else if (t.deadline) { const d = new Date(t.deadline); start = d.getHours() + d.getMinutes() / 60; }
  else return null;
  let end = t.endTime ? toHours(t.endTime) : start + (t.priority === 'high' ? 1.5 : 1);
  if (end <= start) end = start + 1;
  return { start, end };
}

export const weekdayShort = (d) => new Date(d).toLocaleDateString('en-GB', { weekday: 'short' });
export const weekdayLong = (d) => new Date(d).toLocaleDateString('en-GB', { weekday: 'long' });

/** "Mon", "Tomorrow", "Today" or "12 Oct" for a deadline chip. */
export function dayChip(d) {
  const n = daysFromToday(d);
  if (n === 0) return 'Today';
  if (n === 1) return 'Tomorrow';
  if (n === -1) return 'Yesterday';
  if (n > 1 && n < 7) return weekdayShort(d);
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

/** "20 min ago", "2 hours ago", "Yesterday", "Thursday", "12 Sep". */
export function relTime(date) {
  const d = new Date(date);
  const diff = Date.now() - d.getTime();
  if (diff < 60000) return 'Just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)} min ago`;
  if (sameDay(d, new Date())) { const h = Math.floor(diff / 3600000); return `${h} hour${h === 1 ? '' : 's'} ago`; }
  const n = -daysFromToday(d);
  if (n === 1) return 'Yesterday';
  if (n < 7) return weekdayLong(d);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
export const numberWord = (n) => (n < WORDS.length ? WORDS[n] : String(n));

export function snippetOf(content, max = 90) {
  return (content || '')
    .replace(/^\s*\|?[\s:|-]+\|[\s:|-]*$/gm, ' ')
    .replace(/\|/g, ' ')
    .replace(/[#*_~`>]/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

export const firstNameOf = (user) => {
  const n = (user?.name || '').trim();
  return n && n !== 'You' ? n.split(' ')[0] : '';
};

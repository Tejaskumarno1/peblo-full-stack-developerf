// Helpers for the extra details a task can carry (task.meta): subtasks, estimate, colour label, "waits for", status.
import { parseTask } from '../utils/parseTask.js';
import { tagsOfTodo } from './orbitUtils.js';

export const LABELS = ['red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink'];
export const LABEL_HEX = { red: '#e5484d', orange: '#f76b15', yellow: '#d9a400', green: '#30a46c', teal: '#12a594', blue: '#3e63dd', purple: '#8e4ec6', pink: '#d6409f' };
/** A day with more than this many planned minutes is flagged as too much. */
export const DAY_LIMIT_MIN = 480;

export const metaOf = (t) => (t && t.meta && typeof t.meta === 'object' ? t.meta : {});
export const subProgress = (t) => {
  const s = metaOf(t).subtasks || [];
  return { done: s.filter((x) => x.done).length, total: s.length };
};
/** Open tasks this one waits for. */
export const blockersOf = (t, all) => (metaOf(t).dependsOn || []).map((id) => all.find((x) => x.id === id)).filter((x) => x && !x.completed);
export const isBlocked = (t, all) => !t.completed && blockersOf(t, all).length > 0;
export const plannedMinutes = (items) => items.reduce((m, t) => m + (t.completed ? 0 : metaOf(t).estimateMin || 0), 0);

export function minutesLabel(m) {
  if (!m) return '';
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return `${h} h${m % 60 ? ` ${m % 60} min` : ''}`;
}

/** Where a task sits on the board: 'todo' | 'doing' | 'done'. */
export const columnOf = (t) => (t.completed ? 'done' : metaOf(t).status === 'doing' ? 'doing' : 'todo');

/** The status of an assignment: 'not-started' | 'in-progress' | 'submitted'. */
export const assignmentStatus = (t) => (t.completed ? 'submitted' : metaOf(t).astatus === 'in-progress' || metaOf(t).status === 'doing' ? 'in-progress' : 'not-started');

const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };

/**
 * Open tasks in the order Peblo would do them: overdue and today first, then priority, then how weak the topic is.
 * Returns [{ task, score, why: string[] }]; blocked tasks and the ids in `skip` are left out.
 */
export function rankTasks(todos, mastery, skip = [], now = new Date()) {
  const today = startOfDay(now);
  const out = [];
  for (const t of todos) {
    if (t.completed || skip.includes(t.id) || isBlocked(t, todos)) continue;
    let score = 0;
    const why = [];
    if (t.deadline) {
      const days = Math.round((startOfDay(t.deadline) - today) / 86400000);
      if (days < 0) { score += 60 + Math.min(-days, 10); why.push('overdue'); } else if (days === 0) { score += 50; why.push('due today'); } else if (days === 1) { score += 30; why.push('due tomorrow'); } else if (days <= 7) { score += 12 - days; why.push(`due in ${days} days`); }
    }
    if (t.priority === 'high') { score += 20; why.push('high priority'); } else if (t.priority === 'medium' || !t.priority) score += 6;
    const topic = tagsOfTodo(t)[0];
    if (topic) {
      const s = mastery?.get?.(topic)?.score;
      if (s === undefined || s === null) { score += 6; } else if (s < 50) { score += 14; why.push(`${topic} is weak (${s}%)`); } else if (s < 80) score += 5;
    }
    const est = metaOf(t).estimateMin;
    if (est && est <= 20) { score += 2; why.push(`quick (${est} min)`); }
    if (metaOf(t).status === 'doing') { score += 8; why.push('already started'); }
    out.push({ task: t, score, why });
  }
  return out.sort((a, b) => b.score - a.score || new Date(a.task.deadline || 8.64e15) - new Date(b.task.deadline || 8.64e15));
}

const SHORT_DAYS = { mon: 'monday', tue: 'tuesday', tues: 'tuesday', wed: 'wednesday', thu: 'thursday', thur: 'thursday', thurs: 'thursday', fri: 'friday', sat: 'saturday', sun: 'sunday' };

/**
 * "+1d", "+2w", "+1m", "+3", "tomorrow", "next mon", "fri", "next week", "2026-10-21", "oct 21" -> a Date at local midnight, or null.
 */
export function parseDateShortcut(input, now = new Date()) {
  const s = String(input || '').trim().toLowerCase();
  if (!s) return null;
  const base = startOfDay(now);
  let m = s.match(/^\+\s*(\d{1,3})\s*(d|days?|w|wks?|weeks?|m|mo|months?)?$/);
  if (m) {
    const n = Number(m[1]);
    const unit = (m[2] || 'd')[0];
    const d = new Date(base);
    if (unit === 'w') d.setDate(d.getDate() + n * 7);
    else if (unit === 'm') d.setMonth(d.getMonth() + n);
    else d.setDate(d.getDate() + n);
    return d;
  }
  if (/^next\s+week$/.test(s)) {
    const d = new Date(base);
    d.setDate(d.getDate() + (8 - (d.getDay() || 7)));
    return d;
  }
  const expanded = s.replace(/\b(mon|tues?|wed|thu(?:rs?)?|fri|sat|sun)\b/g, (w) => SHORT_DAYS[w]);
  const p = parseTask(` ${expanded}`, now);
  return p.deadline ? startOfDay(p.deadline) : null;
}

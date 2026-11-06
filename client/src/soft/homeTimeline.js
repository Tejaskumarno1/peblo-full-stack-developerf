// Today on Home as a timeline: tasks with a time in order, and a "Now" marker that says how long you are free.
export const minutesOf = (hhmm) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm || '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

/**
 * tasks: open tasks for today. timeOf: (task) => 'HH:MM' | ''. nowMin: minutes since midnight.
 * Returns rows in display order: { type: 'task', task, min } and one { type: 'now', until } (until = next timed task, or null).
 */
export function buildTimeline(tasks, timeOf, nowMin) {
  const timed = [];
  const loose = [];
  for (const t of tasks) {
    const min = minutesOf(timeOf(t));
    (min === null ? loose : timed).push({ type: 'task', task: t, min });
  }
  timed.sort((a, b) => a.min - b.min);
  const past = timed.filter((r) => r.min <= nowMin);
  const next = timed.filter((r) => r.min > nowMin);
  const now = { type: 'now', until: next.length ? next[0].min : null };
  return [...past, now, ...next, ...loose.map((r) => ({ ...r, min: null }))];
}
export const hhmm = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

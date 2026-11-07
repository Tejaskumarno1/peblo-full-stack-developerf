// Home widgets: habit streaks, focus minutes per day, and the shutdown ritual. Pure functions so they can be tested.
export const dkey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const lastDays = (n, from = new Date()) => Array.from({ length: n }, (_, i) => { const d = new Date(from.getFullYear(), from.getMonth(), from.getDate() - (n - 1 - i)); return d; });

/** Days in a row a habit was done, counting back from today (today not done yet does not break the run). */
export function habitStreak(habit, today = new Date()) {
  let n = 0; const d = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  if (!habit.days?.[dkey(d)]) d.setDate(d.getDate() - 1);
  while (habit.days?.[dkey(d)]) { n += 1; d.setDate(d.getDate() - 1); }
  return n;
}
export const toggleHabitDay = (habit, key) => { const days = { ...(habit.days || {}) }; if (days[key]) delete days[key]; else days[key] = 1; return { ...habit, days }; };
/** Keep only the last 120 days of each habit so the setting stays small. */
export function pruneHabits(habits, today = new Date()) {
  const min = dkey(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 120));
  return habits.map((h) => ({ ...h, days: Object.fromEntries(Object.entries(h.days || {}).filter(([k]) => k >= min)) }));
}
/** Share of habit-days done in the last 7 days, 0 to 100. */
export function habitWeekPercent(habits, today = new Date()) {
  if (!habits.length) return 0;
  const days = lastDays(7, today); let done = 0;
  for (const h of habits) for (const d of days) if (h.days?.[dkey(d)]) done += 1;
  return Math.round((done / (habits.length * 7)) * 100);
}
/** Minutes of focus per day from the time logged on tasks (meta.timeLog). */
export function focusByDay(todos, days) {
  const out = days.map(() => 0);
  const idx = new Map(days.map((d, i) => [dkey(d), i]));
  for (const t of todos) for (const [k, m] of Object.entries(t.meta?.timeLog || {})) if (idx.has(k)) out[idx.get(k)] += Number(m) || 0;
  return out;
}
export const hm = (min) => { const h = Math.floor(min / 60); const m = min % 60; return h ? `${h} h ${m ? m + ' min' : ''}`.trim() : `${m} min`; };

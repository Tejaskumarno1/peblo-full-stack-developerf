/** @param {Date} date */
export function toDateKey(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d.toISOString().split('T')[0];
}

/**
 * Build per-day activity from note created/updated timestamps.
 * @param {{ createdAt: Date, updatedAt: Date }[]} notes
 */
export function buildDailyActivity(notes) {
  const dayMap = {};

  const ensureDay = (key) => {
    if (!dayMap[key]) {
      dayMap[key] = { date: key, created: 0, updated: 0, total: 0 };
    }
    return dayMap[key];
  };

  for (const note of notes) {
    const createdKey = toDateKey(note.createdAt);
    const createdDay = ensureDay(createdKey);
    createdDay.created += 1;
    createdDay.total += 1;

    const updatedKey = toDateKey(note.updatedAt);
    if (updatedKey !== createdKey) {
      const updatedDay = ensureDay(updatedKey);
      updatedDay.updated += 1;
      updatedDay.total += 1;
    }
  }

  return dayMap;
}

/**
 * @param {Record<string, { total: number }>} dayMap
 */
export function calculateStreakStats(dayMap) {
  const activeDates = Object.keys(dayMap)
    .filter((key) => dayMap[key].total > 0)
    .sort();

  const activeSet = new Set(activeDates);
  const activeDays = activeDates.length;

  let longest = 0;
  let run = 0;
  for (let i = 0; i < activeDates.length; i++) {
    if (i === 0) {
      run = 1;
    } else {
      const prev = new Date(activeDates[i - 1] + 'T12:00:00');
      const curr = new Date(activeDates[i] + 'T12:00:00');
      prev.setDate(prev.getDate() + 1);
      run = prev.getTime() === curr.getTime() ? run + 1 : 1;
    }
    longest = Math.max(longest, run);
  }

  let current = 0;
  const cursor = new Date();
  cursor.setHours(0, 0, 0, 0);
  const todayKey = toDateKey(cursor);
  if (!activeSet.has(todayKey)) {
    cursor.setDate(cursor.getDate() - 1);
  }
  while (activeSet.has(toDateKey(cursor))) {
    current += 1;
    cursor.setDate(cursor.getDate() - 1);
  }

  const weekdayTotals = [0, 0, 0, 0, 0, 0, 0];
  const weekdayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  for (const key of activeDates) {
    const day = new Date(key + 'T12:00:00').getDay();
    weekdayTotals[day] += dayMap[key].total;
  }
  const maxWeekday = weekdayTotals.indexOf(Math.max(...weekdayTotals));
  const mostActiveDay = activeDays > 0 ? weekdayNames[maxWeekday] : '—';

  const recentActiveDates = [...activeDates]
    .reverse()
    .slice(0, 4)
    .map((key) => {
      const d = new Date(key + 'T12:00:00');
      return {
        date: key,
        label: d.toLocaleDateString('en', { month: 'short', day: 'numeric' }),
      };
    });

  return { current, longest, activeDays, mostActiveDay, recentActiveDates };
}

/** Last 53 weeks of daily activity (GitHub-style grid). */
export function buildYearHeatmap(dayMap) {
  const end = new Date();
  end.setHours(0, 0, 0, 0);

  const start = new Date(end);
  start.setDate(start.getDate() - 364);
  while (start.getDay() !== 0) {
    start.setDate(start.getDate() - 1);
  }

  const days = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    const key = toDateKey(cursor);
    const entry = dayMap[key] || { date: key, created: 0, updated: 0, total: 0 };
    days.push({
      date: key,
      created: entry.created,
      updated: entry.updated,
      total: entry.total,
      dayOfWeek: cursor.getDay(),
    });
    cursor.setDate(cursor.getDate() + 1);
  }

  const weeks = [];
  for (let i = 0; i < days.length; i += 7) {
    weeks.push(days.slice(i, i + 7));
  }

  return weeks;
}

export function getEditsThisMonth(dayMap) {
  const now = new Date();
  const month = now.getMonth();
  const year = now.getFullYear();
  return Object.entries(dayMap).reduce((sum, [key, day]) => {
    const d = new Date(key + 'T12:00:00');
    if (d.getMonth() === month && d.getFullYear() === year) {
      return sum + day.total;
    }
    return sum;
  }, 0);
}

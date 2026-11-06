// Weekly review and inbox triage: what needs a look, and the dates the buttons set. No browser needed, so it is tested.

const midnight = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const eod = (d) => { const x = midnight(d); x.setHours(23, 59, 0, 0); return x; };
const plus = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

/** Open tasks sorted into the three piles a review walks through. */
export function reviewBuckets(todos, now = new Date()) {
  const today = midnight(now);
  const week = plus(today, 7);
  const open = todos.filter((t) => !t.completed);
  const overdue = open.filter((t) => t.deadline && midnight(t.deadline) < today).sort((a, b) => new Date(a.deadline) - new Date(b.deadline));
  const undated = open.filter((t) => !t.deadline);
  const upcoming = open.filter((t) => t.deadline && midnight(t.deadline) >= today && midnight(t.deadline) < week).sort((a, b) => new Date(a.deadline) - new Date(b.deadline));
  const weekAgo = plus(today, -7);
  const doneRecently = todos.filter((t) => t.completed && (t.completedAt || t.updatedAt) && new Date(t.completedAt || t.updatedAt) >= weekAgo).length;
  return { overdue, undated, upcoming, doneRecently };
}

/** The deadline a triage button sets: today, tomorrow or next Monday, all as an all-day time (23:59). */
export function triageDate(kind, now = new Date()) {
  if (kind === 'today') return eod(now);
  if (kind === 'tomorrow') return eod(plus(now, 1));
  if (kind === 'nextweek') {
    const d = midnight(now);
    const add = ((8 - d.getDay()) % 7) || 7; // next Monday, never today
    return eod(plus(d, add));
  }
  return null;
}

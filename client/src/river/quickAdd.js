// A meeting added by double-click in the River lasts an hour, but never runs past midnight
// (a 23:30 meeting used to end at "00:30", before it started).
export const MIN_QUICK_MINUTES = 15;

export function quickMeetingTimes(at) {
  const dayEnd = new Date(at);
  dayEnd.setHours(23, 59, 0, 0);
  let end = new Date(at.getTime() + 3600000);
  if (end > dayEnd) end = dayEnd;
  let start = new Date(at);
  // too close to midnight for a real meeting: pull the start back so it is never zero-length
  if (end.getTime() - start.getTime() < MIN_QUICK_MINUTES * 60000) {
    start = new Date(end.getTime() - MIN_QUICK_MINUTES * 60000);
  }
  return { start, end };
}

const hhmm = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
export const timeOfDay = hhmm;

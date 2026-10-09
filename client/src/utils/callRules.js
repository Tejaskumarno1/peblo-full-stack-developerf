// Rules for the AI voice call: when it rings, what it reads out. Pure functions so they can be tested.

export const CALL_LEAD_HOURS = 2.1;       // ring up to this long before a deadline
export const NEW_TASK_GRACE_MIN = 30;     // do not ring for a task that was only just added
export const BRIEFING_FROM = 7 * 60 + 30; // morning briefing window, minutes after midnight
export const BRIEFING_UNTIL = 11 * 60;

// Calls are on unless the person turned them off in Settings.
export const callsEnabled = (settings) => settings?.voiceCalls !== false;

// All-day tasks are stored at 23:59 with no start time.
export const isAllDayTask = (t) => {
  if (!t?.deadline || t.startTime) return false;
  const d = new Date(t.deadline);
  return d.getHours() === 23 && d.getMinutes() === 59;
};

const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

// Should this task trigger a "deadline is close" call right now?
export function shouldRing(task, now = new Date(), called = {}) {
  if (!task || task.completed || !task.deadline || called[task.id]) return false;
  if (isAllDayTask(task)) return false; // no real time to be close to
  const hoursLeft = (new Date(task.deadline).getTime() - now.getTime()) / 3600000;
  if (!(hoursLeft > 0 && hoursLeft <= CALL_LEAD_HOURS)) return false;
  if (task.createdAt) {
    const ageMin = (now.getTime() - new Date(task.createdAt).getTime()) / 60000;
    if (ageMin >= 0 && ageMin < NEW_TASK_GRACE_MIN) return false;
  }
  return true;
}

// Is the morning briefing due? Once a day, any time in the window (so a late start still gets it).
export function briefingDue(now = new Date(), lastDateStr = '') {
  const m = now.getHours() * 60 + now.getMinutes();
  return m >= BRIEFING_FROM && m < BRIEFING_UNTIL && lastDateStr !== now.toDateString();
}

// What the briefing covers: open tasks that are undated, due today, or overdue.
export function briefingTasks(all, now = new Date()) {
  return (all || []).filter((t) => {
    if (!t || t.completed) return false;
    if (!t.deadline) return true;
    const d = new Date(t.deadline);
    return sameDay(d, now) || d < now;
  });
}

const clock = (d) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

// How a task's time is read out or shown.
export function spokenWhen(task, now = new Date()) {
  if (!task?.deadline) return 'no specific time';
  const d = new Date(task.deadline);
  if (isAllDayTask(task)) return sameDay(d, now) ? 'today' : `on ${d.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' })}`;
  if (d.getHours() === 0 && d.getMinutes() === 0) return 'no specific time';
  return `at ${clock(d)}`;
}

// The opening speech. Only a real morning briefing says "Good morning".
export function introText(callType, tasks, now = new Date()) {
  const open = (tasks || []).filter((t) => !t.completed);
  if (callType === 'upcoming_task' && open.length > 0) {
    const t = open[0];
    return `Hello! This is a reminder for your upcoming task: ${t.text}. The deadline is ${spokenWhen(t, now)}. `;
  }
  const greeting = callType === 'morning_briefing' ? 'Good morning!' : 'Hello!';
  let s = `${greeting} You have ${open.length} ${open.length === 1 ? 'task' : 'tasks'} on your list. `;
  if (open.length > 0) {
    s += 'Here is your agenda. ';
    open.forEach((t, i) => { s += `Task ${i + 1}: ${t.text}, ${spokenWhen(t, now)}. `; });
  } else {
    s += 'You have a free schedule! ';
  }
  return s;
}

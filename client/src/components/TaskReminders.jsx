import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { todosAPI } from '../api';
import '../soft/tasks2.css';

/**
 * Rings a task's reminder (set in the task sheet under "Remind me") and lets the person snooze it:
 * 10 minutes, 1 hour, tonight, or tomorrow morning. Checks every 20 seconds while Peblo is open.
 * Tasks with a meeting link are left to the meeting reminders.
 */
const KEY = 'peblo-reminders-rung';
const read = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; } };
const mark = (k) => { try { const m = read(); m[k] = Date.now(); for (const x of Object.keys(m)) if (Date.now() - m[x] > 7 * 864e5) delete m[x]; localStorage.setItem(KEY, JSON.stringify(m)); } catch { /* storage blocked */ } };

export function ringTime(t) {
  const m = t.meta || {};
  if (t.completed || !t.deadline || typeof m.remindMin !== 'number' || m.link) return null;
  const due = new Date(t.deadline).getTime();
  const base = due - m.remindMin * 60000;
  const snooze = m.snoozeUntil ? new Date(m.snoozeUntil).getTime() : 0;
  return Math.max(base, snooze);
}

/** When the next meeting (a task with a start and an end time that is not a planned block) finishes, or null when none is coming up. */
export function nextMeetingEnd(todos, now = Date.now()) {
  let best = null;
  for (const t of todos) {
    if (t.completed || !t.deadline || !t.startTime || !t.endTime || t.meta?.planned) continue;
    const [h, m] = String(t.endTime).split(':').map(Number);
    if (Number.isNaN(h) || Number.isNaN(m)) continue;
    const end = new Date(t.deadline); end.setHours(h, m, 0, 0);
    if (end.getTime() > now && (!best || end < best)) best = end;
  }
  return best;
}

export default function TaskReminders() {
  const queryClient = useQueryClient();
  const { data: todos = [] } = useQuery({ queryKey: ['todos', 'all'], queryFn: () => todosAPI.getAll().then((r) => r.data.todos || []), staleTime: 15000, refetchInterval: 60000 });
  const [ringing, setRinging] = useState(null);
  const todosRef = useRef(todos);
  todosRef.current = todos;

  useEffect(() => {
    const check = () => {
      if (ringing) return;
      const now = Date.now();
      const rung = read();
      for (const t of todosRef.current) {
        const at = ringTime(t);
        if (at === null || at > now) continue;
        const due = new Date(t.deadline).getTime();
        if (now > due + 6 * 3600000) continue; // too old to be useful
        const key = `${t.id}:${at}`;
        if (rung[key]) continue;
        mark(key);
        setRinging(t);
        try { if ('Notification' in window && Notification.permission === 'granted') new Notification('Reminder', { body: t.text }); } catch { /* not allowed */ }
        break;
      }
    };
    check();
    const timer = setInterval(check, 20000);
    return () => clearInterval(timer);
  }, [ringing, todos]);

  if (!ringing) return null;
  const t = ringing;
  const refresh = () => { queryClient.invalidateQueries({ queryKey: ['todos'] }); queryClient.invalidateQueries({ queryKey: ['dashboard'] }); };
  const snooze = async (until) => {
    setRinging(null);
    try { await todosAPI.update(t.id, { meta: { snoozeUntil: until.toISOString() } }); } catch { /* try again next time */ }
    refresh();
  };
  const inMin = (n) => new Date(Date.now() + n * 60000);
  const tonight = () => { const d = new Date(); d.setHours(20, 0, 0, 0); return d.getTime() > Date.now() + 5 * 60000 ? d : inMin(180); };
  const tomorrow = () => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); return d; };
  const meetingEnd = nextMeetingEnd(todos);
  const done = async () => { setRinging(null); try { await todosAPI.update(t.id, { completed: true }); } catch { /* ignore */ } refresh(); };
  const when = new Date(t.deadline).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return (
    <div className="pb-ring" role="alertdialog" aria-label="Task reminder" data-testid="task-ring">
      <div className="head"><b>Reminder</b><span>{when}</span></div>
      <div className="what">{t.text}</div>
      <div className="row">
        <button type="button" className="go" onClick={done}>Done</button>
        <button type="button" onClick={() => snooze(inMin(10))}>Snooze 10 min</button>
        <button type="button" onClick={() => snooze(inMin(60))}>1 hour</button>
        <button type="button" onClick={() => snooze(tonight())}>Tonight</button>
        <button type="button" onClick={() => snooze(tomorrow())}>Tomorrow morning</button>
        {meetingEnd && <button type="button" data-testid="snooze-meeting" onClick={() => snooze(new Date(meetingEnd.getTime() + 60000))}>After my next meeting</button>}
        <button type="button" className="quiet" onClick={() => setRinging(null)}>Dismiss</button>
      </div>
    </div>
  );
}

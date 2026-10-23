// Calendar files (.ics): export the river's meetings and tasks, import meetings from Google Calendar, Outlook, Apple Calendar.
import { todosAPI } from '../api';
import { startOfDay, addDays, isMeeting, momentOf, endOf } from './riverUtils';

const pad = (n) => String(n).padStart(2, '0');
const local = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`;
const utc = (d) => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
const esc = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
const RULES = { daily: 'FREQ=DAILY', weekdays: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', weekly: 'FREQ=WEEKLY', monthly: 'FREQ=MONTHLY', yearly: 'FREQ=YEARLY' };

export function buildIcs(todos) {
  const out = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Peblo//River//EN', 'CALSCALE:GREGORIAN'];
  const seen = new Set();
  for (const t of todos) {
    if (!t.deadline || t.completed) continue;
    const key = (t.seriesId || t.id) + (t.seriesId ? '' : ':' + t.deadline);
    if (t.seriesId && seen.has(t.seriesId)) continue;
    if (t.seriesId) seen.add(t.seriesId);
    if (isMeeting(t)) {
      const s = momentOf(t);
      const e = endOf(t) || new Date(s.getTime() + 3600000);
      out.push('BEGIN:VEVENT', `UID:${key}@peblo`, `DTSTAMP:${utc(new Date())}`, `DTSTART:${local(s)}`, `DTEND:${local(e)}`, `SUMMARY:${esc(t.text)}`);
      if (t.meta?.link) out.push(`URL:${t.meta.link}`, `LOCATION:${esc(t.meta.link)}`);
      const who = t.meta?.attendees || [];
      if (who.length) out.push(`DESCRIPTION:${esc('With ' + who.join(', '))}`);
      if (t.recurrence && RULES[t.recurrence]) out.push(`RRULE:${RULES[t.recurrence]}`);
      if (t.meta?.remindMin) out.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(t.text)}`, `TRIGGER:-PT${t.meta.remindMin}M`, 'END:VALARM');
      out.push('END:VEVENT');
    } else {
      const d = new Date(t.deadline);
      out.push('BEGIN:VTODO', `UID:${key}@peblo`, `DTSTAMP:${utc(new Date())}`, `DUE:${local(d)}`, `SUMMARY:${esc(t.text)}`, `PRIORITY:${t.priority === 'high' ? 1 : t.priority === 'low' ? 9 : 5}`, 'END:VTODO');
    }
  }
  out.push('END:VCALENDAR');
  return out.join('\r\n') + '\r\n';
}

/** Downloads every meeting and dated task from a month ago to a year ahead. */
export async function exportCalendar() {
  const from = addDays(startOfDay(), -30);
  const { data } = await todosAPI.getRange(from.toISOString(), addDays(from, 400).toISOString());
  const todos = data.todos || [];
  const text = buildIcs(todos);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/calendar' }));
  a.download = 'peblo-calendar.ics';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  return todos.filter((t) => t.deadline && !t.completed).length;
}

const unesc = (s) => s.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');
const LINK = /https?:\/\/[^\s<>"\\]*(?:meet\.google|teams\.microsoft|teams\.live|zoom\.us|zoom\.com|webex\.com)[^\s<>"\\]*/i;

function when(value, params) {
  if (/VALUE=DATE(?!-)/.test(params)) return null; // all-day: no clock time to put on the river
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z?)$/.exec(value);
  if (!m) return null;
  const [, y, mo, d, h, mi, s = '0', z] = m;
  return z ? new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s)) : new Date(+y, +mo - 1, +d, +h, +mi, +s);
}

export function parseIcs(text) {
  const lines = text.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '').split('\n');
  const events = [];
  let cur = null;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') { cur = {}; continue; }
    if (line === 'END:VEVENT') { if (cur && cur.start && cur.title) events.push(cur); cur = null; continue; }
    if (!cur) continue;
    const i = line.indexOf(':');
    if (i < 0) continue;
    const head = line.slice(0, i);
    const val = line.slice(i + 1);
    const [name, ...rest] = head.split(';');
    const params = rest.join(';');
    if (name === 'SUMMARY') cur.title = unesc(val).trim();
    else if (name === 'DTSTART') cur.start = when(val, params);
    else if (name === 'DTEND') cur.end = when(val, params);
    else if (name === 'URL' || name === 'LOCATION' || name === 'DESCRIPTION') { const l = LINK.exec(unesc(val)); if (l && !cur.link) cur.link = l[0]; }
    else if (name === 'RRULE') cur.rule = val;
  }
  return events;
}

const hhmm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const recurOf = (r) => (!r ? 'none' : /FREQ=DAILY/.test(r) ? 'daily' : /FREQ=WEEKLY/.test(r) ? (/BYDAY=MO,TU,WE,TH,FR/.test(r) ? 'weekdays' : 'weekly') : /FREQ=MONTHLY/.test(r) ? 'monthly' : /FREQ=YEARLY/.test(r) ? 'yearly' : 'none');

/** Puts the meetings of a .ics file on the river. Skips ones that are already there. Returns { added, skipped }. */
export async function importCalendar(file) {
  const events = parseIcs(await file.text());
  const from = addDays(startOfDay(), -30);
  const { data } = await todosAPI.getRange(from.toISOString(), addDays(from, 400).toISOString());
  const have = new Set((data.todos || []).filter(isMeeting).map((t) => t.text.toLowerCase() + '|' + momentOf(t).getTime()));
  let added = 0;
  let skipped = 0;
  for (const ev of events.slice(0, 300)) {
    const end = ev.end && ev.end > ev.start && startOfDay(ev.end).getTime() === startOfDay(ev.start).getTime() ? ev.end : new Date(ev.start.getTime() + 3600000);
    if (startOfDay(end).getTime() !== startOfDay(ev.start).getTime()) { skipped += 1; continue; }
    if (have.has(ev.title.toLowerCase() + '|' + ev.start.getTime())) { skipped += 1; continue; }
    await todosAPI.create({
      text: ev.title.slice(0, 200),
      priority: 'medium',
      deadline: startOfDay(ev.start).toISOString(),
      startTime: hhmm(ev.start),
      endTime: hhmm(end),
      recurrence: recurOf(ev.rule),
      meta: ev.link ? { link: ev.link } : undefined,
    });
    added += 1;
  }
  return { added, skipped };
}

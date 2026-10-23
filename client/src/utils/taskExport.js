// Tasks to a calendar file (.ics) and a spreadsheet file (.csv), and back from CSV. Pure functions: no browser needed.
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
const ymdHm = (d) => `${ymd(d)}T${pad(d.getHours())}${pad(d.getMinutes())}00`;
const utcStamp = (d) => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
const isoDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const icsEscape = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const PRIO = { high: 1, medium: 5, low: 9 };

/** Lines longer than 75 characters are folded onto the next line, as the calendar format requires. */
export function foldLine(line) {
  if (line.length <= 74) return line;
  const parts = [line.slice(0, 74)];
  for (let i = 74; i < line.length; i += 73) parts.push(line.slice(i, i + 73));
  return parts.join('\r\n ');
}

const toDate = (todo) => (todo.deadline ? new Date(todo.deadline) : null);
const atTime = (day, hhmm) => {
  const [h, m] = String(hhmm).split(':').map(Number);
  const d = new Date(day);
  d.setHours(h || 0, m || 0, 0, 0);
  return d;
};

/** An .ics file. Dated tasks become events (all-day when they have no time), undated ones become to-dos. */
export function tasksToIcs(tasks, now = new Date()) {
  const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Peblo//Tasks//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
  for (const t of tasks) {
    const day = toDate(t);
    const summary = `${t.completed ? '[done] ' : ''}${t.text}`;
    const tags = Array.isArray(t.todoTags) ? t.todoTags : [];
    L.push(day ? 'BEGIN:VEVENT' : 'BEGIN:VTODO');
    L.push(`UID:${t.id}@peblo`, `DTSTAMP:${utcStamp(now)}`, `SUMMARY:${icsEscape(summary)}`);
    if (tags.length) L.push(`CATEGORIES:${tags.map(icsEscape).join(',')}`);
    L.push(`PRIORITY:${PRIO[t.priority] ?? 5}`);
    if (day) {
      const allDay = !t.startTime && day.getHours() === 23 && day.getMinutes() === 59;
      if (allDay) {
        const next = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1);
        L.push(`DTSTART;VALUE=DATE:${ymd(day)}`, `DTEND;VALUE=DATE:${ymd(next)}`);
      } else {
        const start = t.startTime ? atTime(day, t.startTime) : day;
        const end = t.endTime ? atTime(day, t.endTime) : new Date(start.getTime() + 30 * 60000);
        L.push(`DTSTART:${ymdHm(start)}`, `DTEND:${ymdHm(end > start ? end : new Date(start.getTime() + 30 * 60000))}`);
      }
      L.push(`STATUS:${t.completed ? 'CANCELLED' : 'CONFIRMED'}`);
      L.push('END:VEVENT');
    } else {
      L.push(`STATUS:${t.completed ? 'COMPLETED' : 'NEEDS-ACTION'}`);
      L.push('END:VTODO');
    }
  }
  L.push('END:VCALENDAR');
  return L.map(foldLine).join('\r\n') + '\r\n';
}

// A cell that starts with = + - @ would run as a formula in a spreadsheet.
const cell = (v) => {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export const CSV_HEADER = ['Task', 'Done', 'Priority', 'Due date', 'Start', 'End', 'Topics', 'Repeats'];

export function tasksToCsv(tasks) {
  const rows = tasks.map((t) => {
    const d = toDate(t);
    return [t.text, t.completed ? 'yes' : 'no', t.priority || 'medium', d ? isoDay(d) : '', t.startTime || '', t.endTime || '', (Array.isArray(t.todoTags) ? t.todoTags : []).join(' '), t.recurrence && t.recurrence !== 'none' ? t.recurrence : ''];
  });
  return '\ufeff' + [CSV_HEADER, ...rows].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

/** Splits CSV text into rows of cells (quotes, doubled quotes and line breaks inside cells). */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cur = '';
  let q = false;
  const s = String(text || '').replace(/^\ufeff/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"' && s[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cur); cur = ''; } else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(cur); cur = '';
      if (row.some((x) => x !== '')) rows.push(row);
      row = [];
    } else cur += c;
  }
  row.push(cur);
  if (row.some((x) => x !== '')) rows.push(row);
  return rows;
}

/**
 * Reads tasks from CSV text (the columns tasksToCsv writes; extra or missing columns are fine).
 * Returns { tasks, errors } where each error names its row, so nothing is dropped silently.
 */
export function parseTasksCsv(text) {
  const rows = parseCsv(text);
  if (!rows.length) return { tasks: [], errors: ['The file is empty.'] };
  const head = rows[0].map((h) => h.trim().toLowerCase());
  const col = (...names) => head.findIndex((h) => names.includes(h));
  const iText = col('task', 'text', 'title', 'name');
  if (iText < 0) return { tasks: [], errors: ['No "Task" column found in the first row.'] };
  const iDone = col('done', 'completed');
  const iPrio = col('priority');
  const iDue = col('due date', 'due', 'deadline', 'date');
  const iStart = col('start');
  const iEnd = col('end');
  const iTags = col('topics', 'tags', 'topic');
  const tasks = [];
  const errors = [];
  rows.slice(1).forEach((r, k) => {
    const n = k + 2;
    const text = (r[iText] || '').trim();
    if (!text) { errors.push(`Row ${n}: no task text.`); return; }
    const out = { text: text.slice(0, 500) };
    const prio = iPrio >= 0 ? (r[iPrio] || '').trim().toLowerCase() : '';
    if (prio) { if (['low', 'medium', 'high'].includes(prio)) out.priority = prio; else { errors.push(`Row ${n}: priority "${prio}" is not low, medium or high.`); return; } }
    const due = iDue >= 0 ? (r[iDue] || '').trim() : '';
    if (due) {
      const m = due.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 23, 59, 0) : null;
      if (!d || Number.isNaN(d.getTime())) { errors.push(`Row ${n}: date "${due}" should look like 2026-10-21.`); return; }
      out.deadline = d.toISOString();
    }
    const time = (v) => (/^\d{1,2}:\d{2}$/.test(v) ? v.padStart(5, '0') : null);
    const st = iStart >= 0 ? time((r[iStart] || '').trim()) : null;
    const en = iEnd >= 0 ? time((r[iEnd] || '').trim()) : null;
    if (st && out.deadline) { out.startTime = st; if (en) out.endTime = en; }
    const tags = iTags >= 0 ? (r[iTags] || '').split(/[\s,;]+/).map((x) => x.replace(/^#/, '').toLowerCase()).filter(Boolean) : [];
    if (tags.length) out.tags = [...new Set(tags)];
    out.completed = iDone >= 0 && /^(yes|true|1|done|x)$/i.test((r[iDone] || '').trim());
    tasks.push(out);
  });
  return { tasks, errors };
}

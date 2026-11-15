import fs from 'node:fs';
const f = 'client/src/utils/parseTask.js';
let s = fs.readFileSync(f, 'utf8');
const crlf = s.includes('\r\n');
s = s.replace(/\r\n/g, '\n');
const a = "  const setDate = (d) => { if (!date) date = startOfDay(d); };\n";
if (!s.includes(a)) throw new Error('anchor missing');
const b = `  // --- repeat words: "every day", "daily", "every friday", "every 1st" ---
  let recurrence = 'none';
  const WD3 = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  text = text.replace(new RegExp(String.raw\`\\severy\\s+(day|weekday|week|month|year)\${END}\`, 'gi'), (_, w) => {
    recurrence = ({ day: 'daily', weekday: 'weekdays', week: 'weekly', month: 'monthly', year: 'yearly' })[w.toLowerCase()]; return ' ';
  });
  text = text.replace(new RegExp(String.raw\`\\s(daily|weekdays|weekly|monthly|yearly)\${END}\`, 'gi'), (_, w) => { recurrence = w.toLowerCase(); return ' '; });
  text = text.replace(new RegExp(String.raw\`\\severy\\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tues|tue|wed|thurs|thur|thu|fri|sat)\${END}\`, 'gi'), (_, d) => {
    recurrence = 'weekly'; return \` on \${WEEKDAYS[WD3.indexOf(d.toLowerCase().slice(0, 3))]} \`;
  });
  text = text.replace(new RegExp(String.raw\`\\severy\\s+(\\d{1,2})(?:st|nd|rd|th)\${END}\`, 'gi'), (m, d) => {
    const n = Number(d); if (n < 1 || n > 31) return m;
    recurrence = 'monthly';
    const clamp = (y, mo) => new Date(y, mo, Math.min(n, new Date(y, mo + 1, 0).getDate()));
    let dt = clamp(now.getFullYear(), now.getMonth());
    if (dt < startOfDay(now)) dt = clamp(now.getFullYear(), now.getMonth() + 1);
    if (!date) date = startOfDay(dt);
    return ' ';
  });
  // three-letter weekdays only after "on / this / next" (a bare "sat" or "sun" is too easy to mean something else)
  text = text.replace(new RegExp(String.raw\`\\s(on|this|next)\\s+(sun|mon|tues|tue|wed|thurs|thur|thu|fri|sat)\${END}\`, 'gi'), (_, pre, d) => \` \${pre} \${WEEKDAYS[WD3.indexOf(d.toLowerCase().slice(0, 3))]} \`);

`;
s = s.replace(a, b + a);
const r = "return { text: text.replace(/\\s+/g, ' ').trim(), priority, tags, deadline, allDay };";
if (!s.includes(r)) throw new Error('return missing');
s = s.replace(r, "return { text: text.replace(/\\s+/g, ' ').trim(), priority, tags, deadline, allDay, recurrence };");
if (crlf) s = s.replace(/\n/g, '\r\n');
fs.writeFileSync(f, s);
console.log('ok');

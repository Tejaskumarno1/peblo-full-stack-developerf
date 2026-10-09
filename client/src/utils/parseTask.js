// Turns "call mom tomorrow 3pm !high #family" into a task: text, due date, priority and tags.
// One parser for every UI style, so the same text always saves the same due date.
//
// Returns { text, priority, tags, deadline, allDay }.
//   deadline: Date | null. With no clock time it is 23:59 local and allDay is true.
//   Supported: today, tonight (8 pm), tomorrow, weekday names ("friday", "on friday", "this friday",
//   "next friday" = that day in NEXT week), clock times ("3pm", "3:30 pm", "15:30", "at 9", noon, midnight),
//   ISO dates (2026-10-12), month names ("Oct 12", "12 October"), !high/!low/!medium, #tags.
//   Slash dates like 12/10 are NOT parsed on purpose: day/month vs month/day is ambiguous.
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
// Not followed by more word characters, an @ or a path/domain dot ("monday.com", "friday@x.io").
const END = String.raw`(?![\w@/-]|\.\w)`;

const endOfDay = (d) => { const x = new Date(d); x.setHours(23, 59, 0, 0); return x; };
const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };

export function parseTask(input, now = new Date()) {
  let text = ` ${String(input || '').trim()} `;
  let priority = 'medium';
  const tags = [];
  let date = null; // a Date at local midnight
  let time = null; // { h, m }

  text = text.replace(/\s!(high|h|urgent|low|l|medium|med|m)\b/gi, (_, p) => {
    const v = p.toLowerCase();
    priority = v.startsWith('h') || v === 'urgent' ? 'high' : v.startsWith('l') ? 'low' : 'medium';
    return ' ';
  });
  text = text.replace(/\s#([\p{L}\p{N}_-]+)/gu, (_, t) => { tags.push(t.toLowerCase()); return ' '; });

  const setDate = (d) => { if (!date) date = startOfDay(d); };
  const setTime = (h, m) => { if (!time) time = { h, m }; };
  const today = startOfDay(now);
  const plusDays = (n) => { const d = new Date(today); d.setDate(d.getDate() + n); return d; };

  // --- clock times (first one wins, all are removed) ---
  text = text.replace(new RegExp(String.raw`\s(?:at\s)?(1[0-2]|0?[1-9])(?::([0-5]\d))?\s?(am|pm)${END}`, 'gi'), (_, h, m, ap) => {
    let hh = Number(h) % 12;
    if (ap.toLowerCase() === 'pm') hh += 12;
    setTime(hh, m ? Number(m) : 0);
    return ' ';
  });
  text = text.replace(new RegExp(String.raw`\s(?:at\s)?([01]?\d|2[0-3]):([0-5]\d)${END}`, 'g'), (_, h, m) => { setTime(Number(h), Number(m)); return ' '; });
  text = text.replace(new RegExp(String.raw`\s(noon|midnight)${END}`, 'gi'), (_, w) => { setTime(w.toLowerCase() === 'noon' ? 12 : 0, 0); return ' '; });
  text = text.replace(new RegExp(String.raw`\sat\s(1[0-2]|0?[1-9])${END}`, 'gi'), (_, h) => { setTime(Number(h), 0); return ' '; });

  // --- dates ---
  text = text.replace(new RegExp(String.raw`\s(today|tonight)${END}`, 'gi'), (_, w) => {
    setDate(today);
    if (w.toLowerCase() === 'tonight') setTime(20, 0);
    return ' ';
  });
  text = text.replace(new RegExp(String.raw`\s(tomorrow|tmrw|tmr)${END}`, 'gi'), () => { setDate(plusDays(1)); return ' '; });
  text = text.replace(new RegExp(String.raw`\s(\d{4})-(\d{2})-(\d{2})${END}`, 'g'), (m, y, mo, d) => {
    const dt = new Date(Number(y), Number(mo) - 1, Number(d));
    if (dt.getMonth() !== Number(mo) - 1) return m; // 2026-02-31 is not a date
    setDate(dt); return ' ';
  });
  const monthRe = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
  const fromMonthDay = (mon, day) => {
    const mi = MONTHS.indexOf(mon.slice(0, 3).toLowerCase());
    let dt = new Date(today.getFullYear(), mi, Number(day));
    if (dt.getMonth() !== mi) return null; // "Feb 31"
    if (dt < today) dt = new Date(today.getFullYear() + 1, mi, Number(day));
    return dt;
  };
  text = text.replace(new RegExp(String.raw`\s(?:on\s)?${monthRe}\s(\d{1,2})(?:st|nd|rd|th)?${END}`, 'gi'), (m, mon, day) => {
    const dt = fromMonthDay(mon, day); if (!dt) return m; setDate(dt); return ' ';
  });
  text = text.replace(new RegExp(String.raw`\s(?:on\s)?(\d{1,2})(?:st|nd|rd|th)?\s${monthRe}${END}`, 'gi'), (m, day, mon) => {
    const dt = fromMonthDay(mon, day); if (!dt) return m; setDate(dt); return ' ';
  });
  text = text.replace(new RegExp(String.raw`\s(on\s+|this\s+|next\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)${END}`, 'gi'), (_, pre, day) => {
    const target = WEEKDAYS.indexOf(day.toLowerCase());
    let diff;
    if (pre && /^next/i.test(pre)) {
      // that weekday in the next Monday-to-Sunday week
      const sinceMonday = (today.getDay() + 6) % 7;
      diff = (7 - sinceMonday) + ((target + 6) % 7);
    } else {
      diff = (target - today.getDay() + 7) % 7;
      if (diff === 0) diff = 7; // a bare weekday that is today means next week
    }
    setDate(plusDays(diff));
    return ' ';
  });

  // --- combine ---
  let deadline = null;
  let allDay = false;
  if (date && time) {
    deadline = new Date(date); deadline.setHours(time.h, time.m, 0, 0);
  } else if (date) {
    deadline = endOfDay(date); allDay = true;
  } else if (time) {
    deadline = new Date(today); deadline.setHours(time.h, time.m, 0, 0);
    if (deadline <= now) deadline.setDate(deadline.getDate() + 1); // "call at 9" said at 10 pm means tomorrow
  }

  return { text: text.replace(/\s+/g, ' ').trim(), priority, tags, deadline, allDay };
}

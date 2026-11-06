// Calendar quick add: turn plain words ("lunch with Sam fri 1pm for an hour") into a title, a day and a time.
// Pure functions so they can be tested without a browser.

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const DAY_RE = '(sun(?:day)?|mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:r|rs|rsday)?|fri(?:day)?|sat(?:urday)?)';
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const pad = (n) => String(n).padStart(2, '0');
const hhmm = (h, m) => `${pad(h)}:${pad(m)}`;
const midnight = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const plusDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

function clock(h, m, ap) {
  let hour = Number(h);
  const min = m ? Number(m) : 0;
  if (ap) {
    if (hour < 1 || hour > 12) return null;
    if (ap === 'pm' && hour < 12) hour += 12;
    if (ap === 'am' && hour === 12) hour = 0;
  }
  if (hour > 23 || min > 59) return null;
  return { h: hour, m: min };
}

/**
 * parseQuick("lunch with Sam fri 1pm for an hour", new Date())
 * -> { title: 'lunch with Sam', date: Date (midnight), start: '13:00', end: '14:00', chips: [...] }
 * A time with no day means today. Nothing is guessed when no day or time is found (the caller picks its own default).
 */
export function parseQuick(input, now = new Date()) {
  let text = ` ${String(input || '').trim()} `;
  const out = { title: '', date: null, start: null, end: null, dur: null, chips: [] };
  const take = (re, fn) => {
    const m = re.exec(text);
    if (!m) return false;
    if (fn(m) === false) return false;
    text = text.slice(0, m.index) + ' ' + text.slice(m.index + m[0].length);
    return true;
  };

  // Day: today, tomorrow, a weekday (optionally "next"), "12 nov" or "nov 12"
  take(/\s(today|tonight)\s/i, () => { out.date = midnight(now); });
  if (!out.date) take(/\s(tomorrow|tmrw|tmr)\s/i, () => { out.date = plusDays(midnight(now), 1); });
  if (!out.date) {
    take(new RegExp(`\\s(?:on\\s+)?(next\\s+)?${DAY_RE}\\s`, 'i'), (m) => {
      const want = DAYS.indexOf(m[2].slice(0, 3).toLowerCase());
      const today = midnight(now);
      let add = (want - today.getDay() + 7) % 7;
      if (m[1] && add === 0) add = 7;
      if (m[1] && add > 0 && add < 7 - today.getDay() + 0) add += 0;
      out.date = plusDays(today, add);
    });
  }
  if (!out.date) {
    const mon = `(${MONTHS.join('|')})[a-z]*`;
    const set = (d, mo) => {
      const idx = MONTHS.indexOf(mo.slice(0, 3).toLowerCase());
      let y = now.getFullYear();
      let dt = new Date(y, idx, Number(d));
      if (dt.getMonth() !== idx) return false;
      if (midnight(dt) < midnight(now)) dt = new Date(y + 1, idx, Number(d));
      out.date = dt;
      return true;
    };
    if (!take(new RegExp(`\\s(?:on\\s+)?(\\d{1,2})(?:st|nd|rd|th)?\\s+${mon}\\s`, 'i'), (m) => set(m[1], m[2]))) {
      take(new RegExp(`\\s(?:on\\s+)?${mon}\\s+(\\d{1,2})(?:st|nd|rd|th)?\\s`, 'i'), (m) => set(m[2], m[1]));
    }
  }

  // Time range: "1-2pm", "1pm to 2:30pm", "13:00-14:00"
  take(/\s(?:at\s+|from\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:-|to|until)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)\s/i, (m) => {
    const endAp = m[6].toLowerCase();
    const startAp = (m[3] || endAp).toLowerCase();
    const a = clock(m[1], m[2], startAp);
    const b = clock(m[4], m[5], endAp);
    if (!a || !b) return false;
    out.start = hhmm(a.h, a.m); out.end = hhmm(b.h, b.m);
  });
  if (!out.start) {
    take(/\s(?:at\s+|from\s+)?([01]?\d|2[0-3]):([0-5]\d)\s*(?:-|to|until)\s*([01]?\d|2[0-3]):([0-5]\d)\s/i, (m) => {
      out.start = hhmm(Number(m[1]), Number(m[2])); out.end = hhmm(Number(m[3]), Number(m[4]));
    });
  }
  // Single time: "3pm", "3:30pm", "15:00", "at 3", noon
  if (!out.start) {
    if (!take(/\s(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\s/i, (m) => {
      const c = clock(m[1], m[2], m[3].toLowerCase());
      if (!c) return false;
      out.start = hhmm(c.h, c.m);
    })) {
      if (!take(/\s(?:at\s+)?([01]?\d|2[0-3]):([0-5]\d)\s/, (m) => { out.start = hhmm(Number(m[1]), Number(m[2])); })) {
        if (!take(/\s(noon|midday)\s/i, () => { out.start = '12:00'; })) {
          take(/\sat\s+(\d{1,2})\s/i, (m) => {
            let h = Number(m[1]);
            if (h < 1 || h > 23) return false;
            if (h < 8) h += 12; // "at 3" means the afternoon
            out.start = hhmm(h, 0);
          });
        }
      }
    }
  }

  // Length: "for an hour", "for 90 min", "for 2h"
  take(/\sfor\s+(?:(an?|\d+(?:\.\d+)?)\s*)(h|hr|hrs|hour|hours|m|min|mins|minute|minutes)\s/i, (m) => {
    const n = /^an?$/i.test(m[1]) ? 1 : Number(m[1]);
    const unit = m[2].toLowerCase();
    out.dur = Math.round(unit.startsWith('h') ? n * 60 : n);
    if (!(out.dur > 0)) { out.dur = null; return false; }
  });

  if (out.start && !out.end) {
    const [h, m] = out.start.split(':').map(Number);
    const total = Math.min(24 * 60 - 1, h * 60 + m + (out.dur || 60));
    out.end = hhmm(Math.floor(total / 60), total % 60);
  } else if (out.start && out.end) {
    const [h, m] = out.start.split(':').map(Number);
    const [h2, m2] = out.end.split(':').map(Number);
    out.dur = h2 * 60 + m2 - (h * 60 + m);
  }
  if (out.start && !out.date) out.date = midnight(now);

  out.title = text.replace(/\s+/g, ' ').replace(/^(?:at|on|for|from|with)\s+(?=\S+$)/i, '').trim().replace(/\s+(?:at|on|for|from)$/i, '').trim();

  const label = (d) => d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  if (out.date) out.chips.push({ k: 'date', label: label(out.date) });
  if (out.start) out.chips.push({ k: 'time', label: `${out.start} - ${out.end}` });
  return out;
}

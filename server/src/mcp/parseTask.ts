/*
 * Pure helpers (no imports) for dates and the app's quick-add words, so they can be unit-tested on their own (parseTask.test.mjs).
 */
// ---- plain-words parsing, the same words the app's quick-add bar understands (today, tonight, tomorrow, a weekday, at 5pm, !high, #tag)
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
export const addDays = (ymd: string, n: number) => { const d = new Date(`${ymd}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
/** A local date and time in a named time zone, as an ISO instant. */
export function zonedIso(ymd: string, hhmm: string, tz: string): string {
  const guess = new Date(`${ymd}T${hhmm}:00Z`);
  try {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(guess).map((x) => [x.type, x.value]));
    const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
    return new Date(guess.getTime() - (asUtc - guess.getTime())).toISOString();
  } catch { return guess.toISOString(); }
}
export function parseTaskWords(input: string, today: string): { text: string; priority?: 'high' | 'low'; tags: string[]; date?: string; time?: string } {
  let t = ` ${String(input || '').trim()} `;
  const out: { text: string; priority?: 'high' | 'low'; tags: string[]; date?: string; time?: string } = { text: '', tags: [] };
  const take = (re: RegExp, fn: (m: RegExpExecArray) => void) => { const m = re.exec(t); if (!m) return false; fn(m); t = t.slice(0, m.index) + ' ' + t.slice(m.index + m[0].length); return true; };
  take(/\s!(high|urgent|low)\s/i, (m) => { out.priority = /low/i.test(m[1]) ? 'low' : 'high'; });
  while (take(/\s#([a-z0-9][\w-]*)\s/i, (m) => { out.tags.push(m[1].toLowerCase()); }));
  take(/\s(tomorrow|tmrw|tmr)\s/i, () => { out.date = addDays(today, 1); });
  if (!out.date) take(/\s(today|tonight)\s/i, (m) => { out.date = today; if (/tonight/i.test(m[1])) out.time = '18:30'; });
  if (!out.date) {
    take(/\s(?:on\s+)?(next\s+)?(sun(?:day)?|mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:r|rs|rsday)?|fri(?:day)?|sat(?:urday)?)\s/i, (m) => {
      const want = DAYS.indexOf(m[2].slice(0, 3).toLowerCase());
      const have = new Date(`${today}T00:00:00Z`).getUTCDay();
      let add = (want - have + 7) % 7;
      if (m[1] && add === 0) add = 7;
      out.date = addDays(today, add);
    });
  }
  take(/\s(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\s/i, (m) => {
    let h = Number(m[1]); const mi = m[2] ? Number(m[2]) : 0;
    if (h >= 1 && h <= 12 && mi < 60) { if (/pm/i.test(m[3]) && h < 12) h += 12; if (/am/i.test(m[3]) && h === 12) h = 0; out.time = `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`; }
  });
  if (!out.time) take(/\s(?:at\s+)?([01]?\d|2[0-3]):([0-5]\d)\s/, (m) => { out.time = `${m[1].padStart(2, '0')}:${m[2]}`; });
  out.text = t.replace(/\s+/g, ' ').trim();
  if (out.time && !out.date) out.date = today;
  return out;
}

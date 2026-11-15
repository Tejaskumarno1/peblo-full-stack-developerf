import { safeFetchFollow, UnsafeUrlError } from '../utils/safeFetch.js';

/*
 * Calendar links (iCal feeds). Google ("secret address in iCal format"), Outlook ("published calendar" ICS link) and any
 * other calendar app can give a private .ics address. Peblo reads it (read only) and keeps the events for the next
 * 14 months, so they show next to your own tasks. Nothing is ever written back.
 */
export type FeedEvent = { uid: string; title: string; start: string; end: string; allDay: boolean; location?: string };

const WINDOWS_ZONES: Record<string, string> = {
  'India Standard Time': 'Asia/Kolkata', 'UTC': 'UTC', 'GMT Standard Time': 'Europe/London', 'W. Europe Standard Time': 'Europe/Berlin',
  'Central Europe Standard Time': 'Europe/Budapest', 'Romance Standard Time': 'Europe/Paris', 'Eastern Standard Time': 'America/New_York',
  'Central Standard Time': 'America/Chicago', 'Mountain Standard Time': 'America/Denver', 'Pacific Standard Time': 'America/Los_Angeles',
  'China Standard Time': 'Asia/Shanghai', 'Tokyo Standard Time': 'Asia/Tokyo', 'AUS Eastern Standard Time': 'Australia/Sydney',
  'Singapore Standard Time': 'Asia/Singapore', 'Arab Standard Time': 'Asia/Riyadh', 'Arabian Standard Time': 'Asia/Dubai',
};
const DAY = 86400000;

function validZone(tz: string | undefined): string {
  if (!tz) return 'UTC';
  const z = WINDOWS_ZONES[tz] || tz;
  try { new Intl.DateTimeFormat('en-US', { timeZone: z }); return z; } catch { return 'UTC'; }
}

/** Milliseconds the zone is ahead of UTC at that instant. */
function zoneOffset(ms: number, tz: string): number {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' }).formatToParts(new Date(ms));
  const g = (t: string) => Number(p.find((x) => x.type === t)?.value);
  return Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second')) - Math.floor(ms / 1000) * 1000;
}

/** Wall-clock time in a zone -> the real instant. */
export function zonedToUtc(y: number, mo: number, d: number, h: number, mi: number, s: number, tz: string): number {
  if (tz === 'UTC') return Date.UTC(y, mo - 1, d, h, mi, s);
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  let t = guess - zoneOffset(guess, tz);
  t = guess - zoneOffset(t, tz); // once more across a daylight-saving edge
  return t;
}

type Stamp = { y: number; mo: number; d: number; h: number; mi: number; s: number; tz: string; allDay: boolean };
function parseStamp(value: string, params: Record<string, string>): Stamp | null {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(value.trim());
  if (!m) return null;
  const allDay = params.VALUE === 'DATE' || m[4] === undefined;
  return { y: +m[1], mo: +m[2], d: +m[3], h: +(m[4] || 0), mi: +(m[5] || 0), s: +(m[6] || 0), tz: m[7] ? 'UTC' : validZone(params.TZID), allDay };
}
const stampMs = (t: Stamp) => zonedToUtc(t.y, t.mo, t.d, t.h, t.mi, t.s, t.tz);
const dateKey = (t: { y: number; mo: number; d: number }) => `${t.y}-${String(t.mo).padStart(2, '0')}-${String(t.d).padStart(2, '0')}`;

function unescapeText(v: string) { return v.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1').trim(); }

type Prop = { name: string; params: Record<string, string>; value: string };
function parseProp(line: string): Prop | null {
  const i = line.indexOf(':');
  if (i < 1) return null;
  // a ":" inside a quoted parameter value is not the separator
  let colon = -1, quoted = false;
  for (let k = 0; k < line.length; k++) { const c = line[k]; if (c === '"') quoted = !quoted; else if (c === ':' && !quoted) { colon = k; break; } }
  if (colon < 1) return null;
  const [name, ...ps] = line.slice(0, colon).split(';');
  const params: Record<string, string> = {};
  for (const p of ps) { const eq = p.indexOf('='); if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, ''); }
  return { name: name.toUpperCase(), params, value: line.slice(colon + 1) };
}

const WEEKDAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

/** Real events from an .ics text, with repeats expanded inside [fromMs, toMs]. */
export function parseIcs(text: string, fromMs: number, toMs: number, cap = 3000): FeedEvent[] {
  const lines = text.replace(/\r\n?/g, '\n').replace(/\n[ \t]/g, '').split('\n');
  type Raw = { props: Prop[] };
  const raws: Raw[] = [];
  let cur: Raw | null = null;
  for (const line of lines) {
    if (/^BEGIN:VEVENT/i.test(line)) cur = { props: [] };
    else if (/^END:VEVENT/i.test(line)) { if (cur) raws.push(cur); cur = null; }
    else if (cur) { const p = parseProp(line); if (p) cur.props.push(p); }
  }
  const get = (r: Raw, n: string) => r.props.find((p) => p.name === n);
  const all = (r: Raw, n: string) => r.props.filter((p) => p.name === n);

  const out: FeedEvent[] = [];
  const overridden = new Set<string>(); // uid|instant of a repeat that was changed on its own
  for (const r of raws) {
    const rid = get(r, 'RECURRENCE-ID');
    const st = rid && parseStamp(rid.value, rid.params);
    if (rid && st) overridden.add(`${get(r, 'UID')?.value}|${st.allDay ? dateKey(st) : stampMs(st)}`);
  }

  for (const r of raws) {
    if (/CANCELLED/i.test(get(r, 'STATUS')?.value || '')) continue;
    const ds = get(r, 'DTSTART');
    const start = ds && parseStamp(ds.value, ds.params);
    if (!ds || !start) continue;
    const de = get(r, 'DTEND');
    const endStamp = de && parseStamp(de.value, de.params);
    const dur = get(r, 'DURATION')?.value;
    const uid = get(r, 'UID')?.value || `${dateKey(start)}-${get(r, 'SUMMARY')?.value || ''}`;
    const title = unescapeText(get(r, 'SUMMARY')?.value || '') || '(no title)';
    const location = unescapeText(get(r, 'LOCATION')?.value || '') || undefined;
    const startMs = stampMs(start);
    let lenMs = endStamp ? stampMs(endStamp) - startMs : start.allDay ? DAY : 0;
    if (!endStamp && dur) { const dm = /^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(dur); if (dm) lenMs = ((+dm[1] || 0) * 7 + (+(dm[2] || 0))) * DAY + (+(dm[3] || 0)) * 3600000 + (+(dm[4] || 0)) * 60000 + (+(dm[5] || 0)) * 1000; }
    if (lenMs < 0) lenMs = 0;

    const push = (s: Stamp) => {
      const sMs = stampMs(s);
      if (overridden.has(`${uid}|${s.allDay ? dateKey(s) : sMs}`) && !get(r, 'RECURRENCE-ID')) return;
      const eMs = sMs + lenMs;
      if (eMs < fromMs || sMs > toMs) return;
      if (s.allDay) {
        const e = new Date(Date.UTC(s.y, s.mo - 1, s.d) + (lenMs || DAY));
        out.push({ uid: `${uid}@${dateKey(s)}`, title, start: dateKey(s), end: dateKey({ y: e.getUTCFullYear(), mo: e.getUTCMonth() + 1, d: e.getUTCDate() }), allDay: true, location });
      } else out.push({ uid: `${uid}@${sMs}`, title, start: new Date(sMs).toISOString(), end: new Date(eMs).toISOString(), allDay: false, location });
    };

    const rr = get(r, 'RRULE');
    if (!rr) { push(start); continue; }
    const rule: Record<string, string> = {};
    for (const kv of rr.value.split(';')) { const [k, v] = kv.split('='); if (k && v) rule[k.toUpperCase()] = v; }
    const interval = Math.max(1, parseInt(rule.INTERVAL || '1', 10) || 1);
    const count = rule.COUNT ? parseInt(rule.COUNT, 10) : Infinity;
    const until = rule.UNTIL ? parseStamp(rule.UNTIL, {}) : null;
    const untilMs = until ? (until.allDay ? Date.UTC(until.y, until.mo - 1, until.d, 23, 59, 59) : stampMs(until)) : Infinity;
    const ex = new Set(all(r, 'EXDATE').flatMap((p) => p.value.split(',').map((v) => { const s = parseStamp(v, p.params); return s ? (s.allDay ? dateKey(s) : String(stampMs(s))) : ''; })));
    const byday = (rule.BYDAY || '').split(',').map((x) => WEEKDAYS.indexOf(x.slice(-2))).filter((x) => x >= 0);
    const base = Date.UTC(start.y, start.mo - 1, start.d);
    let made = 0, guard = 0;
    const emit = (dayMs: number): boolean => {
      const dt = new Date(dayMs);
      const s: Stamp = { ...start, y: dt.getUTCFullYear(), mo: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
      const sMs = stampMs(s);
      if (sMs < startMs) return true;
      if (sMs > untilMs || sMs > toMs || made >= count) return false;
      made++;
      if (!ex.has(s.allDay ? dateKey(s) : String(sMs))) push(s);
      return true;
    };
    const freq = rule.FREQ;
    if (freq === 'DAILY') { for (let k = 0; guard++ < 5000; k += interval) if (!emit(base + k * DAY)) break; }
    else if (freq === 'WEEKLY') {
      const days = byday.length ? byday : [new Date(base).getUTCDay()];
      const weekStart = base - new Date(base).getUTCDay() * DAY;
      outer: for (let w = 0; guard++ < 2000; w += interval) for (const d of [...days].sort((a, b) => a - b)) if (!emit(weekStart + (w * 7 + d) * DAY)) break outer;
    } else if (freq === 'MONTHLY') {
      const bmd = rule.BYMONTHDAY ? parseInt(rule.BYMONTHDAY, 10) : start.d;
      for (let k = 0; guard++ < 1000; k += interval) {
        const dt = new Date(Date.UTC(start.y, start.mo - 1 + k, 1));
        const last = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 0)).getUTCDate();
        const day = bmd < 0 ? last + 1 + bmd : bmd;
        if (day < 1 || day > last) { if (Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), 1) > Math.min(toMs, untilMs)) break; continue; }
        if (!emit(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), day))) break;
      }
    } else if (freq === 'YEARLY') {
      for (let k = 0; guard++ < 200; k += interval) { if (!emit(Date.UTC(start.y + k, start.mo - 1, start.d))) break; }
    } else push(start);
    if (out.length > cap * 2) break;
  }
  out.sort((a, b) => a.start.localeCompare(b.start));
  return out.slice(0, cap);
}

/** The window kept for every link: a month back, fourteen months ahead. */
export const feedWindow = () => { const n = Date.now(); return { from: n - 30 * DAY, to: n + 425 * DAY }; };

export class FeedError extends Error {}

/** Downloads an .ics address (webcal:// is https://) without reaching the server's own network, then parses it. */
export async function readFeed(rawUrl: string): Promise<FeedEvent[]> {
  const url = String(rawUrl || '').trim().replace(/^webcal:\/\//i, 'https://');
  if (!/^https?:\/\//i.test(url)) throw new FeedError('Paste the calendar link, it starts with https://');
  let res: Response;
  try {
    ({ response: res } = await safeFetchFollow(url, { headers: { accept: 'text/calendar, text/plain, */*', 'user-agent': 'Peblo calendar sync' }, signal: AbortSignal.timeout(20000) }, { maxRedirects: 4 }));
  } catch (e: any) {
    if (e instanceof UnsafeUrlError) throw new FeedError(e.message);
    throw new FeedError('Could not reach that link. Check it and try again.');
  }
  if (res.status === 401 || res.status === 403) throw new FeedError('That calendar link needs a sign-in or has been turned off. Copy the secret iCal address again.');
  if (res.status === 404 || res.status === 410) throw new FeedError('That link does not exist any more. Copy the secret iCal address again.');
  if (!res.ok) throw new FeedError(`That calendar answered with an error (${res.status}).`);
  const reader = res.body?.getReader();
  if (!reader) throw new FeedError('That link sent nothing.');
  const chunks: Uint8Array[] = []; let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > 8 * 1024 * 1024) { try { await reader.cancel(); } catch { /* ignore */ } throw new FeedError('That calendar is too big (over 8 MB).'); }
    chunks.push(value);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  if (!/BEGIN:VCALENDAR/i.test(text)) throw new FeedError('That link is not a calendar (.ics) file.');
  const { from, to } = feedWindow();
  return parseIcs(text, from, to);
}

/** Peblo's own tasks and meetings as an .ics file other apps can subscribe to. */
export function buildIcs(name: string, items: { id: string; text: string; start?: Date | null; end?: Date | null; day?: string | null; done?: boolean; updated?: Date }[]): string {
  const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
  const fmt = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const out = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Peblo//Calendar//EN', 'CALSCALE:GREGORIAN', `X-WR-CALNAME:${esc(name)}`];
  for (const it of items) {
    out.push('BEGIN:VEVENT', `UID:${it.id}@peblo`, `DTSTAMP:${fmt(it.updated || new Date())}`);
    if (it.start) { out.push(`DTSTART:${fmt(it.start)}`, `DTEND:${fmt(it.end && it.end > it.start ? it.end : new Date(it.start.getTime() + 3600000))}`); }
    else if (it.day) { const d = it.day.replace(/-/g, ''); const n = new Date(Date.UTC(+it.day.slice(0, 4), +it.day.slice(5, 7) - 1, +it.day.slice(8, 10)) + DAY).toISOString().slice(0, 10).replace(/-/g, ''); out.push(`DTSTART;VALUE=DATE:${d}`, `DTEND;VALUE=DATE:${n}`); }
    else continue;
    out.push(`SUMMARY:${esc((it.done ? 'Done: ' : '') + it.text)}`, 'END:VEVENT');
  }
  out.push('END:VCALENDAR');
  // lines are folded at 75 bytes as the format asks
  return out.map((l) => { const parts: string[] = []; let s = l; while (Buffer.byteLength(s) > 75) { let n = 74; while (Buffer.byteLength(s.slice(0, n)) > 74) n--; parts.push(s.slice(0, n)); s = ' ' + s.slice(n); } parts.push(s); return parts.join('\r\n'); }).join('\r\n') + '\r\n';
}

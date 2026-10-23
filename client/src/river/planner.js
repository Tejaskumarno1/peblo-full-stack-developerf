import { addDays, momentOf, endOf, DAY_START, DAY_END } from './riverUtils';

/** Planning helpers for River: when you are free, and which meetings overlap. */
export const MIN_GAP = 30; // minutes

const span = (t) => {
  const s = momentOf(t);
  if (!s) return null;
  let e = endOf(t) || new Date(s.getTime() + 3600000);
  if (e <= s) e = new Date(s.getTime() + 3600000);
  return { id: t.id, s, e };
};

const roundUp15 = (d) => {
  const x = new Date(d);
  x.setSeconds(0, 0);
  const m = x.getMinutes();
  if (m % 15) x.setMinutes(m + (15 - (m % 15)));
  return x;
};

/** Free stretches (30 min or more) inside the waking hours, from "from" onward, for "days" days starting at today. */
export function freeGaps(meetings, today, days, from = new Date(), min = MIN_GAP) {
  const busy = meetings.map(span).filter(Boolean).sort((a, b) => a.s - b.s);
  const out = [];
  const push = (s, e) => {
    const mins = Math.round((e - s) / 60000);
    if (mins >= min) out.push({ s: new Date(s), e: new Date(e), mins });
  };
  for (let i = 0; i < days; i++) {
    const d = addDays(today, i);
    const ws = new Date(d);
    ws.setHours(DAY_START, 0, 0, 0);
    const we = new Date(d);
    we.setHours(DAY_END, 0, 0, 0);
    let cur = ws > from ? ws : roundUp15(from);
    if (cur >= we) continue;
    for (const b of busy) {
      if (b.e <= cur || b.s >= we) continue;
      if (b.s > cur) push(cur, b.s);
      if (b.e > cur) cur = b.e;
      if (cur >= we) break;
    }
    if (cur < we) push(cur, we);
  }
  return out;
}

/** Meetings that overlap: the ids involved and each overlap (start, end, minutes). */
export function clashes(meetings) {
  const spans = meetings.map(span).filter(Boolean).sort((a, b) => a.s - b.s);
  const ids = new Set();
  const list = [];
  for (let i = 0; i < spans.length; i++) {
    for (let j = i + 1; j < spans.length && spans[j].s < spans[i].e; j++) {
      const s = spans[j].s;
      const e = spans[i].e < spans[j].e ? spans[i].e : spans[j].e;
      ids.add(spans[i].id);
      ids.add(spans[j].id);
      list.push({ a: spans[i].id, b: spans[j].id, s, e, mins: Math.round((e - s) / 60000) });
    }
  }
  return { ids, list };
}

/** 90 -> "1 h 30 min", 45 -> "45 min", 120 -> "2 h". */
export function dur(mins) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (!h) return m + ' min';
  return h + ' h' + (m ? ' ' + m + ' min' : '');
}

import re,io
def edit(f, pairs):
    s=open(f,encoding='utf8',newline='').read(); crlf='\r\n' in s; s=s.replace('\r\n','\n')
    for a,b in pairs:
        if a not in s: raise SystemExit('missing in %s: %s'%(f,a[:60]))
        s=s.replace(a,b)
    open(f,'w',encoding='utf8',newline='').write(s.replace('\n','\r\n') if crlf else s)
ENUM="z.enum(['none', 'daily', 'weekdays', 'weekly', 'monthly', 'yearly'])"
UNION="recurrenceSchema"
edit('server/src/services/todoSeries.ts',[
("export const isRepeating = (r: unknown): r is Exclude<Recurrence, 'none'> => typeof r === 'string' && r !== 'none' && (RECURRENCES as readonly string[]).includes(r);",
"""/** A custom rule is written "every:<n>:<day|week|month|year>", for example every:3:day or every:2:week. */
export const CUSTOM_RE = /^every:([1-9]\\d{0,2}):(day|week|month|year)$/;
export const parseCustom = (r: unknown): { n: number; unit: 'day' | 'week' | 'month' | 'year' } | null => {
  const m = typeof r === 'string' ? CUSTOM_RE.exec(r) : null;
  return m ? { n: Number(m[1]), unit: m[2] as 'day' | 'week' | 'month' | 'year' } : null;
};
export const isValidRecurrence = (r: unknown): r is string => typeof r === 'string' && ((RECURRENCES as readonly string[]).includes(r) || !!parseCustom(r));
export const isRepeating = (r: unknown): r is string => typeof r === 'string' && r !== 'none' && isValidRecurrence(r);"""),
("export function nextOccurrence(rule: Exclude<Recurrence, 'none'>, anchor: Date, last: Date, tz: string): Date {",
 "export function nextOccurrence(rule: string, anchor: Date, last: Date, tz: string): Date {"),
("  if (rule === 'daily') d += 1;\n  else if (rule === 'weekly') d += 7;",
"""  const custom = parseCustom(rule);
  if (custom) {
    const { n, unit } = custom;
    if (unit === 'day') d += n;
    else if (unit === 'week') d += 7 * n;
    else if (unit === 'month') { m += n; y += Math.floor((m - 1) / 12); m = ((m - 1) % 12) + 1; d = Math.min(a.d, daysInMonth(y, m)); }
    else { y += n; m = a.m; d = Math.min(a.d, daysInMonth(y, m)); }
  } else if (rule === 'daily') d += 1;
  else if (rule === 'weekly') d += 7;"""),
("    const horizon = now + (HORIZON_DAYS[s.recurrence] ?? 60) * DAY;",
 "    const cu = parseCustom(s.recurrence);\n    const horizon = now + (cu ? HORIZON_DAYS[({ day: 'daily', week: 'weekly', month: 'monthly', year: 'yearly' })[cu.unit]] : HORIZON_DAYS[s.recurrence] ?? 60) * DAY;"),
])
edit('server/src/controllers/todosController.ts',[
("import { RECURRENCES, isRepeating, topUpSeries } from '../services/todoSeries.js';","import { isValidRecurrence, isRepeating, topUpSeries } from '../services/todoSeries.js';"),
("(RECURRENCES as readonly string[]).includes(recurrence) ? recurrence : 'none'","isValidRecurrence(recurrence) ? recurrence : 'none'"),
("(RECURRENCES as readonly string[]).includes(recurrence) ? recurren","isValidRecurrence(recurrence) ? recurren"),
])

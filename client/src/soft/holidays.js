// Built-in holiday calendars (India, United States, United Kingdom). No network needed.
// Fixed and weekday-rule holidays are computed for any year. Moving festivals (Diwali, Holi, Eid, Dussehra) come from a table.
export const COUNTRIES = [['IN', 'India'], ['US', 'United States'], ['GB', 'United Kingdom']];
const k = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const nth = (y, m, wd, n) => { const first = new Date(y, m - 1, 1).getDay(); return 1 + ((wd - first + 7) % 7) + (n - 1) * 7; };
const last = (y, m, wd) => { const e = new Date(y, m, 0); return e.getDate() - ((e.getDay() - wd + 7) % 7); };
function easter(y) { // Anonymous Gregorian algorithm
  const a = y % 19; const b = Math.floor(y / 100); const c = y % 100; const d = Math.floor(b / 4); const e = b % 4; const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3); const h = (19 * a + b - d - g + 15) % 30; const i = Math.floor(c / 4); const kk = c % 4;
  const l = (32 + 2 * e + 2 * i - h - kk) % 7; const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31); const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(y, month - 1, day);
}
const off = (dt, n) => { const x = new Date(dt); x.setDate(x.getDate() + n); return x; };
const ymd = (dt) => k(dt.getFullYear(), dt.getMonth() + 1, dt.getDate());

// kind: public (day off), festival, observance
const FEST = {
  IN: { 2026: [['03-04', 'Holi'], ['03-20', 'Eid al-Fitr'], ['08-28', 'Raksha Bandhan'], ['10-20', 'Dussehra'], ['11-08', 'Diwali'], ['11-11', 'Bhai Dooj']], 2027: [['03-22', 'Holi'], ['10-29', 'Diwali']], 2028: [['03-11', 'Holi'], ['10-17', 'Diwali']] },
  US: {}, GB: {},
};
export function holidaysOfYear(country, year, { festivals = true, observances = false } = {}) {
  const out = new Map();
  const add = (key, name, kind) => { if (!out.has(key)) out.set(key, []); out.get(key).push({ name, kind }); };
  if (country === 'IN') {
    [[1, 26, 'Republic Day'], [4, 14, 'Ambedkar Jayanti'], [5, 1, 'Labour Day'], [8, 15, 'Independence Day'], [10, 2, 'Gandhi Jayanti'], [12, 25, 'Christmas']].forEach(([m, d, n]) => add(k(year, m, d), n, 'public'));
    const e = easter(year); add(ymd(off(e, -2)), 'Good Friday', 'public');
    if (festivals) (FEST.IN[year] || []).forEach(([md, n]) => add(`${year}-${md}`, n, 'festival'));
    if (observances) [[1, 1, "New Year's Day"], [9, 5, "Teachers' Day"], [11, 14, "Children's Day"], [11, 26, 'Constitution Day'], [4, 22, 'Earth Day']].forEach(([m, d, n]) => add(k(year, m, d), n, 'observance'));
  } else if (country === 'US') {
    [[1, 1, "New Year's Day"], [6, 19, 'Juneteenth'], [7, 4, 'Independence Day'], [11, 11, 'Veterans Day'], [12, 25, 'Christmas']].forEach(([m, d, n]) => add(k(year, m, d), n, 'public'));
    add(k(year, 1, nth(year, 1, 1, 3)), 'Martin Luther King Jr. Day', 'public'); add(k(year, 2, nth(year, 2, 1, 3)), "Presidents' Day", 'public');
    add(k(year, 5, last(year, 5, 1)), 'Memorial Day', 'public'); add(k(year, 9, nth(year, 9, 1, 1)), 'Labor Day', 'public');
    add(k(year, 10, nth(year, 10, 1, 2)), 'Columbus Day', 'public'); add(k(year, 11, nth(year, 11, 4, 4)), 'Thanksgiving', 'public');
    if (observances) [[2, 14, "Valentine's Day"], [10, 31, 'Halloween'], [4, 22, 'Earth Day']].forEach(([m, d, n]) => add(k(year, m, d), n, 'observance'));
  } else if (country === 'GB') {
    [[1, 1, "New Year's Day"], [12, 25, 'Christmas Day'], [12, 26, 'Boxing Day']].forEach(([m, d, n]) => add(k(year, m, d), n, 'public'));
    const e = easter(year); add(ymd(off(e, -2)), 'Good Friday', 'public'); add(ymd(off(e, 1)), 'Easter Monday', 'public');
    add(k(year, 5, nth(year, 5, 1, 1)), 'Early May bank holiday', 'public'); add(k(year, 5, last(year, 5, 1)), 'Spring bank holiday', 'public'); add(k(year, 8, last(year, 8, 1)), 'Summer bank holiday', 'public');
    if (observances) [[2, 14, "Valentine's Day"], [11, 5, 'Bonfire Night'], [4, 22, 'Earth Day']].forEach(([m, d, n]) => add(k(year, m, d), n, 'observance'));
  }
  return out;
}
export const holidayKey = (d) => k(d.getFullYear(), d.getMonth() + 1, d.getDate());
/** Holidays on one day, given the settings object { on, country, festivals, observances }. */
export function makeHolidayLookup(cfg) {
  if (!cfg || cfg.on === false) return () => [];
  const cache = new Map();
  return (d) => {
    const y = d.getFullYear();
    if (!cache.has(y)) cache.set(y, holidaysOfYear(cfg.country || 'IN', y, { festivals: cfg.festivals !== false, observances: !!cfg.observances }));
    return cache.get(y).get(holidayKey(d)) || [];
  };
}

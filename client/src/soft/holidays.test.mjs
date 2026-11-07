import assert from 'node:assert/strict';
import { holidaysOfYear, makeHolidayLookup } from './holidays.js';
const names = (m, key) => (m.get(key) || []).map((h) => h.name);
const us = holidaysOfYear('US', 2026);
assert.deepEqual(names(us, '2026-11-26'), ['Thanksgiving']);   // 4th Thursday
assert.deepEqual(names(us, '2026-09-07'), ['Labor Day']);       // 1st Monday
assert.deepEqual(names(us, '2026-05-25'), ['Memorial Day']);    // last Monday
const gb = holidaysOfYear('GB', 2026);
assert.deepEqual(names(gb, '2026-04-03'), ['Good Friday']);     // Easter is 5 April 2026
assert.deepEqual(names(gb, '2026-04-06'), ['Easter Monday']);
const inn = holidaysOfYear('IN', 2026);
assert.deepEqual(names(inn, '2026-08-15'), ['Independence Day']);
assert.deepEqual(names(inn, '2026-11-08'), ['Diwali']);
assert.deepEqual(names(holidaysOfYear('IN', 2026, { festivals: false }), '2026-11-08'), []);
assert.deepEqual(names(holidaysOfYear('IN', 2026, { observances: true }), '2026-11-14'), ["Children's Day"]);
const look = makeHolidayLookup({ on: true, country: 'IN', festivals: true });
assert.equal(look(new Date(2026, 0, 26))[0].name, 'Republic Day');
assert.deepEqual(makeHolidayLookup({ on: false })(new Date(2026, 0, 26)), []);
console.log('holidays: ok');

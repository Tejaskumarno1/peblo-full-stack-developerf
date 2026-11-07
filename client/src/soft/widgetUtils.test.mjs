import assert from 'node:assert/strict';
import { dkey, habitStreak, toggleHabitDay, habitWeekPercent, focusByDay, hm, lastDays, pruneHabits } from './widgetUtils.js';
const today = new Date(2026, 10, 6);
let h = { id: 'a', name: 'Read', days: {} };
for (const k of ['2026-11-05', '2026-11-04', '2026-11-03']) h = toggleHabitDay(h, k);
assert.equal(habitStreak(h, today), 3);            // today not done yet does not break it
h = toggleHabitDay(h, '2026-11-06'); assert.equal(habitStreak(h, today), 4);
h = toggleHabitDay(h, '2026-11-06'); assert.equal(habitStreak(h, today), 3);   // toggling again clears it
assert.equal(habitStreak({ days: { '2026-11-01': 1 } }, today), 0);
assert.equal(habitWeekPercent([h], today), 43);    // 3 of 7
assert.equal(habitWeekPercent([], today), 0);
const days = lastDays(7, today); assert.equal(dkey(days[6]), '2026-11-06'); assert.equal(dkey(days[0]), '2026-10-31');
assert.deepEqual(focusByDay([{ meta: { timeLog: { '2026-11-06': 30, '2026-10-01': 99 } } }, { meta: { timeLog: { '2026-11-06': 15, '2026-11-05': 60 } } }], days), [0, 0, 0, 0, 0, 60, 45]);
assert.equal(hm(860), '14 h 20 min'); assert.equal(hm(45), '45 min'); assert.equal(hm(120), '2 h');
assert.equal(Object.keys(pruneHabits([{ days: { '2026-11-01': 1, '2025-01-01': 1 } }], today)[0].days).length, 1);
console.log('homeWidgets: ok');

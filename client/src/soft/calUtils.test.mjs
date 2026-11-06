import test from 'node:test';
import assert from 'node:assert/strict';
import { freeSlots, agendaDays } from './calUtils.js';

const day = new Date(2026, 10, 9); // a Monday, in the future of NOW below
const NOW = new Date(2026, 10, 6, 10, 0, 0);
const at = (d, h, m = 0) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m).toISOString();
const meet = (id, h1, h2, extra = {}) => ({ id, text: id, deadline: at(day, 0), startTime: `${String(h1).padStart(2, '0')}:00`, endTime: `${String(h2).padStart(2, '0')}:00`, ...extra });

test('an empty day gives the start of working hours', () => {
  const r = freeSlots([], day, 1, { now: NOW, count: 1 });
  assert.equal(r[0].start, 9);
  assert.equal(r[0].end, 10);
});

test('slots go around a meeting and skip gaps that are too short', () => {
  const todos = [meet('a', 9, 10), meet('b', 10, 13)];
  const r = freeSlots(todos, day, 2, { now: NOW, count: 2 });
  assert.equal(r[0].start, 13);
  assert.equal(r[0].end, 15);
});

test('finished tasks do not block time', () => {
  const r = freeSlots([meet('a', 9, 12, { completed: true })], day, 1, { now: NOW, count: 1 });
  assert.equal(r[0].start, 9);
});

test('today starts at the next quarter hour', () => {
  const today = new Date(2026, 10, 6, 0, 0);
  const r = freeSlots([], today, 1, { now: new Date(2026, 10, 6, 10, 20), count: 1 });
  assert.equal(r[0].start, 10.5);
});

test('nothing fits when the day is full, so it moves to the next day', () => {
  const r = freeSlots([meet('a', 9, 18)], day, 1, { now: NOW, count: 1 });
  assert.equal(r[0].start, 9);
  assert.equal(r[0].day.getDate(), 10);
});

test('agenda groups by day, in time order, and drops empty days', () => {
  const todos = [meet('late', 15, 16), meet('early', 8, 9), { id: 'nodate', text: 'x' }];
  const r = agendaDays(todos, day, 3);
  assert.equal(r.length, 1);
  assert.deepEqual(r[0].items.map((t) => t.id), ['early', 'late']);
});

import { yearHeat, heatLevel } from './calUtils.js';
test('yearHeat counts items per day and lays months out from the right weekday', () => {
  const todos = [
    { deadline: new Date(2026, 10, 6, 9).toISOString() }, { deadline: new Date(2026, 10, 6, 15).toISOString() },
    { deadline: new Date(2026, 10, 7).toISOString() }, { deadline: new Date(2025, 10, 6).toISOString() }, { deadline: null },
  ];
  const y = yearHeat(todos, 2026);
  assert.equal(y.length, 12);
  const nov = y[10];
  assert.equal(nov.days.length, 30);
  assert.equal(nov.days[5].n, 2);
  assert.equal(nov.days[6].n, 1);
  assert.equal(nov.days[0].n, 0);
  assert.equal(nov.lead, 6); // 1 Nov 2026 is a Sunday: six blanks when weeks start on Monday
  assert.equal(yearHeat([], 2026, false)[10].lead, 0);
  assert.equal(y[1].days.length, 28);
});
test('heatLevel buckets', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 9].map(heatLevel), [0, 1, 2, 2, 3, 3]);
});

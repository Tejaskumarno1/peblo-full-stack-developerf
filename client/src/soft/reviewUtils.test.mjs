import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewBuckets, triageDate } from './reviewUtils.js';

const NOW = new Date(2026, 10, 6, 10, 0); // Friday
const day = (n, h = 23, m = 59) => new Date(2026, 10, 6 + n, h, m).toISOString();

test('sorts open tasks into overdue, undated and the next 7 days', () => {
  const todos = [
    { id: 'a', deadline: day(-2) },
    { id: 'b', deadline: day(0) },
    { id: 'c', deadline: day(3) },
    { id: 'd', deadline: day(9) },
    { id: 'e' },
    { id: 'f', deadline: day(-1), completed: true },
  ];
  const r = reviewBuckets(todos, NOW);
  assert.deepEqual(r.overdue.map((t) => t.id), ['a']);
  assert.deepEqual(r.undated.map((t) => t.id), ['e']);
  assert.deepEqual(r.upcoming.map((t) => t.id), ['b', 'c']);
});

test('counts what was finished in the last week', () => {
  const r = reviewBuckets([{ id: 'x', completed: true, completedAt: day(-2) }, { id: 'y', completed: true, completedAt: day(-20) }], NOW);
  assert.equal(r.doneRecently, 1);
});

test('triage dates are all-day and next week is the coming Monday', () => {
  assert.equal(triageDate('today', NOW).getDate(), 6);
  assert.equal(triageDate('tomorrow', NOW).getDate(), 7);
  const nw = triageDate('nextweek', NOW);
  assert.equal(nw.getDay(), 1);
  assert.equal(nw.getDate(), 9);
  assert.equal(nw.getHours(), 23);
  assert.equal(triageDate('nextweek', new Date(2026, 10, 9, 9, 0)).getDate(), 16); // on a Monday it means a week on
  assert.equal(triageDate('nope', NOW), null);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { startOfWeek, weekdayNames } from './weekStart.js';

const wed = new Date(2026, 9, 7, 15, 30); // Wed 7 Oct 2026
test('Monday start', () => {
  const d = startOfWeek(wed, 1);
  assert.equal(d.getDay(), 1); assert.equal(d.getDate(), 5); assert.equal(d.getHours(), 0);
});
test('Sunday start', () => {
  const d = startOfWeek(wed, 0);
  assert.equal(d.getDay(), 0); assert.equal(d.getDate(), 4);
});
test('a Sunday belongs to the week that started the previous Monday', () => {
  assert.equal(startOfWeek(new Date(2026, 9, 11), 1).getDate(), 5);
  assert.equal(startOfWeek(new Date(2026, 9, 11), 0).getDate(), 11);
});
test('weekdayNames rotates', () => {
  const n = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  assert.deepEqual(weekdayNames(n, 1), ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
  assert.deepEqual(weekdayNames(n, 0), n);
});

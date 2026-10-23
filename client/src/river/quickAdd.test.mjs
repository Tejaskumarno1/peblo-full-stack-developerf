import test from 'node:test';
import assert from 'node:assert/strict';
import { quickMeetingTimes, timeOfDay } from './quickAdd.js';

const at = (h, m) => new Date(2026, 9, 9, h, m);

test('an ordinary meeting lasts an hour', () => {
  const { start, end } = quickMeetingTimes(at(14, 0));
  assert.equal(timeOfDay(start), '14:00');
  assert.equal(timeOfDay(end), '15:00');
});

test('a late meeting stops at 23:59 instead of wrapping to the next morning', () => {
  const { start, end } = quickMeetingTimes(at(23, 30));
  assert.equal(timeOfDay(start), '23:30');
  assert.equal(timeOfDay(end), '23:59');
  assert.ok(end > start);
});

test('very close to midnight the start is pulled back so the meeting is not zero-length', () => {
  const { start, end } = quickMeetingTimes(at(23, 59));
  assert.equal(timeOfDay(end), '23:59');
  assert.ok(end.getTime() - start.getTime() >= 15 * 60000);
  assert.equal(start.getDate(), 9);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { formatRelativeDate } from './helpers.js';

const NOW = new Date(2026, 9, 12, 1, 0, 0); // Monday 01:00
const at = (d, h = 12) => new Date(2026, 9, d, h, 0, 0);

test('same calendar day is Today even hours apart', () => {
  assert.equal(formatRelativeDate(at(12, 23), NOW), 'Today');
});
test('yesterday late evening, under 24 h ago, is Yesterday (not Today)', () => {
  assert.equal(formatRelativeDate(at(11, 23), NOW), 'Yesterday');
});
test('tomorrow under 24 h away is Tomorrow (was "Yesterday")', () => {
  assert.equal(formatRelativeDate(at(12, 23), new Date(2026, 9, 11, 23, 30)), 'Tomorrow');
});
test('past days and future days', () => {
  assert.equal(formatRelativeDate(at(9), NOW), '3 days ago');
  assert.equal(formatRelativeDate(at(15), NOW), 'In 3 days');
  assert.equal(formatRelativeDate(at(13), NOW), 'Tomorrow');
});
test('a week or more falls back to a short date', () => {
  assert.equal(formatRelativeDate(at(1), NOW), 'Oct 1');
  assert.equal(formatRelativeDate(at(30), NOW), 'Oct 30');
});
test('empty or invalid input', () => {
  assert.equal(formatRelativeDate(null, NOW), '');
  assert.equal(formatRelativeDate('not a date', NOW), '');
});

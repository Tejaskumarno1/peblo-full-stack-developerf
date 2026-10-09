import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldRing, briefingDue, briefingTasks, spokenWhen, introText, isAllDayTask, callsEnabled } from './callRules.js';

const at = (h, m = 0, day = 9) => new Date(2026, 9, day, h, m);

test('rings for a timed task within 2 hours, not before or after', () => {
  const t = { id: 1, text: 'Standup', deadline: at(15, 0).toISOString() };
  assert.equal(shouldRing(t, at(13, 30)), true);
  assert.equal(shouldRing(t, at(11, 0)), false); // too early
  assert.equal(shouldRing(t, at(15, 1)), false); // already past
});

test('all-day tasks (23:59) never ring in the evening', () => {
  const t = { id: 2, text: 'Pay rent', deadline: at(23, 59).toISOString() };
  assert.equal(isAllDayTask(t), true);
  assert.equal(shouldRing(t, at(21, 53)), false);
});

test('a task with a start time at 23:59 is a real time, so it can ring', () => {
  const t = { id: 3, text: 'Late call', deadline: at(23, 59).toISOString(), startTime: '23:00' };
  assert.equal(shouldRing(t, at(22, 30)), true);
});

test('done tasks, already-called tasks and brand-new tasks do not ring', () => {
  const base = { id: 4, text: 'x', deadline: at(15, 0).toISOString() };
  assert.equal(shouldRing({ ...base, completed: true }, at(14, 0)), false);
  assert.equal(shouldRing(base, at(14, 0), { 4: true }), false);
  assert.equal(shouldRing({ ...base, createdAt: at(13, 50).toISOString() }, at(14, 0)), false);
  assert.equal(shouldRing({ ...base, createdAt: at(9, 0).toISOString() }, at(14, 0)), true);
});

test('morning briefing: once a day, from 07:30 until 11:00', () => {
  assert.equal(briefingDue(at(7, 29), ''), false);
  assert.equal(briefingDue(at(7, 30), ''), true);
  assert.equal(briefingDue(at(9, 45), ''), true); // app opened late still gets it
  assert.equal(briefingDue(at(11, 0), ''), false);
  assert.equal(briefingDue(at(8, 0), at(6).toDateString()), false); // already done today
  assert.equal(briefingDue(at(8, 0), at(6, 0, 8).toDateString()), true);
});

test('briefing covers undated, today and overdue open tasks only', () => {
  const now = at(8, 0);
  const all = [
    { id: 1, text: 'undated' },
    { id: 2, text: 'today', deadline: at(17, 0).toISOString() },
    { id: 3, text: 'overdue', deadline: at(17, 0, 7).toISOString() },
    { id: 4, text: 'tomorrow', deadline: at(17, 0, 10).toISOString() },
    { id: 5, text: 'done', completed: true },
  ];
  assert.deepEqual(briefingTasks(all, now).map((t) => t.id), [1, 2, 3]);
});

test('all-day tasks are read as "today", not as 11:59 PM', () => {
  const t = { text: 'Pay rent', deadline: at(23, 59).toISOString() };
  assert.equal(spokenWhen(t, at(8)), 'today');
  assert.doesNotMatch(introText('manual_trigger', [t], at(8)), /11:59|23:59/);
  assert.match(introText('manual_trigger', [t], at(8)), /Pay rent, today/);
});

test('only the morning briefing says "Good morning"', () => {
  const t = [{ text: 'a', deadline: at(15).toISOString() }];
  assert.match(introText('morning_briefing', t, at(8)), /^Good morning!/);
  assert.doesNotMatch(introText('manual_trigger', t, at(21)), /Good morning/);
});

test('calls are on unless switched off', () => {
  assert.equal(callsEnabled({}), true);
  assert.equal(callsEnabled(undefined), true);
  assert.equal(callsEnabled({ voiceCalls: false }), false);
});

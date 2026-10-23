import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDateShortcut, rankTasks, isBlocked, blockersOf, plannedMinutes, minutesLabel, columnOf, assignmentStatus, subProgress } from './taskMeta.js';

const NOW = new Date(2026, 9, 19, 10, 0, 0); // Monday 19 Oct 2026
const ymd = (d) => d && `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

test('date shortcuts', () => {
  assert.equal(ymd(parseDateShortcut('+1d', NOW)), '2026-10-20');
  assert.equal(ymd(parseDateShortcut('+2w', NOW)), '2026-11-02');
  assert.equal(ymd(parseDateShortcut('+1m', NOW)), '2026-11-19');
  assert.equal(ymd(parseDateShortcut('+3', NOW)), '2026-10-22');
  assert.equal(ymd(parseDateShortcut('tomorrow', NOW)), '2026-10-20');
  assert.equal(ymd(parseDateShortcut('fri', NOW)), '2026-10-23');
  assert.equal(ymd(parseDateShortcut('next mon', NOW)), '2026-10-26');
  assert.equal(ymd(parseDateShortcut('next week', NOW)), '2026-10-26');
  assert.equal(ymd(parseDateShortcut('2026-12-01', NOW)), '2026-12-01');
  assert.equal(parseDateShortcut('', NOW), null);
  assert.equal(parseDateShortcut('whenever', NOW), null);
});

test('blocked tasks, planned time and board columns', () => {
  const a = { id: 'a', text: 'A', completed: false };
  const b = { id: 'b', text: 'B', completed: false, meta: { dependsOn: ['a'], estimateMin: 90, subtasks: [{ done: true }, { done: false }] } };
  const all = [a, b];
  assert.equal(isBlocked(b, all), true);
  assert.deepEqual(blockersOf(b, all).map((x) => x.id), ['a']);
  assert.equal(isBlocked(b, [{ ...a, completed: true }, b]), false);
  assert.equal(plannedMinutes([a, b, { ...b, completed: true }]), 90);
  assert.equal(minutesLabel(90), '1 h 30 min');
  assert.deepEqual(subProgress(b), { done: 1, total: 2 });
  assert.equal(columnOf({ completed: false, meta: { status: 'doing' } }), 'doing');
  assert.equal(columnOf({ completed: true }), 'done');
  assert.equal(assignmentStatus({ completed: false, meta: { astatus: 'in-progress' } }), 'in-progress');
  assert.equal(assignmentStatus({ completed: true }), 'submitted');
});

test('what next: overdue and weak topics first, blocked and skipped left out', () => {
  const day = (n) => new Date(2026, 9, 19 + n, 23, 59).toISOString();
  const todos = [
    { id: '1', text: 'later', priority: 'low', deadline: day(5) },
    { id: '2', text: 'overdue', priority: 'medium', deadline: day(-2) },
    { id: '3', text: 'today weak', priority: 'high', deadline: day(0), todoTags: ['sql'] },
    { id: '4', text: 'blocked', priority: 'high', deadline: day(-9), meta: { dependsOn: ['1'] } },
  ];
  const mastery = new Map([['sql', { score: 30 }]]);
  const r = rankTasks(todos, mastery, [], NOW);
  assert.deepEqual(r.map((x) => x.task.id), ['3', '2', '1']);
  assert.ok(r[0].why.includes('due today') && r[0].why.some((w) => /weak/.test(w)));
  assert.deepEqual(rankTasks(todos, mastery, ['3'], NOW).map((x) => x.task.id), ['2', '1']);
});

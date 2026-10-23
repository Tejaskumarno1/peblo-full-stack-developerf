import assert from 'node:assert/strict';
import { filterTasks, sortTasks, groupTasks, isOverdue } from './taskView.js';

const now = new Date('2026-10-22T12:00:00');
const h = { whenOf: (t) => (t.deadline ? new Date(t.deadline) : null), tagsOf: (t) => t.tags || [], isMeeting: (t) => !!(t.deadline && t.startTime) };
const T = (id, text, o = {}) => ({ id, text, completed: false, priority: 'medium', ...o });
const all = [
  T('a', 'Pay rent', { deadline: '2026-10-20T09:00:00', priority: 'high', tags: ['home'] }),
  T('b', 'Revise BCNF', { deadline: '2026-10-22T18:00:00', tags: ['exams'] }),
  T('c', 'Call mum', { deadline: '2026-10-23T10:00:00', priority: 'low' }),
  T('d', 'Someday', {}),
  T('e', 'Standup', { deadline: '2026-10-22T15:00:00', startTime: '15:00' }),
  T('f', 'Done thing', { completed: true, deadline: '2026-10-19T09:00:00' }),
];

assert.deepEqual(filterTasks(all, { show: 'open' }, h, now).map((t) => t.id), ['a', 'b', 'c', 'd', 'e']);
assert.deepEqual(filterTasks(all, { show: 'done' }, h, now).map((t) => t.id), ['f']);
assert.deepEqual(filterTasks(all, { show: 'overdue' }, h, now).map((t) => t.id), ['a']);
assert.deepEqual(filterTasks(all, { show: 'nodate' }, h, now).map((t) => t.id), ['d']);
assert.deepEqual(filterTasks(all, { show: 'meetings' }, h, now).map((t) => t.id), ['e']);
assert.equal(filterTasks(all, { show: 'all' }, h, now).length, 6);
assert.deepEqual(filterTasks(all, { show: 'all', q: 'EXAMS' }, h, now).map((t) => t.id), ['b'], 'search matches tags, any case');
assert.deepEqual(filterTasks(all, { show: 'all', q: 'rent' }, h, now).map((t) => t.id), ['a']);
assert.equal(isOverdue(all[4], h, now), false, 'a meeting earlier today is not overdue');

assert.deepEqual(sortTasks(all, 'due', h).map((t) => t.id), ['f', 'a', 'e', 'b', 'c', 'd']);
assert.deepEqual(sortTasks(all, 'priority', h).slice(0, 2).map((t) => t.id), ['a', 'f']);
assert.deepEqual(sortTasks(all, 'az', h).map((t) => t.text).slice(0, 2), ['Call mum', 'Done thing']);

const due = groupTasks(filterTasks(all, { show: 'open' }, h, now), 'due', h, now);
assert.deepEqual(due.map((g) => g.label), ['Overdue', 'Today', 'Tomorrow', 'No date']);
assert.deepEqual(due[1].items.map((t) => t.id), ['b', 'e']);
const pri = groupTasks(all, 'priority', h, now);
assert.deepEqual(pri.map((g) => g.key), ['high', 'medium', 'low']);
const tag = groupTasks(filterTasks(all, { show: 'open' }, h, now), 'tag', h, now);
assert.deepEqual(tag.map((g) => g.label), ['#exams', '#home', 'No tag']);
assert.equal(groupTasks(all, 'none', h, now).length, 1);

console.log('taskView ok');

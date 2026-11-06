import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTimeline, minutesOf, hhmm } from './homeTimeline.js';

const T = (id, time) => ({ id, time });
const timeOf = (t) => t.time;

test('minutesOf reads HH:MM and rejects the rest', () => {
  assert.equal(minutesOf('14:30'), 870);
  assert.equal(minutesOf(''), null);
  assert.equal(minutesOf('soon'), null);
  assert.equal(hhmm(870), '14:30');
});
test('Now sits between past and upcoming tasks and says when you are free until', () => {
  const rows = buildTimeline([T('a', '14:00'), T('b', '08:30'), T('c', '16:00'), T('d', '')], timeOf, 10 * 60 + 20);
  assert.deepEqual(rows.map((r) => (r.type === 'now' ? 'NOW' : r.task.id)), ['b', 'NOW', 'a', 'c', 'd']);
  assert.equal(rows[1].until, 14 * 60);
});
test('after the last task you are free for the rest of the day', () => {
  const rows = buildTimeline([T('a', '08:30')], timeOf, 20 * 60);
  assert.equal(rows.at(-1).type, 'now');
  assert.equal(rows.at(-1).until, null);
});
test('no tasks gives just the Now row', () => {
  assert.deepEqual(buildTimeline([], timeOf, 600), [{ type: 'now', until: null }]);
});

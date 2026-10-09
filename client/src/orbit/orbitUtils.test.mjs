import test from 'node:test';
import assert from 'node:assert/strict';
import { revisionPath, topicName } from './orbitUtils.js';

const T = (name, score, count) => ({ kind: 'topic', name, score, count });

test('revision path keeps never-quizzed topics after the weak ones (PEB-84)', () => {
  const { steps } = revisionPath([T('strong', 95, 5), T('new-a', null, 4), T('new-b', null, 9), T('new-c', null, 1)]);
  assert.deepEqual(steps.map((s) => s.name), ['new-b', 'new-a', 'new-c']);
});
test('weak topics come first, weakest first, then unquizzed, max three', () => {
  const { steps } = revisionPath([T('ok', 70, 3), T('weak', 20, 2), T('new', null, 8), T('strong', 90, 9)]);
  assert.deepEqual(steps.map((s) => s.name), ['weak', 'ok', 'new']);
});
test('nothing to revise when every topic is strong', () => {
  assert.equal(revisionPath([T('a', 90, 1), T('b', 85, 2)]).steps.length, 0);
});
test('before any quiz the biggest topics are shown', () => {
  assert.deepEqual(revisionPath([T('s', null, 1), T('b', null, 5)]).steps.map((s) => s.name), ['b', 's']);
});
test('topicName keeps small words lower-case but upper-cases acronyms', () => {
  assert.equal(topicName('theory-of-computation'), 'Theory of computation');
  assert.equal(topicName('dsa'), 'DSA');
  assert.equal(topicName('sql-joins'), 'SQL joins');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { addView, renameView, updateView, duplicateView, removeView, uniqueName, sameView, snapshot, describe, loadViews, storeViews } from './viewStore.js';

const snap = { q: 'spec', pill: 'high', lg: 'tag', ls: 'priority' };

test('add keeps the current search, filter, group and sort', () => {
  const v = addView([], 'Work', snap, 'a');
  assert.deepEqual(v, [{ id: 'a', name: 'Work', ...snap }]);
});
test('names stay unique and an empty name gets a default', () => {
  let v = addView([], 'Work', snap, 'a');
  v = addView(v, 'work', snap, 'b');
  assert.equal(v[1].name, 'work 2');
  assert.equal(uniqueName('  ', v), 'Untitled view');
});
test('rename, update, duplicate, delete', () => {
  let v = addView([], 'Work', snap, 'a');
  v = renameView(v, 'a', 'Focus');
  assert.equal(v[0].name, 'Focus');
  v = updateView(v, 'a', { q: '', pill: 'today', lg: 'when', ls: 'due' });
  assert.equal(v[0].pill, 'today');
  v = duplicateView(v, 'a');
  assert.equal(v.length, 2);
  assert.equal(v[1].name, 'Focus copy');
  v = removeView(v, 'a');
  assert.deepEqual(v.map((x) => x.name), ['Focus copy']);
});
test('sameView ignores id and name', () => {
  assert.ok(sameView({ id: 1, name: 'x', ...snap }, snapshot(snap)));
  assert.ok(!sameView({ ...snap }, { ...snap, ls: 'az' }));
});
test('describe lists what is remembered', () => {
  assert.deepEqual(describe(snap), ['Search: spec', 'Filter: High priority', 'Group: Tag', 'Sort: Priority']);
});
test('storage round trip and bad data', () => {
  const m = new Map();
  const st = { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) };
  storeViews([{ id: 'a', name: 'A', ...snap }], st);
  assert.equal(loadViews(st).length, 1);
  m.set('peblo-task-views', '{oops');
  assert.deepEqual(loadViews(st), []);
});


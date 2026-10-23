import test from 'node:test';
import assert from 'node:assert/strict';
import { hiddenClusters, nextHidden } from './hidden.js';

const it = (id, x, row) => ({ id, x, row });

test('items in the first 3 rows are not hidden', () => {
  assert.deepEqual(hiddenClusters([it('a', 0, 0), it('b', 0, 1), it('c', 0, 2)]), []);
});

test('deeper items are grouped by position, one button per group', () => {
  const c = hiddenClusters([it('a', 0, 0), it('d', 40, 3), it('e', 90, 4), it('f', 900, 3)]);
  assert.equal(c.length, 2);
  assert.deepEqual(c[0].items.map((i) => i.id), ['d', 'e']);
  assert.deepEqual(c[1].items.map((i) => i.id), ['f']);
});

test('pressing the button again walks through every hidden item, then loops', () => {
  const [c] = hiddenClusters([it('d', 40, 3), it('e', 90, 4)]);
  const first = nextHidden(c, 'x', (i) => i.id);
  assert.equal(first.item.id, 'd');
  assert.equal(first.total, 2);
  const second = nextHidden(c, 'd', (i) => i.id);
  assert.equal(second.item.id, 'e');
  assert.equal(nextHidden(c, 'e', (i) => i.id).item.id, 'd');
});

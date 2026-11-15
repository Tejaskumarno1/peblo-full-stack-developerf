import test from 'node:test';
import assert from 'node:assert/strict';
import { normalize, load, store, apply, SIZES } from './a11yPrefs.js';

test('normalize keeps good values and drops bad ones', () => {
  assert.deepEqual(normalize({ size: 'XL', motion: true, contrast: 'yes', focus: 1 }), { size: 'XL', motion: true, contrast: false, focus: false });
  assert.deepEqual(normalize(null), { size: 'M', motion: false, contrast: false, focus: false });
  assert.equal(normalize({ size: 'HUGE' }).size, 'M');
});
test('store and load round trip, bad JSON falls back', () => {
  const m = new Map();
  const st = { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) };
  store({ size: 'L', motion: true }, st);
  assert.equal(load(st).size, 'L');
  assert.equal(load(st).motion, true);
  m.set('peblo-a11y', 'nope');
  assert.equal(load(st).size, 'M');
});
test('apply sets zoom and attributes on the root', () => {
  const attrs = new Set();
  const tag = { textContent: '' };
  const root = { setAttribute() {}, ownerDocument: { getElementById: () => tag }, toggleAttribute: (n, on) => (on ? attrs.add(n) : attrs.delete(n)) };
  apply({ size: 'L', motion: true, contrast: false, focus: true }, root);
  assert.equal(tag.textContent, `html { zoom: ${SIZES.L}; }`);
  assert.deepEqual([...attrs].sort(), ['data-a11y-focus', 'data-a11y-motion']);
  apply({ size: 'M' }, root);
  assert.equal(tag.textContent, '');
  assert.equal(attrs.size, 0);
});

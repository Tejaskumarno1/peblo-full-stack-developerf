import assert from 'node:assert/strict';
import { folderCounts } from './folderCounts.js';
import { inFolder, smartMatch } from './folders.js';

const defs = [
  { id: 'a', name: 'Alpha', tag: 'alpha' },
  { id: 'b', name: 'Beta', parent: 'a' },
  { id: 'c', name: 'Gamma', tag: 'g' },
  { id: 's', name: 'Smart', smart: [{ f: 'tag', v: 'x' }] },
];
const notes = [
  { id: 1, meta: { folder: 'Alpha' }, tags: [] },
  { id: 2, meta: { folder: 'Beta' }, tags: ['alpha'] },
  { id: 3, meta: {}, tags: ['alpha', 'g'] },
  { id: 4, meta: {}, tags: ['x'] },
  { id: 5, meta: { folder: 'Gamma' }, tags: ['alpha', 'x'] },
  { id: 6, meta: {}, tags: [] },
];
for (const subs of [false, true]) {
  const got = folderCounts(notes, defs, subs);
  for (const d of defs) {
    const want = notes.filter((n) => (d.smart ? smartMatch(n, d.smart) : inFolder(n, d, defs, subs))).length;
    assert.equal(got.get(d.id), want, `${d.name} subs=${subs}: ${got.get(d.id)} vs ${want}`);
  }
}
console.log('folderCounts tests passed');

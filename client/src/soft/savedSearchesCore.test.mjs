// Run: node client/src/soft/savedSearchesCore.test.mjs
import assert from 'node:assert/strict';
import { cleanSaved, addSaved, dropSaved, resolveSaved, SAVED_MAX } from './savedSearchesCore.js';

assert.equal(SAVED_MAX, 8);
assert.deepEqual(cleanSaved(['a', ' a ', '', 5, 'b']), ['a', 'b']);
assert.deepEqual(cleanSaved('nope'), []);
assert.equal(cleanSaved(Array.from({ length: 20 }, (_, i) => `q${i}`)).length, 8);
assert.deepEqual(addSaved(['a'], ' b '), ['b', 'a']);
assert.deepEqual(addSaved(['a'], 'a'), ['a'], 'no duplicates');
assert.deepEqual(addSaved(['a'], '  '), ['a']);
assert.equal(addSaved(Array.from({ length: 8 }, (_, i) => `q${i}`), 'new').length, 8, 'max 8');
assert.equal(addSaved(Array.from({ length: 8 }, (_, i) => `q${i}`), 'new')[0], 'new');
assert.deepEqual(dropSaved(['a', 'b'], 'a'), ['b']);
assert.deepEqual(resolveSaved(['x'], ['y']), { list: ['x'], migrate: false }, 'the account wins');
assert.deepEqual(resolveSaved([], ['y']), { list: [], migrate: false }, 'an empty account list is a real choice');
assert.deepEqual(resolveSaved(undefined, ['y']), { list: ['y'], migrate: true }, 'device list moves up once');
assert.deepEqual(resolveSaved(undefined, []), { list: [], migrate: false });
console.log('savedSearchesCore.test.mjs: all checks passed');

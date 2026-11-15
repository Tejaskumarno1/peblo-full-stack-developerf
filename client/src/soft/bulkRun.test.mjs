import assert from 'node:assert/strict';
import { bulkRun, partialText } from './bulkRun.js';

const items = (n) => Array.from({ length: n }, (_, i) => ({ id: `n${i}`, title: `Note ${i}` }));
const tick = (ms) => new Promise((r) => setTimeout(r, ms));
const err = (status, msg) => Object.assign(new Error(msg || 'x'), { response: { status, data: msg ? { error: msg } : undefined, headers: {} } });

// all succeed
let r = await bulkRun(items(7), async () => {});
assert.equal(r.done.length, 7); assert.equal(r.failed.length, 0);

// never more than 5 at once
let cur = 0; let max = 0;
r = await bulkRun(items(20), async () => { cur++; max = Math.max(max, cur); await tick(5); cur--; });
assert.equal(max, 5, `max concurrency ${max}`); assert.equal(r.done.length, 20);

// custom concurrency, and an empty list
cur = 0; max = 0;
await bulkRun(items(6), async () => { cur++; max = Math.max(max, cur); await tick(5); cur--; }, { concurrency: 2 });
assert.equal(max, 2);
r = await bulkRun([], async () => { throw new Error('never'); });
assert.deepEqual(r, { done: [], failed: [] });

// a 429 is retried once and then counts as done
const calls = {};
r = await bulkRun(items(3), async (it) => { calls[it.id] = (calls[it.id] || 0) + 1; if (it.id === 'n1' && calls[it.id] === 1) throw err(429); }, { retryWait: 10 });
assert.equal(calls.n1, 2); assert.equal(r.done.length, 3); assert.equal(r.failed.length, 0);

// a second 429 fails; other errors are not retried; failures carry id, title and reason
const c2 = {};
r = await bulkRun(items(3), async (it) => { c2[it.id] = (c2[it.id] || 0) + 1; if (it.id === 'n0') throw err(429, 'Too many requests'); if (it.id === 'n2') throw err(500, 'boom'); }, { retryWait: 10 });
assert.equal(c2.n0, 2, 'retried once only'); assert.equal(c2.n2, 1, '500 is not retried');
assert.deepEqual(r.done, ['n1']);
assert.equal(r.failed.length, 2);
const f2 = r.failed.find((f) => f.id === 'n2');
assert.equal(f2.title, 'Note 2'); assert.match(f2.error, /boom/);
assert.equal(partialText(r, 3), '1 of 3 done, 2 failed');

// a plain Error and a missing title
r = await bulkRun([{ id: 'a' }], async () => { throw new Error('offline'); });
assert.equal(r.failed[0].title, 'Untitled'); assert.equal(r.failed[0].error, 'offline');

console.log('bulkRun tests passed');

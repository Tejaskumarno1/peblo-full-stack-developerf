import assert from 'node:assert/strict';
import { bulkRun, partialText, actionOf, planBulk, recordCall } from './bulkRun.js';

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

// ---- R37: one request for the whole list when every item is the same notes action ----
const fakeApi = (handler) => {
  const api = { sent: [], real: [] };
  const realCall = (method) => (url, a, b) => { api.real.push({ method, url, a, b }); return Promise.resolve({ data: {} }); };
  api.patch = realCall('patch'); api.delete = realCall('delete');
  api.post = (url, body, cfg) => { if (url === '/notes/bulk') { api.sent.push(body); return handler(body); } return realCall('post')(url, body, cfg); };
  return api;
};
// stand-ins for notesAPI calls made through the client (same shapes as client/src/api/index.js)
const N = (api) => ({
  update: (id, data, cfg) => api.patch(`/notes/${id}`, data, cfg),
  delete: (id, opts) => api.delete(`/notes/${id}`, opts?.permanent ? { params: { permanent: 1 } } : undefined),
  restore: (id) => api.post(`/notes/${id}/restore`),
});
const ok = (body) => Promise.resolve({ data: { action: body.action, done: body.ids, failed: [] } });

// action recognition
const call = (method, url, data, cfg) => ({ method, url, data, cfg });
assert.deepEqual(actionOf(call('patch', '/notes/a', { isArchived: true }), 'a'), { action: 'archive' });
assert.deepEqual(actionOf(call('patch', '/notes/a', { isArchived: false }), 'a'), { action: 'unarchive' });
assert.deepEqual(actionOf(call('delete', '/notes/a'), 'a'), { action: 'trash' });
assert.equal(actionOf(call('delete', '/notes/a', undefined, { params: { permanent: 1 } }), 'a'), null, 'delete forever stays per note');
assert.deepEqual(actionOf(call('post', '/notes/a/restore'), 'a'), { action: 'restore' });
assert.equal(actionOf(call('post', '/notes/a/archive'), 'a'), null, 'the archive toggle is not a bulk action');
assert.deepEqual(actionOf(call('patch', '/notes/a', { meta: { pinned: true } }), 'a'), { action: 'pin' });
assert.deepEqual(actionOf(call('patch', '/notes/a', { meta: { pinned: false } }), 'a'), { action: 'unpin' });
assert.deepEqual(actionOf(call('patch', '/notes/a', { meta: { folder: 'Work' } }), 'a'), { action: 'move', folder: 'Work' });
assert.deepEqual(actionOf(call('patch', '/notes/a', { meta: { folder: '' } }), 'a'), { action: 'move', folder: '' });
assert.equal(actionOf(call('patch', '/notes/a', { meta: { folder: 'W' }, tags: ['x'] }), 'a'), null, 'move that also drops tags stays per note');
assert.deepEqual(actionOf(call('patch', '/notes/a', { tags: ['x', 'new'] }), 'a'), { action: 'tag', tag: 'new' });
assert.equal(actionOf(call('patch', '/notes/b', { isArchived: true }), 'a'), null, 'url must name the item');
assert.equal(actionOf(call('patch', '/notes/a', { title: 'x' }), 'a'), null);
assert.equal(actionOf(call('patch', '/notes/a', { isArchived: true }, { spaceOverride: 's' }), 'a'), null);

// recording never sends anything and puts the real methods back
{
  const api = fakeApi(ok); const realPatch = api.patch;
  const c = recordCall(api, (it) => N(api).update(it.id, { isArchived: true }), { id: 'a' });
  assert.equal(c.method, 'patch'); assert.equal(api.real.length, 0); assert.equal(api.patch, realPatch);
  assert.equal(recordCall(api, () => { throw new Error('x'); }, { id: 'a' }), null);
  assert.equal(api.patch, realPatch, 'restored after a throw');
  assert.equal(recordCall(api, async () => {}, { id: 'a' }), null, 'no call recorded');
}

// archive of 3 notes: one request, nothing per note, same result shape
{
  const api = fakeApi(ok);
  r = await bulkRun(items(3), (it) => N(api).update(it.id, { isArchived: true }), { api });
  assert.equal(api.sent.length, 1); assert.deepEqual(api.sent[0], { action: 'archive', ids: ['n0', 'n1', 'n2'] });
  assert.equal(api.real.length, 0); assert.deepEqual(r, { done: ['n0', 'n1', 'n2'], failed: [] });
}

// server failures per note keep id, title and reason
{
  const api = fakeApi((b) => Promise.resolve({ data: { action: b.action, done: ['n0'], failed: [{ id: 'n1', error: 'Only the author or a space lead can do that.', code: 'owner_only' }] } }));
  r = await bulkRun(items(3), (it) => N(api).delete(it.id), { api });
  assert.deepEqual(api.sent[0], { action: 'trash', ids: ['n0', 'n1', 'n2'] });
  assert.deepEqual(r.done, ['n0']);
  assert.equal(r.failed.length, 2);
  assert.equal(r.failed[0].title, 'Note 1'); assert.match(r.failed[0].error, /space lead/);
  assert.match(r.failed[1].error, /No answer/, 'an id the server did not mention counts as failed');
}

// an older server (404): falls back to one request per note, and each runs exactly once
{
  const api = fakeApi(() => Promise.reject(Object.assign(new Error('nf'), { response: { status: 404, data: {}, headers: {} } })));
  r = await bulkRun(items(4), (it) => N(api).update(it.id, { meta: { pinned: true } }), { api });
  assert.equal(api.sent.length, 1);
  assert.equal(api.real.length, 4); assert.ok(api.real.every((c) => c.method === 'patch'));
  assert.equal(r.done.length, 4);
}

// a 429 on the bulk request is retried once
{
  let n = 0;
  const api = fakeApi((b) => (++n === 1 ? Promise.reject(Object.assign(new Error('slow'), { response: { status: 429, data: {}, headers: {} } })) : ok(b)));
  r = await bulkRun(items(2), (it) => N(api).restore(it.id), { api, retryWait: 5 });
  assert.equal(api.sent.length, 2); assert.equal(api.real.length, 0); assert.equal(r.done.length, 2);
}

// mixed actions, a move with different folders, and delete forever: per note
{
  const api = fakeApi(ok);
  await bulkRun(items(2), (it) => (it.id === 'n0' ? N(api).delete(it.id) : N(api).update(it.id, { isArchived: true })), { api });
  await bulkRun(items(2), (it) => N(api).update(it.id, { meta: { folder: it.id } }), { api });
  await bulkRun(items(2), (it) => N(api).delete(it.id, { permanent: true }), { api });
  assert.equal(api.sent.length, 0); assert.equal(api.real.length, 6);
}

// tag and move go with their parameter; 1200 ids go in 3 requests of at most 500
{
  const api = fakeApi(ok);
  await bulkRun(items(2), (it) => N(api).update(it.id, { tags: ['old', 'idea'] }), { api });
  assert.deepEqual(api.sent[0], { action: 'tag', tag: 'idea', ids: ['n0', 'n1'] });
  await bulkRun(items(2), (it) => N(api).update(it.id, { meta: { folder: 'Work' } }), { api });
  assert.deepEqual(api.sent[1], { action: 'move', folder: 'Work', ids: ['n0', 'n1'] });
  api.sent.length = 0;
  r = await bulkRun(items(1200), (it) => N(api).update(it.id, { meta: { pinned: false } }), { api });
  assert.deepEqual(api.sent.map((b) => b.ids.length), [500, 500, 200]); assert.equal(r.done.length, 1200);
}

assert.equal(planBulk(fakeApi(ok), [], () => {}), null);
// api:false turns the one-request path off
{
  const api = fakeApi(ok);
  await bulkRun(items(2), (it) => N(api).update(it.id, { isArchived: true }), { api: false });
  assert.equal(api.sent.length, 0); assert.equal(api.real.length, 2);
}

console.log('bulkRun tests passed');

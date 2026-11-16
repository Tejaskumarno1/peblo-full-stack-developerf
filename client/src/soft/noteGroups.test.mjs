// Run: node client/src/soft/noteGroups.test.mjs
import assert from 'node:assert/strict';
import { groupByTag, alsoIn, uniqueNotes, rowTags, rowTitle, rowStamp } from './noteGroups.js';

const a = { id: 'a', tags: ['work', 'plan'] };
const b = { id: 'b', tags: ['inbox', 'work'] };
const c = { id: 'c', tags: [] };
const d = { id: 'd', tags: ['inbox'] };
const e = { id: 'e' };
const g = groupByTag([a, b, c, d, e]);
const of = (t) => g.find((x) => x.tag === t)?.notes.map((n) => n.id);
assert.deepEqual(of('work'), ['a', 'b'], 'a note is under each of its tags');
assert.deepEqual(of('plan'), ['a']);
assert.deepEqual(of('untagged'), ['c', 'd', 'e'], 'no tag (or only inbox) is Untagged');
assert.equal(g[0].tag, 'untagged', 'biggest group first');
assert.equal(g.some((x) => x.tag === 'inbox'), false, 'inbox is not a group');
// counts: the groups add up to more than the notes, the distinct notes are right
assert.equal(g.reduce((s, x) => s + x.notes.length, 0), 6);
assert.equal(uniqueNotes(g.flatMap((x) => x.notes)).length, 5);
assert.deepEqual(uniqueNotes([a, a, b]).map((n) => n.id), ['a', 'b']);
// a tag listed twice on one note does not double it
assert.equal(groupByTag([{ id: 'z', tags: ['x', 'x'] }])[0].notes.length, 1);

assert.deepEqual(alsoIn(a, 'work'), ['plan']);
assert.deepEqual(alsoIn(b, 'work'), []);
assert.deepEqual(alsoIn(c, 'untagged'), []);

// rows: up to 2 tags, never inbox
assert.deepEqual(rowTags({ tags: ['inbox', 'a', 'b', 'c'] }), ['a', 'b']);
assert.deepEqual(rowTags({ tags: [] }), []);
assert.deepEqual(rowTags({}), []);
assert.match(rowTitle({ createdAt: '2026-01-05T10:00:00Z', updatedAt: '2026-02-06T10:00:00Z' }), /^Created .*2026.* · Edited .*2026/);
assert.equal(rowTitle({}), '');
assert.deepEqual(rowStamp({ createdAt: 'C', updatedAt: 'U' }, 'created'), { label: 'Created', at: 'C' });
assert.deepEqual(rowStamp({ createdAt: 'C', updatedAt: 'U' }, 'updated'), { label: '', at: 'U' });
assert.deepEqual(rowStamp({ updatedAt: 'U' }, 'created'), { label: '', at: 'U' });
console.log('noteGroups.test.mjs: all checks passed');

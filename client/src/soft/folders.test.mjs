// Folder membership rules. Run: node client/src/soft/folders.test.mjs
import assert from 'node:assert/strict';
import { inFolder, smartMatch } from './folders.js';

const A = { id: 'a', name: 'Project Alpha', tag: 'project' };
const B = { id: 'b', name: 'Project Beta', tag: 'project' };
const kid = { id: 'k', name: 'Design', parent: 'a' };
const defs = [A, B, kid];
const t = (n, d, subs = false) => inFolder(n, d, defs, subs);

// a note put in a folder belongs to that folder only, even when another folder collects its tag
const inA = { tags: ['project'], meta: { folder: 'Project Alpha' } };
assert.equal(t(inA, A), true);
assert.equal(t(inA, B), false, 'a note in Alpha must not also show in Beta');

// a note with no folder can be collected by a tag
const loose = { tags: ['project'], meta: {} };
assert.equal(t(loose, A), true);
assert.equal(t(loose, B), true);

// no folder and no matching tag: in no folder
assert.equal(t({ tags: [], meta: {} }, A), false);

// sub-folders count only when asked
const inKid = { tags: [], meta: { folder: 'Design' } };
assert.equal(t(inKid, A, false), false);
assert.equal(t(inKid, A, true), true);

// a folder without a collecting tag never collects by tag
assert.equal(inFolder({ tags: ['x'], meta: {} }, { id: 'c', name: 'Plain' }, defs, false), false);

// smart folders
assert.equal(smartMatch({ tags: ['a'], meta: {} }, [{ f: 'tag', v: 'a' }]), true);
assert.equal(smartMatch({ tags: ['a'], meta: {} }, []), false);

console.log('folders.test.mjs: all checks passed');

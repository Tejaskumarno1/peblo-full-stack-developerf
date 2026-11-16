// Folder membership rules. Run: node client/src/soft/folders.test.mjs
import assert from 'node:assert/strict';
import { inFolder, smartMatch, FOLDER_COLORS, darkTone, lightInk, contrast } from './folders.js';

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

// match mode: all (default) needs every rule, any needs one
const mixed = { tags: ['a'], title: 'Budget', snippet: 'Plan the year', meta: {} };
const both = [{ f: 'tag', v: 'a' }, { f: 'tag', v: 'zzz' }];
assert.equal(smartMatch(mixed, both), false);
assert.equal(smartMatch(mixed, both, 'all'), false);
assert.equal(smartMatch(mixed, both, 'any'), true);
assert.equal(smartMatch({ tags: ['q'], meta: {} }, both, 'any'), false);
assert.equal(smartMatch(mixed, [], 'any'), false, 'no rules never matches');

// "text contains": title or snippet, any case; falls back to content; an empty value matches nothing
assert.equal(smartMatch(mixed, [{ f: 'text', v: 'budget' }]), true);
assert.equal(smartMatch(mixed, [{ f: 'text', v: 'YEAR' }]), true);
assert.equal(smartMatch(mixed, [{ f: 'text', v: 'holiday' }]), false);
assert.equal(smartMatch({ title: 'x', content: 'long body with needle inside', meta: {} }, [{ f: 'text', v: 'needle' }]), true);
assert.equal(smartMatch(mixed, [{ f: 'text', v: '  ' }]), false);
assert.equal(smartMatch(mixed, [{ f: 'text', v: 'holiday' }, { f: 'text', v: 'plan' }], 'any'), true);

// folder colours: every one has a dark variant that stays readable on the dark and midnight pages
assert.ok(FOLDER_COLORS.length >= 12);
assert.equal(new Set(FOLDER_COLORS.map((c) => c[0])).size, FOLDER_COLORS.length);
for (const [k] of FOLDER_COLORS) {
  const d = darkTone(k);
  assert.ok(contrast(lightInk(k), FOLDER_COLORS.find((c) => c[0] === k)[1]) >= 4.5, `${k} icon on its light chip is at least 4.5:1`);
  for (const page of ['#1A1620', '#141019', '#07050A']) assert.ok(contrast(d.bg, page) >= 1.2, `${k} chip separates from ${page}`);
  assert.ok(contrast(d.fg, d.bg) >= 4.5, `${k} icon on its dark chip is at least 4.5:1 (${contrast(d.fg, d.bg).toFixed(2)})`);
}

console.log('folders.test.mjs: all checks passed');

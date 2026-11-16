// Run: node client/src/soft/viewMigrate.test.mjs
import assert from 'node:assert/strict';
import { migrateView } from './viewMigrate.js';
import { DEFAULT_VIEW } from './viewDefaults.js';

const load = (v) => ({ ...DEFAULT_VIEW, ...migrateView(v) });
assert.equal(DEFAULT_VIEW.subs, true);
assert.equal(load({ sort: 'title' }).subs, true, 'never set: on');
assert.equal(load({ sort: 'title', subs: false }).subs, true, 'old default false, never chosen: on');
assert.equal(load({ subs: false, subsSet: true }).subs, false, 'chosen off: stays off');
assert.equal(load({ subs: true, subsSet: true }).subs, true);
assert.equal(load({ subs: true }).subs, true);
assert.equal(load(null).subs, true);
assert.equal(load({ sort: 'title' }).sort, 'title', 'other choices are kept');
console.log('viewMigrate.test.mjs: all checks passed');

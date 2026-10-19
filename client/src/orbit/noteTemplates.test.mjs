import test from 'node:test';
import assert from 'node:assert/strict';
import { TEMPLATES, outlineOf, countMatches, replaceAll } from './noteTemplates.js';

test('templates have names and content', () => {
  assert.equal(TEMPLATES.length, 4);
  for (const t of TEMPLATES) { assert.ok(t.name && t.content.includes('##')); }
});

test('outlineOf finds headings and skips code fences', () => {
  const md = '# One\ntext\n## Two **b**\n```\n# not a heading\n```\n#### too deep\n### Three';
  assert.deepEqual(outlineOf(md), [
    { level: 1, text: 'One' }, { level: 2, text: 'Two b' }, { level: 3, text: 'Three' },
  ]);
});

test('countMatches and replaceAll', () => {
  assert.equal(countMatches('Cat cat CAT', 'cat'), 3);
  assert.equal(countMatches('Cat cat CAT', 'cat', { matchCase: true }), 1);
  assert.equal(countMatches('a.b a.b', 'a.b'), 2);
  assert.equal(countMatches('abc', ''), 0);
  const r = replaceAll('one two one', 'one', '$&1');
  assert.equal(r.text, '$&1 two $&1');
  assert.equal(r.count, 2);
});

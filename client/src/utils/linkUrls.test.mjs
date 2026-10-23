import test from 'node:test';
import assert from 'node:assert/strict';
import { extractUrls, hostOf } from './linkUrls.js';

test('skips half-typed urls', () => {
  assert.deepEqual(extractUrls('see https://'), []);
  assert.deepEqual(extractUrls('see https://exa'), []);
  assert.deepEqual(extractUrls('see http://a.'), []);
});
test('keeps complete urls, strips trailing punctuation, dedupes', () => {
  assert.deepEqual(
    extractUrls('go https://example.com/a, and https://example.com/a. also (https://foo.org/x)'),
    ['https://example.com/a', 'https://foo.org/x']
  );
});
test('localhost allowed, empty safe', () => {
  assert.deepEqual(extractUrls('http://localhost:3000/x'), ['http://localhost:3000/x']);
  assert.deepEqual(extractUrls(''), []);
  assert.deepEqual(extractUrls(null), []);
});
test('hostOf never throws', () => {
  assert.equal(hostOf('https://www.example.com/a'), 'example.com');
  assert.equal(hostOf('bad'), 'bad');
});

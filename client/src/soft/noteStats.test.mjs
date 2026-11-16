// Word counting. Run: node client/src/soft/noteStats.test.mjs
import assert from 'node:assert/strict';
import { countWords, noteStats } from './noteStats.js';

assert.equal(countWords(''), 0);
assert.equal(countWords(null), 0);
assert.equal(countWords('Hello world'), 2);
assert.equal(countWords('# Title\n\nSome **bold** and _italic_ text'), 6);
// list and task markers are not words
assert.equal(countWords('- one\n- two\n* three\n1. four\n- [ ] five\n- [x] six'), 6);
assert.equal(countWords('> quoted line here'), 3);
// pictures and URLs are not words; a link is its text
assert.equal(countWords('![a photo](https://x.test/a.png) caption'), 1);
assert.equal(countWords('see https://example.com/some/long/path now'), 2);
assert.equal(countWords('read [the guide](https://example.com/guide) today'), 4);
assert.equal(countWords('<figure><img src="x"><figcaption>cap</figcaption></figure> after'), 1);
// table borders and separator rows
assert.equal(countWords('| Name | Age |\n|------|:---:|\n| Ann | 31 |'), 4);
assert.equal(countWords('---\ntext'), 1);
// a code fence line is not a word, the code is
assert.equal(countWords('```js\nconst a = 1;\n```'), 3);
// unicode, numbers, hyphens and apostrophes
assert.equal(countWords("naïve café 2026 don't well-known"), 5);
assert.equal(countWords('— – -- ...'), 0);

const s = noteStats('one two three');
assert.equal(s.words, 3);
assert.equal(s.minutes, 1);
assert.equal(s.chars, 13);

console.log('noteStats.test.mjs: all checks passed');

import test from 'node:test';
import assert from 'node:assert/strict';
import { mentionsToText, mentionsToHtml, mentionsToChipWord } from './mentions.js';

const md = 'Ask [@Ana Lee](peblo-user:user-1234) and [@Bo](peblo-user:abcd1234) today';

test('exports: a mention is plain @Name, no link and no person id', () => {
  const out = mentionsToText(md);
  assert.equal(out, 'Ask @Ana Lee and @Bo today');
  assert.ok(!out.includes('peblo-user'));
});

test('preview: a mention becomes a chip span', () => {
  const out = mentionsToHtml(md);
  assert.ok(out.includes('<span class="pb-mention" data-user="user-1234">@Ana Lee</span>'));
});

test('compare: a chip is one word (no spaces inside) so the word diff keeps it whole', () => {
  const out = mentionsToChipWord(md);
  assert.ok(out.includes('<var>@Ana&nbsp;Lee</var>'));
  const chip = /<var>[^<]*<\/var>/.exec(out)[0];
  assert.ok(!/\s/.test(chip));
});

test('names are escaped', () => {
  assert.ok(!mentionsToChipWord('[@A&B](peblo-user:abcd1234)').includes('A&B<'));
});

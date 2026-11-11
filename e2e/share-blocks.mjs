// Content blocks on a read-only share page (S37): code with a Copy button, callouts, a link on its own line as a card, the quote style.
import { boot } from './lib.mjs';
import fs from 'node:fs';

const { base, api, ctx, check, finish } = await boot();
const shots = 'D:/Peblo/_shots';
try { fs.mkdirSync(shots, { recursive: true }); } catch { /* exists */ }
const md = [
  '## Every kind of block', '',
  'Plain text with **bold** and `inline code`.', '',
  '> Fewer rounds, clearer first brief. That is all they asked for.', '',
  '> \u2139\uFE0F **Heads up.** Reviews move to Tuesday from next week.', '',
  '> \u26A0\uFE0F Numbers are not signed off yet.', '',
  '```', 'const review = days.find(d => d.votes > 2);', 'send(review, client);', '```', '',
  'https://peblo.app/s/note/9fK2', '',
  '[Client brief template](https://example.com/brief/template)', '',
  'A normal paragraph with a [link](https://example.com) inside the text.',
].join('\n');

try {
  const note = (await api('POST', '/api/notes', { title: 'Blocks', content: md, tags: [] })).note;
  const tok = (await api('POST', `/api/share/note/${note.id}`, { edit: false, expiresInDays: 1 })).token;
  const c = await ctx.browser().newContext({ viewport: { width: 1440, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
  const g = await c.newPage();
  const errors = [];
  g.on('pageerror', (e) => errors.push(e.message));
  await g.goto(`${base}/s/note/${tok}`);
  await g.locator('article .doc').waitFor({ timeout: 15000 });

  const copy = g.getByTestId('code-copy');
  check('1 the code block has a Copy button', await copy.count() === 1);
  await copy.click();
  check('2 Copy says Copied', /Copied/.test(await copy.innerText()));
  const clip = await g.evaluate(() => navigator.clipboard.readText()).catch(() => '');
  check('3 the code is on the clipboard without the button label', /send\(review, client\);/.test(clip) && !/Copy/.test(clip), JSON.stringify(clip));

  const callouts = g.getByTestId('callout');
  check('4 two callouts (info and warning)', await callouts.count() === 2);
  check('5 callout symbol is replaced by an icon', !(await callouts.first().innerText()).includes('\u2139') && await callouts.first().locator('svg').count() === 1);
  check('6 callout keeps its text and bold', /Heads up\./.test(await callouts.first().innerText()) && await callouts.first().locator('b, strong').count() === 1);
  const plainQuote = g.locator('article .doc blockquote');
  check('7 a plain quote stays a quote with an accent bar', await plainQuote.count() === 1 && (await plainQuote.evaluate((el) => getComputedStyle(el).borderLeftWidth)) === '4px');

  const cards = g.getByTestId('link-card');
  check('8 a link on its own line becomes a card (two of them)', await cards.count() === 2);
  check('9 the card shows a title and the address', /peblo\.app/.test(await cards.first().innerText()) && /Client brief template/.test(await cards.nth(1).innerText()));
  check('10 the card opens the link safely', (await cards.first().getAttribute('rel')) === 'noopener noreferrer' && (await cards.first().getAttribute('target')) === '_blank');
  check('11 a link inside a sentence stays a link', await g.locator('article .doc p a', { hasText: 'link' }).count() === 1);
  check('12 no page errors', errors.length === 0, errors.join(' | '));
  await g.screenshot({ path: `${shots}/s37-light.png` });
  await g.evaluate(() => document.querySelector('.pb-shared')?.setAttribute('data-theme', 'dark'));
  await g.screenshot({ path: `${shots}/s37-dark.png` });
} catch (e) {
  check('no crash', false, String(e));
}
await finish();

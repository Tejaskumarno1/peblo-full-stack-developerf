// A shared page shows picture groups (grid / row) the way the owner laid them out.
import { boot } from './lib.mjs';
const { base, api, ctx, check, finish } = await boot();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const px = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
try {
  const md = ['Gallery', ...[1, 2, 3].map((i) => `![p${i}](${px}#gl=grid&gc=3)`), 'Row', ...[1, 2].map((i) => `![r${i}](${px}#gl=row)`), 'Plain', `![s1](${px})`, `![s2](${px})`].join('\n\n');
  const note = (await api('POST', '/api/notes', { title: 'Pictures share', content: md })).note;
  const tok = (await api('POST', `/api/share/note/${note.id}`, { edit: false })).token;
  const g = await (await ctx.browser().newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await g.goto(`${base}/s/note/${tok}`);
  await g.locator('.doc').waitFor({ timeout: 20000 }); await wait(500);
  const grid = g.locator('.doc .pic-group[data-gl="grid"]');
  check('Grid group is built from three pictures', (await grid.count()) === 1 && (await grid.locator('img').count()) === 3);
  check('Grid shows three columns', (await grid.evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length)) === 3);
  const row = g.locator('.doc .pic-group[data-gl="row"]');
  check('Row group has its two pictures side by side', (await row.count()) === 1 && (await row.locator('img').count()) === 2);
  const bs = await row.locator('img').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().top));
  check('Row pictures share one line', bs.length === 2 && Math.abs(bs[0] - bs[1]) < 2, bs.join(','));
  check('Plain pictures stay stacked (no group)', (await g.locator('.doc .pic-group').count()) === 2);
  await g.screenshot({ path: 'e2e/share-pictures.png' });
} catch (e) { check('Share pictures run without an error', false, String(e)); }
await finish();

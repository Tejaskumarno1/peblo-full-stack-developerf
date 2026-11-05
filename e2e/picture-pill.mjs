// Picture link pill: every picture on a share page has its full address as text and a link, with Copy; the markdown view lists them too.
import { boot } from './lib.mjs';
const { base, api, page, ctx, check, finish, token } = await boot({ freshPresence: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const A = 'https://example.com/pics/one.png';
let B = '';
try {
  // a real stored picture, so the server's markdown view knows it
  const tiny = Buffer.from('UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA', 'base64');
  const up = await (await fetch(`${base}/api/media`, { method: 'POST', headers: { 'Content-Type': 'image/webp', Authorization: `Bearer ${token}` }, body: tiny })).json();
  B = `/api/media/${up.id}`;
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
  const n = (await api('POST', '/api/notes', { title: 'Pills', content: `# Pills\n\nBefore.\n\n![First](${A})\n\nMiddle.\n\n![Second](${B})\n\nAfter.\n`, tags: [] })).note;
  const view = (await api('POST', `/api/share/note/${n.id}`, { edit: false })).token;
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`${base}/s/note/${view}`);
  await page.locator('.pb-shared .doc').waitFor({ timeout: 25000 });
  await wait(800);
  const pills = page.locator('[data-testid="pic-pill"]');
  check('1 each picture has a pill under it', (await pills.count()) === 2, String(await pills.count()));
  const hrefs = await page.locator('[data-testid="pic-pill-link"]').evaluateAll((els) => els.map((e) => e.href));
  check('2 the pill link is the full address', hrefs[0] === A && hrefs[1] === `${base}${B}`, JSON.stringify(hrefs));
  check('3 the full address is visible text too', (await page.locator('[data-testid="pic-pill-link"]').first().innerText()) === A);
  check('4 the page top has a Copy all picture links pill', (await page.locator('[data-testid="pic-all-copy"]').count()) === 1);
  await pills.first().locator('button').click(); await wait(500);
  const one = await page.evaluate(() => navigator.clipboard.readText());
  check('5 Copy puts that picture address on the clipboard', one === A, one);
  await page.locator('[data-testid="pic-all-copy"]').click(); await wait(500);
  const all = (await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, '\n');
  check('6 Copy all gives every address, one per line', all === `${A}\n${base}${B}`, all);
  const box = await pills.first().boundingBox();
  check('7 the pill fits the page width', box && box.x >= 0 && box.x + box.width <= 1280, JSON.stringify(box));
  await page.setViewportSize({ width: 390, height: 800 }); await wait(400);
  const over = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2);
  check('8 no sideways scrolling on a phone', !over);
  const md = await (await fetch(`${base}/s/note/${view}.md`)).text();
  check('9 the markdown view lists the pictures as plain text', /Pictures on this page \(1\)/.test(md) && md.includes(`${base}${B}`), md.slice(0, 400));
} catch (e) { check('crash: ' + e.message, false); }
await finish();

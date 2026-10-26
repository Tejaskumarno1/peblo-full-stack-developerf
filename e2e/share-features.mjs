// Share page features: welcome + colour, laser / spotlight / ping for presenters, return-to-presenter chip,
// margin comment badges, reading rail dots, cover header, phone action bar.
import { boot } from './lib.mjs';

const { base, api, page, ctx, check, finish } = await boot();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await fn()) return true; } catch { /* retry */ } await wait(150); } return false; };
const ready = async (p) => { await p.locator('.bn-editor').waitFor({ timeout: 20000 }); await p.locator('[data-testid="collab-status"]').waitFor({ state: 'detached', timeout: 20000 }).catch(() => {}); };
const paras = Array.from({ length: 50 }, (_, i) => `Paragraph number ${i + 1} ${'with some words to fill the line '.repeat(1 + (i % 3))}`).join('\n\n');
const blockOf = (p, text) => p.locator('.bn-editor .bn-block-content', { hasText: text }).first();

try {
  const note = (await api('POST', '/api/notes', { title: 'Share features', content: paras, tags: [] })).note;
  const tok = (await api('POST', `/api/share/note/${note.id}`, { edit: true })).token;
  await page.goto(base + '/notes/' + note.id);
  await ready(page);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  const gc = await ctx.browser().newContext({ viewport: { width: 1100, height: 760 } });
  const g = await gc.newPage();
  g.on('pageerror', (e) => errors.push(e.message));
  await g.goto(`${base}/s/note/${tok}`);
  await ready(g);
  check('1 cover header with chips', await g.locator('[data-testid="cover"] li').count() >= 2);
  check('2 welcome note for a new guest', await g.locator('[data-testid="welcome-note"]').isVisible());
  await g.getByLabel('Your name').fill('Mia');
  await g.getByLabel('Your name').blur();
  check('3 welcome note goes once named', await until(async () => (await g.locator('[data-testid="welcome-note"]').count()) === 0));
  const swatches = g.locator('[data-testid="guest-color"]');
  check('4 colour swatches offered', (await swatches.count()) >= 5);
  await swatches.nth(3).click();
  const picked = await swatches.nth(3).evaluate((el) => getComputedStyle(el).backgroundColor);
  await blockOf(g, 'Paragraph number 3 ').scrollIntoViewIfNeeded();
  const bb = await blockOf(g, 'Paragraph number 3 ').boundingBox();
  await wait(800);
  await g.mouse.move(bb.x + 60, bb.y + 8);
  await g.mouse.move(bb.x + 90, bb.y + 10);
  check('5 owner sees her pointer', await until(async () => (await page.locator('[data-testid="peer-pointer"][data-name="Mia"]').count()) >= 1));
  const seen = await page.locator('[data-testid="peer-pointer"][data-name="Mia"] .tag').first().evaluate((el) => getComputedStyle(el).backgroundColor).catch(() => '');
  check('6 pointer uses the chosen colour', seen === picked, `${seen} vs ${picked}`);

  await g.locator('[data-testid="present-btn"]').click();
  check('7 laser and spotlight tools shown', (await g.locator('[data-testid="tool-laser"]').count()) === 1 && (await g.locator('[data-testid="tool-spot"]').count()) === 1);
  await g.locator('[data-testid="tool-laser"]').click();
  await g.mouse.move(bb.x + 70, bb.y + 9);
  check('8 laser dot reaches the owner', await until(async () => (await page.locator('.pb-pointer.laser').count()) >= 1));
  await g.locator('[data-testid="tool-spot"]').click();
  await g.mouse.move(bb.x + 75, bb.y + 10);
  check('9 spotlight dims the owner page', await until(async () => (await page.locator('.pb-spot').count()) >= 1));
  await g.keyboard.down('Alt');
  await g.mouse.click(bb.x + 80, bb.y + 10);
  await g.keyboard.up('Alt');
  check('10 ping ripple on the owner page', await until(async () => (await page.locator('[data-testid="ping-ring"]').count()) >= 1));

  await page.locator('[data-testid="present-follow"]').click().catch(() => {});
  await wait(500);
  await page.mouse.move(600, 400);
  await page.mouse.wheel(0, 500);
  check('11 return-to-presenter chip after scrolling away', await until(async () => (await page.locator('[data-testid="return-presenter"]').count()) === 1, 5000));
  await page.locator('[data-testid="return-presenter"]').click();
  check('12 chip goes after returning', await until(async () => (await page.locator('[data-testid="return-presenter"]').count()) === 0));
  await g.locator('[data-testid="present-btn"]').click();

  check('13 reading rail dots', await until(async () => (await page.locator('[data-testid="rail-dot"]').count()) >= 1));

  await blockOf(g, 'Paragraph number 2 ').click({ clickCount: 3 });
  await g.locator('[data-testid="comments-button"]').click();
  await g.locator('[data-testid="comment-on-selection"]').click();
  await g.locator('[data-testid="comment-text"]').fill('Looks good');
  await g.locator('[data-testid="comment-send"]').click();
  check('14 margin badge appears on the commented block', await until(async () => (await g.locator('[data-testid="margin-badge"]').count()) >= 1, 8000));
  check('14b the owner sees it too', await until(async () => (await page.locator('[data-testid="margin-badge"]').count()) >= 1, 8000));
  if (await g.locator('[data-testid="comments-panel"]').count()) await g.locator('[data-testid="comments-button"]').click();
  await g.locator('[data-testid="margin-badge"]').first().click();
  check('14c clicking the badge opens the thread', await until(async () => (await g.locator('[data-testid="comments-panel"]').count()) === 1));

  const pc = await ctx.browser().newContext({ viewport: { width: 390, height: 780 } });
  const p = await pc.newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(`${base}/s/note/${tok}`);
  await ready(p);
  check('15 phone action bar shown', await p.locator('[data-testid="mbar"]').isVisible());
  check('16 desktop hides the bar', !(await g.locator('[data-testid="mbar"]').isVisible()));
  check('17 no sideways scroll on phone', await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  const outline = p.getByRole('button', { name: 'Outline' });
  if (await outline.count()) {
    await outline.click();
    check('18 outline sheet opens', await p.locator('[data-testid="toc-sheet"]').isVisible());
  }
  check('19 no crash', errors.length === 0, errors.join(' | '));
} catch (e) {
  check('crash: ' + e.message, false);
}
await finish();

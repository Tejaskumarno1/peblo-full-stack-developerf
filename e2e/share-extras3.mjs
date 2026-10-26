// Polls, read receipts, short link, style follow, extend ask - through the real screens.
import { boot } from './lib.mjs';

const { base, api, page, ctx, check, finish } = await boot();
const until = async (fn, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { try { if (await fn()) return true; } catch { /* retry */ } await new Promise((r) => setTimeout(r, 400)); } return false; };
try {
  const body = Array.from({ length: 60 }, (_, i) => `## Part ${i}\n\nParagraph ${i} with some words to make the page long enough to scroll.`).join('\n\n');
  const note = (await api('POST', '/api/notes', { title: 'Extras screens', content: `# Extras\n\n${body}`, tags: [] })).note;
  const tok = (await api('POST', `/api/share/note/${note.id}`, { edit: false, expiresInDays: 1 })).token;
  await page.addInitScript(() => { try { localStorage.setItem('peblo-collab-tip', '1'); } catch { /* ignore */ } });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${base}/notes/${note.id}`);
  await page.locator('.bn-editor').waitFor({ timeout: 15000 });
  await page.getByTestId('share-chips').getByRole('button', { name: /live collaboration/i }).click();
  await page.getByTestId('live-panel').waitFor({ timeout: 5000 });

  // owner: add a poll
  await page.getByTestId('poll-add').click();
  await page.getByTestId('pm-q').fill('Which day works?');
  await page.getByTestId('pm-opt-0').fill('Monday');
  await page.getByTestId('pm-opt-1').fill('Friday');
  await page.getByTestId('pm-create').click();
  check('owner sees the poll in the panel', await until(async () => (await page.getByTestId('pm-item').count()) === 1));

  // short link in the panel
  check('the panel shows a short link', await until(async () => /\/l\/[a-z0-9]{6}/.test(await page.getByTestId('short-link').innerText())));

  // guest
  const c = await ctx.browser().newContext({ viewport: { width: 1280, height: 800 } });
  const g = await c.newPage();
  await g.goto(`${base}/s/note/${tok}`);
  await g.locator('article .doc').waitFor({ timeout: 15000 });
  check('guest sees the poll card', await until(async () => (await g.getByTestId('page-poll').count()) === 1));
  await g.getByTestId('page-poll').scrollIntoViewIfNeeded().catch(() => {});
  await g.getByTestId('pp-opt-1').click();
  check('guest vote shows results', await until(async () => /1 · 100%/.test(await g.getByTestId('pp-count-1').innerText())));
  check('owner count goes up', await until(async () => /1 vote/.test(await page.getByTestId('pm-count').innerText())));
  await page.getByTestId('pm-close').click();
  check('closed poll cannot be voted on', await until(async () => await g.getByTestId('pp-opt-0').isDisabled()));

  // reading progress -> owner stats
  await g.evaluate(() => { const a = document.querySelector('article'); a.scrollTop = a.scrollHeight; a.dispatchEvent(new Event('scroll')); });
  await page.getByRole('tab', { name: 'Activity' }).click();
  check('owner sees where readers stop', await until(async () => (await page.getByTestId('reader-stats').count()) === 1, 25000));
  check('reader reached the end', await until(async () => /100%/.test(await page.getByTestId('reader-finish').innerText()), 25000));
  await page.screenshot({ path: 'C:/Users/tejas/peblo-e2e/extras3-owner.png' });

  // style follow
  const eff = await g.evaluate(() => document.documentElement.dataset.shareStyle);
  check('the page takes the owner style', ['soft', 'river', 'orbit'].includes(eff), String(eff));
  await g.evaluate(() => { const a = document.querySelector('article'); a.scrollTop = 0; a.dispatchEvent(new Event('scroll')); });
  await g.getByTestId('look-btn').click();
  await g.getByTestId('look-style-orbit').click();
  check('guest can choose a style', (await g.evaluate(() => document.documentElement.dataset.shareStyle)) === 'orbit');
  await g.getByTestId('look-style-follow').click();
  check('and go back to following the owner', (await g.evaluate(() => document.documentElement.dataset.shareStyle)) === eff);
  await g.keyboard.press('Escape');

  // extend ask
  await g.getByTestId('extend-ask').click();
  check('guest sees it was asked', await until(async () => (await g.getByTestId('extend-asked').count()) === 1));
  await page.getByRole('tab', { name: /people|viewers/i }).first().click().catch(() => {});
  check('owner sees the request', await until(async () => (await page.getByTestId('extend-request').count()) === 1, 15000));
  await page.getByTestId('extend-req-1').click();
  check('extending clears the request', await until(async () => (await page.getByTestId('extend-request').count()) === 0, 15000));
  await g.screenshot({ path: 'C:/Users/tejas/peblo-e2e/extras3-guest.png' });
} catch (e) { check('extras3 ran without error', false, String(e)); }
await finish();

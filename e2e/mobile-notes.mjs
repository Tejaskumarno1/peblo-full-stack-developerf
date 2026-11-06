// Phone-width check of the Notes list (folder cards, opened card, sections) and the Settings layout card.
import { boot } from './lib.mjs';
const b = await boot({ noteLayout: 'cards' });
const { page } = b;
try {
  for (const [t, tags] of [['Alpha note', ['work']], ['Beta note', ['work']], ['Gamma note', ['home']]]) await b.api('POST', '/api/notes', { title: t, content: '', tags });
  await page.setViewportSize({ width: 390, height: 780 });
  const noScroll = async (m) => b.check(`${m}: no horizontal scroll`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await page.goto(`${b.base}/notes`); await page.waitForTimeout(1500);
  await page.screenshot({ path: 'D:/Peblo/_shots/m-notes.png' });
  await noScroll('notes cards');
  b.check('cards visible on phone', await page.locator('.np-card.gcard').first().isVisible());
  await page.locator('.np-card.gcard').first().click(); await page.waitForTimeout(500);
  await page.screenshot({ path: 'D:/Peblo/_shots/m-open.png' });
  await noScroll('opened card');
  await page.goto(`${b.base}/settings/notes`); await page.waitForTimeout(1200);
  await page.screenshot({ path: 'D:/Peblo/_shots/m-settings.png', fullPage: true });
  await noScroll('settings');
  const r = await page.locator('.set-layout').first().boundingBox();
  b.check('layout tile fits the screen width', r && r.x >= 0 && r.x + r.width <= 390);
} catch (e) { b.check('no error: ' + e.message, false); }
await b.finish();

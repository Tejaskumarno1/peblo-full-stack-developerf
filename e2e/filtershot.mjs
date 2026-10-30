import { boot } from './lib.mjs';
const { base, api, page, check, finish } = await boot();
try {
  for (let i = 0; i < 8; i++) await api('POST', '/api/notes', { title: `Filter look ${i}`, content: 'hello', tags: [] });
  await page.addInitScript(() => { localStorage.setItem('peblo-style', 'soft'); });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(`${base}/notes`);
  await page.locator('.s-note-row').first().waitFor({ timeout: 15000 });
  // A browser window smaller than the 1440 x 900 design shows the screen scaled down: measure in the design's own pixels.
  const rowsBox = async () => (await page.locator('.s-notes-rows').boundingBox()).height / (parseFloat(await page.evaluate(() => document.documentElement.style.zoom)) || 1);
  const closed = await rowsBox();
  console.log('notes area height, filters folded:', Math.round(closed));
  check('extra view options are folded by default', (await page.getByRole('dialog', { name: 'View options' }).count()) === 0);
  check('the notes area has real room (>= 380px at 720px high)', closed >= 380, String(closed));
  await page.screenshot({ path: 'C:/Users/tejas/Documents/peblo-full-stack-developerf/.shots/list-closed.png' });
  await page.getByRole('button', { name: 'View', exact: true }).click(); // the View options dialog replaced the old .s-filters-toggle row
  const dlg = page.getByRole('dialog', { name: 'View options' });
  await dlg.waitFor();
  const seg = dlg.getByRole('radiogroup', { name: 'Sort by' });
  const st = await seg.evaluate((el) => { const c = getComputedStyle(el.querySelector('button')); return { border: c.borderTopWidth, weight: c.fontWeight, track: getComputedStyle(el).backgroundColor }; });
  const ref = await page.locator('.np-chip:not(.on)').first().evaluate((el) => { const c = getComputedStyle(el); return { bg: c.backgroundColor, weight: c.fontWeight }; });
  check('opened view options still match the pills', st.border === '0px' && st.track === ref.bg && st.weight === ref.weight, JSON.stringify([st, ref]));
  await page.screenshot({ path: 'C:/Users/tejas/Documents/peblo-full-stack-developerf/.shots/list-open.png' });
} catch (e) { check('ran', false, String(e)); } finally { await finish(); }

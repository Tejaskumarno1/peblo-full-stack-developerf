import { boot } from './lib.mjs';
const { base, api, page, check, finish } = await boot();
try {
  for (let i = 0; i < 8; i++) await api('POST', '/api/notes', { title: `Filter look ${i}`, content: 'hello', tags: [] });
  await page.addInitScript(() => { localStorage.setItem('peblo-style', 'soft'); });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(`${base}/notes`);
  await page.locator('.s-note-row').first().waitFor({ timeout: 15000 });
  const rowsBox = async () => (await page.locator('.s-notes-rows').boundingBox()).height;
  const closed = await rowsBox();
  console.log('notes area height, filters folded:', Math.round(closed));
  check('extra filters are folded by default', (await page.locator('.s-filters select').count()) === 0);
  check('the notes area has real room (>= 380px at 720px high)', closed >= 380, String(closed));
  await page.screenshot({ path: 'C:/Users/tejas/Documents/peblo-full-stack-developerf/.shots/list-closed.png' });
  await page.locator('.s-filters-toggle').click();
  const sel = page.locator('.s-filters select[aria-label="Edited"]');
  await sel.waitFor();
  const st = await sel.evaluate((el) => { const c = getComputedStyle(el); return { border: c.borderTopWidth, bg: c.backgroundColor, weight: c.fontWeight }; });
  const ref = await page.locator('.s-nt-btn').first().evaluate((el) => { const c = getComputedStyle(el); return { bg: c.backgroundColor, weight: c.fontWeight }; });
  check('opened filter still matches the pills', st.border === '0px' && st.bg === ref.bg && st.weight === ref.weight, JSON.stringify([st, ref]));
  await page.screenshot({ path: 'C:/Users/tejas/Documents/peblo-full-stack-developerf/.shots/list-open.png' });
} catch (e) { check('ran', false, String(e)); } finally { await finish(); }

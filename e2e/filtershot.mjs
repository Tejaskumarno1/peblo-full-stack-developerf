import { boot } from './lib.mjs';
const { base, api, page, check, finish } = await boot();
try {
  await api('POST', '/api/notes', { title: 'Filter look', content: 'hello', tags: [] });
  await page.addInitScript(() => { localStorage.setItem('peblo-style', 'soft'); });
  await page.goto(`${base}/notes`);
  const sel = page.locator('.s-filters select[aria-label="Edited"]');
  await sel.waitFor({ timeout: 15000 });
  const st = await sel.evaluate((el) => { const c = getComputedStyle(el); return { border: c.borderTopWidth, bg: c.backgroundColor, radius: c.borderTopLeftRadius, weight: c.fontWeight, app: c.appearance }; });
  console.log(JSON.stringify(st));
  const ref = await page.locator('.s-nt-btn').first().evaluate((el) => { const c = getComputedStyle(el); return { bg: c.backgroundColor, weight: c.fontWeight, size: c.fontSize }; });
  console.log(JSON.stringify(ref));
  check('select has no border', st.border === '0px', st.border);
  check('select matches pill background', st.bg === ref.bg, `${st.bg} vs ${ref.bg}`);
  check('select is bold like pills', st.weight === ref.weight, `${st.weight} vs ${ref.weight}`);
  await sel.focus(); await page.keyboard.press('Tab'); await sel.focus();
  await page.locator('.s-notes-list').screenshot({ path: 'C:/Users/tejas/Documents/peblo-full-stack-developerf/.shots/filters-after.png' });
} catch (e) { check('ran', false, String(e)); } finally { await finish(); }

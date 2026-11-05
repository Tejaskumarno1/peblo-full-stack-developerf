// Full screen: version history is in the Note tab, and the version box and margin comments panel open above the page and beside the drawer.
import { boot } from './lib.mjs';
const { base, api, page, check, finish } = await boot();
try {
  const note = (await api('POST', '/api/notes', { title: 'FS extras', content: 'The quick brown fox jumps.\n\nSecond line', tags: [] })).note;
  await api('POST', `/api/notes/${note.id}/versions`, { label: 'Before the cats' });
  await page.goto(base + '/notes/' + note.id);
  await page.locator('.bn-editor').waitFor({ timeout: 15000 });
  await page.locator('button[aria-label="Full screen"]').click();
  await page.locator('[data-testid="fs-bar"]').waitFor({ timeout: 5000 });
  await page.locator('[data-testid="fs-tab-note"]').click();
  const item = page.locator('[data-testid="menu-versions"]');
  await item.waitFor({ timeout: 5000 });
  check('Note tab lists Version history with a count', /Version history \(\d+ kept\)/.test(await item.innerText()), await item.innerText());
  await item.click(); await page.waitForTimeout(900);
  check('the version box opens in full screen', await page.getByText('Compare versions').first().isVisible().catch(() => false));
  const z = await page.evaluate(() => { const b = document.querySelector('.cb-back'); return b ? parseInt(getComputedStyle(b).zIndex, 10) : 0; });
  const fz = await page.evaluate(() => parseInt(getComputedStyle(document.querySelector('.fsx')).zIndex, 10));
  check('the version box is drawn above the full-screen bar and drawer', z > fz, `${z} vs ${fz}`);
  await page.keyboard.press('Escape'); await page.waitForTimeout(500);
  await page.locator('[data-testid="comments-button"]').first().click(); await page.waitForTimeout(800);
  const geo = await page.evaluate(() => { const p = document.querySelector('[data-testid="comments-panel"]'); const d = document.querySelector('[data-testid="fs-drawer"]'); if (!p) return null; const r = p.getBoundingClientRect(); const dr = d ? d.getBoundingClientRect() : null; return { l: r.left, r: r.right, t: r.top, b: r.bottom, dl: dr ? dr.left : null, vw: innerWidth, vh: innerHeight }; });
  check('comments panel opens in full screen', !!geo, JSON.stringify(geo));
  check('comments panel is on screen and does not cover the drawer', !!geo && geo.l >= 0 && geo.r <= geo.vw && geo.b <= geo.vh + 1 && (geo.dl == null || geo.r <= geo.dl + 1), JSON.stringify(geo));
  await page.screenshot({ path: 'D:\\Peblo\\_shots\\fs-comments.png' });
} catch (e) { check('no crash', false, String(e).slice(0, 300)); }
await finish();

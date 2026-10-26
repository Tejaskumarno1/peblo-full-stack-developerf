// Selecting text: the Explain / Make a task pill and the formatting toolbar never overlap, in light and dark.
import { boot } from './lib.mjs';
const { base, api, page, check, finish } = await boot();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const overlap = (a, b) => a && b && !(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y);
try {
  const n = (await api('POST', '/api/notes', { title: 'Overlap probe', content: 'First line of the note that we select\n\nSecond paragraph with more words to select later on.' })).note;
  for (const theme of ['light', 'dark']) {
    await page.goto(base + '/notes/' + n.id);
    await page.locator('.bn-editor').waitFor({ timeout: 20000 });
    await wait(1200);
    if (theme === 'dark') await page.evaluate(() => document.documentElement.classList.add('theme-dark') || document.body.classList.add('theme-dark'));
    for (const which of ['first', 'second']) {
      const para = page.locator('.bn-block-content').nth(which === 'first' ? 0 : 1);
      await para.click({ clickCount: 1, force: true }).catch(() => {});
      await para.evaluate((el) => { const r = document.createRange(); r.selectNodeContents(el); const s = window.getSelection(); s.removeAllRanges(); s.addRange(r); });
      await page.locator('.s-sel-pill').waitFor({ timeout: 5000 });
      await page.locator('.bn-toolbar').waitFor({ timeout: 5000 }).catch(() => {});
      await wait(700);
      const pill = await page.locator('.s-sel-pill').boundingBox();
      const tb = await page.locator('.bn-toolbar').boundingBox();
      check(`${theme} ${which} paragraph: pill clear of toolbar`, !overlap(pill, tb));
    }
  }
} catch (e) { check('no exception: ' + e.message, false); }
await finish();

// Selecting text: one bar only. The old floating Explain pill is gone; Ask lives inside the formatting bar, and its menu stays on screen in light and dark.
import { boot } from './lib.mjs';
const { base, api, page, check, finish } = await boot();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  const n = (await api('POST', '/api/notes', { title: 'Ask probe', content: 'First line of the note that we select\n\nSecond paragraph with more words to select later on.' })).note;
  for (const theme of ['light', 'dark']) {
    await page.goto(base + '/notes/' + n.id);
    await page.locator('.bn-editor').waitFor({ timeout: 20000 });
    await wait(1200);
    if (theme === 'dark') await page.evaluate(() => document.documentElement.classList.add('theme-dark') || document.body.classList.add('theme-dark'));
    for (const which of ['first', 'second']) {
      const para = page.locator('.bn-block-content').nth(which === 'first' ? 0 : 1);
      await para.click({ force: true }).catch(() => {});
      await para.evaluate((el) => { const r = document.createRange(); r.selectNodeContents(el); const s = window.getSelection(); s.removeAllRanges(); s.addRange(r); });
      await page.locator('.bn-toolbar').waitFor({ timeout: 5000 });
      await wait(500);
      check(`${theme} ${which}: no separate Explain pill`, (await page.locator('.s-sel-pill').count()) === 0);
      const btn = page.locator('[data-testid="ask-btn"]');
      check(`${theme} ${which}: Ask button is in the bar`, (await btn.count()) === 1);
      const tb = await page.locator('.bn-toolbar').boundingBox();
      const bb = await btn.boundingBox();
      check(`${theme} ${which}: Ask sits inside the bar`, !!(tb && bb && bb.x >= tb.x - 1 && bb.x + bb.width <= tb.x + tb.width + 1 && bb.y >= tb.y - 1 && bb.y + bb.height <= tb.y + tb.height + 1));
      await btn.click();
      const menu = page.locator('[data-testid="ask-menu"]');
      await menu.waitFor({ timeout: 3000 });
      const names = await menu.locator('button').allInnerTexts();
      check(`${theme} ${which}: menu lists the six actions`, ['Explain', 'Make a task', 'Quiz me', 'Fix grammar', 'Make shorter', 'Make longer'].every((x, i) => (names[i] || '').trim() === x));
      const mb = await menu.boundingBox();
      const vp = page.viewportSize();
      check(`${theme} ${which}: menu is fully on screen`, !!(mb && mb.x >= 0 && mb.y >= 0 && mb.x + mb.width <= vp.width && mb.y + mb.height <= vp.height));
      if (which === 'second') {
        await page.locator('[data-testid="ask-task"]').click();
        await page.locator('.pb-aicard').waitFor({ timeout: 5000 });
        const txt = await page.locator('.pb-aicard').innerText();
        check(`${theme}: Make a task opens the task card with the selected words`, /Second paragraph/.test(txt));
        await page.locator('.pb-aicard button[aria-label="Close"]').click();
      } else await page.keyboard.press('Escape');
    }
  }
} catch (e) { check('no exception: ' + e.message, false); }
await finish();

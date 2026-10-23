// PEB-120: keyboard focus ring must be a visible solid outline in every style, including on the active nav link.
import { boot } from './lib.mjs';
const { base, page, check, finish } = await boot();
const ring = () => page.evaluate(() => {
  const el = document.activeElement;
  if (!el || el === document.body) return null;
  const cs = getComputedStyle(el);
  return { tag: el.tagName, text: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 24), style: cs.outlineStyle, width: parseFloat(cs.outlineWidth), field: /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable };
});
try {
  for (const s of ['studio', 'console', 'soft', 'river', 'orbit']) {
    await page.goto(base + '/tasks');
    await page.evaluate((v) => localStorage.setItem('peblo-style', v), s);
    await page.goto(base + '/tasks');
    await page.waitForTimeout(900);
    const bad = [];
    let seen = 0;
    for (let i = 0; i < 10; i++) {
      await page.keyboard.press('Tab');
      const r = await ring();
      if (!r || r.field) continue;
      seen++;
      if (r.style === 'none' || r.width < 2) bad.push(`${r.tag}:${r.text}`);
    }
    check(`${s}: every Tab stop has a visible outline`, seen >= 3 && bad.length === 0, `seen=${seen} bad=${bad.join(' | ')}`);
  }
  // the active nav link must still show the ring when focused
  await page.goto(base + '/tasks');
  await page.evaluate((v) => localStorage.setItem('peblo-style', v), 'studio');
  await page.goto(base + '/tasks');
  await page.waitForTimeout(900);
  await page.keyboard.press('Tab');
  await page.locator('.pb-nav-link.active').first().focus();
  const r = await ring();
  check('active nav link shows an outline when focused', r && r.style !== 'none' && r.width >= 2, JSON.stringify(r));
} catch (e) { console.error(e); process.exitCode = 1; }
await finish();

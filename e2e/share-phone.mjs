// The share page on a phone: no sideways scroll, bottom bar usable, reader tools and tour fit.
import { boot } from './lib.mjs';

const { base, api, ctx, check, finish } = await boot();
const SHOTS = 'C:/Users/tejas/peblo-e2e';
try {
  const body = '## Intro\n\n' + Array.from({ length: 24 }, (_, i) => `Paragraph ${i + 1} about normal forms and keys.`).join('\n\n');
  const note = (await api('POST', '/api/notes', { title: 'Phone note', content: body, tags: [] })).note;
  const tok = (await api('POST', `/api/share/note/${note.id}`, { edit: false })).token;
  const c = await ctx.browser().newContext({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true });
  const p = await c.newPage();
  await p.goto(`${base}/s/note/${tok}`);
  await p.locator('article .doc').waitFor({ timeout: 15000 });
  await p.waitForTimeout(1800);
  const ov = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  check('no sideways scroll', ov.sw <= ov.cw + 1, JSON.stringify(ov));
  await p.screenshot({ path: `${SHOTS}/phone-1.png` });
  check('the bottom action bar is visible', await p.getByTestId('mbar').isVisible());
  const bar = await p.getByTestId('mbar').boundingBox();
  check('the bar sits at the bottom edge', bar && bar.y + bar.height >= 770, JSON.stringify(bar));
  const tour = p.getByTestId('guest-tour');
  const tb = await tour.boundingBox();
  check('the tour card does not cover the bar', tb && tb.y + tb.height <= bar.y + 2, JSON.stringify({ tb, bar }));
  await p.getByTestId('tour-skip').click();
  const tiny = await p.evaluate(() => [...document.querySelectorAll('.pb-shared button, .mbar button')].filter((b) => { const r = b.getBoundingClientRect(); return r.width > 0 && (r.width < 24 || r.height < 24); }).map((b) => b.getAttribute('aria-label') || b.textContent.trim().slice(0, 20)));
  check('buttons are big enough to tap', tiny.length === 0, tiny.join(', '));
  await p.screenshot({ path: `${SHOTS}/phone-2.png` });
} catch (e) { check('phone test ran without error', false, String(e)); }
await finish();

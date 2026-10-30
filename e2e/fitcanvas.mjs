// Browser windows smaller than the 1440 x 900 design show the whole screen scaled down; windows at least that big are left alone.
import { boot } from './lib.mjs';

const { base, page, ctx, check, finish } = await boot();
const shots = process.env.FIT_SHOTS === '1';
try {
  await page.goto(base + '/notes');
  await page.waitForSelector('#root *', { timeout: 15000 });
  const state = () => page.evaluate(() => {
    const r = document.documentElement;
    const rightmost = document.elementFromPoint(window.innerWidth - 6, Math.round(window.innerHeight / 2));
    const bottom = document.elementFromPoint(Math.round(window.innerWidth / 2), window.innerHeight - 6);
    const isBare = (el) => !el || el === document.documentElement || el === document.body;
    return {
      zoom: r.style.zoom || '',
      vw: r.style.getPropertyValue('--pb-canvas-w'),
      vh: r.style.getPropertyValue('--pb-canvas-h'),
      reachesRight: !isBare(rightmost),
      reachesBottom: !isBare(bottom),
      scrollX: document.documentElement.scrollWidth - window.innerWidth,
    };
  });
  const at = async (w, h) => { await page.setViewportSize({ width: w, height: h }); await page.waitForTimeout(500); return state(); };

  let s = await at(1440, 900);
  check('1440 x 900: no scaling', s.zoom === '' && s.vw === '', JSON.stringify(s));
  s = await at(1920, 1080);
  check('1920 x 1080: no scaling (nothing is enlarged)', s.zoom === '', JSON.stringify(s));
  s = await at(2560, 1440);
  check('2560 x 1440: no scaling', s.zoom === '', JSON.stringify(s));
  s = await at(3840, 2160);
  check('3840 x 2160: no scaling', s.zoom === '', JSON.stringify(s));

  s = await at(1280, 800);
  check('1280 x 800: scaled to 89%', Math.abs(parseFloat(s.zoom) - 1280 / 1440) < 0.01, JSON.stringify(s));
  check('1280 x 800: the screen reaches the right and bottom edges', s.reachesRight && s.reachesBottom, JSON.stringify(s));
  check('1280 x 800: no sideways scroll', s.scrollX <= 1, JSON.stringify(s));
  if (shots) await page.screenshot({ path: 'fit-1280x800.png' });

  s = await at(1366, 640);
  check('1366 x 640 (short window): scaled by the height', Math.abs(parseFloat(s.zoom) - 640 / 900) < 0.01, JSON.stringify(s));
  check('1366 x 640: the screen reaches the right and bottom edges', s.reachesRight && s.reachesBottom, JSON.stringify(s));
  if (shots) await page.screenshot({ path: 'fit-1366x640.png' });

  s = await at(1024, 768);
  check('1024 x 768: scaled', Math.abs(parseFloat(s.zoom) - 1024 / 1440) < 0.01 && s.reachesRight && s.reachesBottom, JSON.stringify(s));
  s = await at(768, 1024);
  check('tablet 768 x 1024: scaled', Math.abs(parseFloat(s.zoom) - 768 / 1440) < 0.01 && s.reachesRight, JSON.stringify(s));
  s = await at(390, 844);
  check('phone 390 x 844: the whole screen is shown, scaled', parseFloat(s.zoom) > 0.2 && parseFloat(s.zoom) < 0.3, JSON.stringify(s));

  s = await at(1440, 900);
  check('back at 1440 x 900: scaling removed', s.zoom === '' && s.vw === '', JSON.stringify(s));

  // pages that are not the signed-in app keep their own responsive layout and are never scaled
  const out = await (await ctx.browser().newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await out.goto(base + '/login');
  await out.waitForTimeout(1200);
  check('login page (signed out) is not scaled', (await out.evaluate(() => document.documentElement.style.zoom)) === '');
} catch (e) {
  check('fitcanvas ran', false, String(e).slice(0, 300));
}
await finish();

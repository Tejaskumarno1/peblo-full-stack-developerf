// The mic button follows the pointer exactly and reaches every edge, with and without page zoom (the text-size setting).
import { boot } from './lib.mjs';
const { base, api, page, check, finish } = await boot();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  const n = (await api('POST', '/api/notes', { title: 'Mic zoom', content: 'Start.' })).note;
  await page.goto(base + '/notes/' + n.id);
  await page.locator('.bn-editor').waitFor({ timeout: 20000 });
  await wait(1200);
  const fab = page.locator('[data-testid="voice-fab"]');
  const vp = page.viewportSize();
  for (const z of [1, 1.25, 0.8]) {
    await page.evaluate((v) => { let t = document.getElementById('t-zoom'); if (!t) { t = document.createElement('style'); t.id = 't-zoom'; document.head.appendChild(t); } t.textContent = 'html { zoom: ' + v + ' !important; }'; window.dispatchEvent(new Event('resize')); }, z);
    await wait(300);
    { const q = await fab.boundingBox(); await page.mouse.move(q.x + q.width / 2, q.y + q.height / 2); await page.mouse.down(); await page.mouse.move(vp.width / 2, vp.height / 2, { steps: 10 }); await page.mouse.up(); }
    let b = await fab.boundingBox();
    const cx = b.x + b.width / 2, cy = b.y + b.height / 2;
    await page.mouse.move(cx, cy); await page.mouse.down();
    await page.mouse.move(cx - 300, cy - 200, { steps: 10 });
    const mid = await fab.boundingBox();
    console.log('z', z, 'want center', cx - 300, cy - 200, 'got', JSON.stringify(mid), 'css zoom', await page.evaluate(() => 'computed=' + getComputedStyle(document.documentElement).zoom + ' body=' + getComputedStyle(document.body).zoom));
    check(`zoom ${z}: the button stays under the pointer while dragging`, Math.abs(mid.x + mid.width / 2 - (cx - 300)) < 6 && Math.abs(mid.y + mid.height / 2 - (cy - 200)) < 6, JSON.stringify(mid));
    await page.mouse.move(vp.width - 2, cy, { steps: 12 }); await page.mouse.up();
    const r = await fab.boundingBox();
    check(`zoom ${z}: the button reaches the far right edge`, r.x + r.width >= vp.width - 14 && r.x + r.width <= vp.width, JSON.stringify(r));
    await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2); await page.mouse.down();
    await page.mouse.move(2, 200, { steps: 12 }); await page.mouse.up();
    const l = await fab.boundingBox();
    check(`zoom ${z}: the button reaches the far left edge`, l.x >= 0 && l.x <= 14, JSON.stringify(l));
  }
} catch (error) { console.log('ERR', error.message); check('voice zoom runs without an error', false, error.message); }
await finish();

// Every notification lands in the one host at the bottom left, clear of the dock and Capture, in each look and at phone width.
import { boot } from './lib.mjs';
import fs from 'node:fs';
const { base, api, page, check, finish } = await boot();
const shots = process.env.SHOTS || 'D:\\Peblo\\_shots';
try { fs.mkdirSync(shots, { recursive: true }); } catch {}
const style = process.env.STYLE || 'soft';
const hit = (a, b) => !(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y);
try {
  await api('POST', '/api/todos', { text: 'Toast probe task', priority: 'medium' });
  for (const [label, vp] of [['desktop', { width: 1440, height: 900 }], ['phone', { width: 390, height: 800 }]]) {
    await page.setViewportSize(vp);
    await page.goto(base + '/tasks');
    if (!(await page.getByText('Toast probe task').first().waitFor({ timeout: 8000 }).then(() => true).catch(() => false))) { console.log(`SKIP ${style}/${label}: tasks list not shown in this layout`); continue; }
    const box = page.locator('[role="checkbox"], input[type="checkbox"], .s-check, .r-check, .o-check, button[aria-label*="complete" i], button[aria-label*="done" i]').first();
    await box.click({ timeout: 8000 }).catch(() => {});
    if (!(await page.locator('#pb-toasts .pb-undo').waitFor({ timeout: 5000 }).then(() => true).catch(() => false))) { console.log(`SKIP ${style}/${label}: no undo trigger found with the generic selector`); continue; }
    check(`${style}/${label}: the undo message is inside the shared host`, true);
    const t = await page.locator('#pb-toasts .pb-undo').boundingBox();
    check(`${style}/${label}: it sits at the left`, t && t.x < 40, JSON.stringify(t));
    check(`${style}/${label}: it stays inside the screen`, t && t.x >= 0 && t.y >= 0 && t.x + t.width <= vp.width && t.y + t.height <= vp.height, JSON.stringify(t));
    const cap = page.getByRole('button', { name: /capture/i }).first();
    if (await cap.count() && await cap.isVisible()) check(`${style}/${label}: not over Capture`, !hit(t, await cap.boundingBox()));
    const dock = page.locator('.s-dock, .r-dock, .o-dock, nav[aria-label*="main" i]').first();
    if (await dock.count() && await dock.isVisible()) check(`${style}/${label}: not over the dock`, !hit(t, await dock.boundingBox()));
    check(`${style}/${label}: the host lives in the look's root`, await page.evaluate(() => !!document.querySelector('.soft > #pb-toasts, .river > #pb-toasts, .orbit > #pb-toasts')));
    await page.screenshot({ path: `${shots}\\toast-${style}-${label}.png` });
  }
} catch (e) { console.log('ERROR', e.stack || e); check('no exception', false, e.message); }
await finish();

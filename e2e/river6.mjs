// PEBLO lane folded into the flow: no lane, promises live in the TASKS "needs you" list.
import { boot, REPO } from './lib.mjs';
import path from 'path';

const { base, page, check, finish } = await boot();
const shot = (n) => page.screenshot({ path: path.join(REPO, '.shots', n + '.png') });
await page.setViewportSize({ width: 1440, height: 900 });
try {
  let state = 'open';
  let patched = null;
  await page.route('**/api/river/promises**', async (route) => {
    const req = route.request();
    if (req.method() === 'PATCH') { patched = req.postDataJSON(); state = patched.status; return route.fulfill({ json: { ok: true, todo: null } }); }
    return route.fulfill({ json: { promises: [{ id: 'g1', noteId: 'n1', noteTitle: 'Client call', items: [{ text: 'Send the deck', owner: 'Sam', due: null, status: state }] }] } });
  });
  await page.goto(base + '/');
  await page.evaluate(() => { localStorage.setItem('peblo-style', 'river'); localStorage.setItem('peblo-river-zoom', 'day'); });
  await page.goto(base + '/');
  await page.locator('.r-river').waitFor({ timeout: 12000 });
  await page.waitForTimeout(1500);

  check('no PEBLO lane label', (await page.locator('.r-river').getByText('PEBLO', { exact: true }).count()) === 0);
  const btn = page.getByRole('button', { name: /Promises . 1/ });
  check('TASKS label counts the promise', await btn.isVisible());
  await btn.click();
  check('popup lists the promise', await page.getByText('Sam: Send the deck').isVisible());
  await shot('river6-popup');
  await page.getByRole('button', { name: 'Dismiss' }).click();
  await page.waitForTimeout(800);
  check('dismiss sends ignored', patched && patched.status === 'ignored', JSON.stringify(patched));
  check('promise leaves the list', (await page.getByText('Sam: Send the deck').count()) === 0);
} catch (e) { check('no crash', false, String(e).slice(0, 300)); await shot('river6-fail').catch(() => {}); }
await finish();


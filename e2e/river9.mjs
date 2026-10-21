// Ctrl+Shift+Space window (River): the card sets the window height, so nothing is cut off.
import { boot, REPO } from './lib.mjs';
import path from 'path';

const { base, api, page, check, finish } = await boot();
const shot = (n) => page.screenshot({ path: path.join(REPO, '.shots', n + '.png') });
try {
  const d = new Date(); d.setHours(15, 30, 0, 0); d.setDate(d.getDate() + 2);
  await api('POST', '/api/todos', { text: 'Design review', deadline: d.toISOString(), startTime: '15:30', endTime: '16:30' });
  await page.goto(base + '/');
  await page.evaluate(() => { localStorage.setItem('peblo-style', 'river'); });
  await page.addInitScript(() => { window.__resizes = []; window.resizeTo = (w, h) => { window.__resizes.push([w, h]); }; });
  await page.setViewportSize({ width: 640, height: 200 });
  await page.goto(base + '/quick-capture');
  await page.locator('#r-capture-input').waitFor({ timeout: 12000 });
  await page.waitForTimeout(600);
  const empty = await page.evaluate(() => document.querySelector('.r-capture').getBoundingClientRect().height);
  check('window: the empty card shows the examples', await page.getByText('ALSO WORKS').isVisible());
  const day = d.toLocaleDateString('en-US', { weekday: 'long' });
  await page.getByRole('tab', { name: 'Meeting' }).click();
  await page.fill('#r-capture-input', `Call Priya ${day} 4pm for 30 min with Priya`);
  await page.waitForTimeout(1200);
  const full = await page.evaluate(() => document.querySelector('.r-capture').getBoundingClientRect().height);
  check('window: chips and the clash make the card taller', full > 200, String(full));
  const calls = await page.evaluate(() => window.__resizes);
  check('window: it asks the window to grow', calls.length > 0 && calls[calls.length - 1][1] > 200, JSON.stringify(calls.slice(-2)));
  await shot('river9-window');
} catch (e) { check('no crash', false, String(e).slice(0, 300)); await shot('river9-fail').catch(() => {}); }
await finish();


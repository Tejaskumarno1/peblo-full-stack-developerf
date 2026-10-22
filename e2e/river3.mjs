// River quick add: clash check with free slots.
import { boot, REPO } from './lib.mjs';
import path from 'path';

const { base, api, page, check, finish } = await boot();
const shot = (n) => page.screenshot({ path: path.join(REPO, '.shots', n + '.png') });
await page.setViewportSize({ width: 1440, height: 900 });
try {
  const tomorrow = new Date(); tomorrow.setHours(0, 0, 0, 0); tomorrow.setDate(tomorrow.getDate() + 1);
  await api('POST', '/api/todos', { text: 'Design review', deadline: tomorrow.toISOString(), startTime: '15:00', endTime: '16:00' });
  await page.goto(base + '/');
  await page.evaluate(() => localStorage.setItem('peblo-style', 'river'));
  await page.goto(base + '/');
  await page.locator('.r-river').waitFor({ timeout: 12000 });
  await page.getByRole('button', { name: /Capture a task/ }).click();
  await page.getByRole('tab', { name: 'Meeting' }).click();
  await page.locator('#r-capture-input').fill('Call Priya tomorrow 3-4pm');
  const clash = page.locator('.r-clash');
  check('clash: the warning names the existing meeting', await clash.waitFor({ timeout: 6000 }).then(() => true).catch(() => false) && /Design review/.test(await clash.innerText()));
  check('clash: the mini river shows both', (await page.locator('.r-mini span').count()) === 2);
  await shot('river3-clash');
  const use = page.locator('.r-clash .slots button').first();
  check('clash: free slots are offered', await use.isVisible());
  await use.click();
  await page.waitForTimeout(500);
  check('clash: choosing a slot clears the warning', (await page.locator('.r-clash').count()) === 0);
  await page.locator('#r-capture-input').press('Enter');
  await page.waitForTimeout(1500);
  const list = (await api('GET', '/api/todos')).todos || [];
  const made = list.find((t) => t.text === 'Call Priya');
  check('clash: the meeting is saved at the free time', !!made && made.startTime !== '15:00', JSON.stringify(made && made.startTime));
} catch (e) { check('no crash', false, String(e).slice(0, 300)); await shot('river3-fail').catch(() => {}); }
await finish();

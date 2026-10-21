// River planner: free gaps, clashes, overdue, free time in the header.
import { boot, REPO } from './lib.mjs';
import path from 'path';

const { base, api, page, check, finish } = await boot();
const shot = (n) => page.screenshot({ path: path.join(REPO, '.shots', n + '.png') });
await page.setViewportSize({ width: 1440, height: 900 });
try {
  const day = (n) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + n); return d.toISOString(); };
  await api('POST', '/api/todos', { text: 'Design review', deadline: day(1), startTime: '10:00', endTime: '11:00' });
  await api('POST', '/api/todos', { text: 'Client call', deadline: day(1), startTime: '10:30', endTime: '11:30' });
  await api('POST', '/api/todos', { text: 'Book room for offsite', deadline: day(-1), priority: 'medium' });
  await page.goto(base + '/');
  await page.evaluate(() => { localStorage.setItem('peblo-style', 'river'); localStorage.setItem('peblo-river-zoom', 'day'); });
  await page.goto(base + '/');
  await page.locator('.r-river').waitFor({ timeout: 12000 });
  await page.waitForTimeout(1800);

  check('gaps: free stretches are drawn in the Meetings lane', (await page.locator('.r-gap').count()) > 0);
  check('clash: both overlapping meetings are marked', (await page.locator('.r-meet.clash').count()) === 2, String(await page.locator('.r-meet.clash').count()));
  const tag = await page.locator('.r-clash-tag').allInnerTexts();
  check('clash: the overlap is named', tag.length === 1 && /30 min/.test(tag[0]), JSON.stringify(tag));
  if (new Date().getHours() < 21) {
    const sub = await page.locator('.r-when span').first().innerText();
    check('header: free time left today', /free/.test(sub), sub);
  }
  await shot('river2-day');

  const od = page.getByRole('button', { name: /Overdue · 1/ });
  check('overdue: a button shows the count', await od.isVisible());
  await od.click();
  check('overdue: the list names the task', await page.getByText('Book room for offsite').first().isVisible());
  await page.locator('.r-pop').getByRole('button', { name: 'Tomorrow' }).first().click();
  await page.waitForTimeout(1500);
  check('overdue: moving it clears the count', (await page.getByRole('button', { name: /Overdue/ }).count()) === 0);

  await page.locator('.r-gap').first().click();
  const q = page.locator('.r-quick');
  check('gap: clicking opens a new meeting at that time', await q.waitFor({ timeout: 4000 }).then(() => true).catch(() => false) && /New meeting/.test(await q.innerText()));
  await shot('river2-quick');
} catch (e) { check('no crash', false, String(e).slice(0, 300)); await shot('river2-fail').catch(() => {}); }
await finish();

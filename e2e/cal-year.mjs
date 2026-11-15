import { boot } from './lib.mjs';
const { base, api, page, check, finish } = await boot();
try {
  await page.setViewportSize({ width: 1440, height: 900 });
  const y = new Date().getFullYear();
  for (const [m, d, n] of [[2, 10, 1], [2, 11, 3], [5, 4, 5], [8, 20, 2]]) for (let i = 0; i < n; i++) await api('POST', '/api/todos', { text: `Item ${m}-${d}-${i}`, priority: 'medium', deadline: new Date(y, m, d, 9 + i).toISOString() });
  await page.goto(base + '/calendar');
  await page.locator('[role=tab]', { hasText: 'Year' }).click();
  await page.locator('.s-year').waitFor({ timeout: 8000 });
  check('twelve months are shown', (await page.locator('.s-year-m').count()) === 12);
  check('title is the year', (await page.locator('.s-h1').innerText()) === String(y));
  await page.locator('.s-year-days button.lv3').first().waitFor({ timeout: 8000 });
  check('a day with five items is the busiest colour', (await page.locator('.s-year-days button.lv3').count()) === 1);
  check('days with 1 and 2-3 items use lighter colours', (await page.locator('.s-year-days button.lv1').count()) === 1 && (await page.locator('.s-year-days button.lv2').count()) === 2);
  await page.screenshot({ path: 'D:/Peblo/_shots/cal-year.png' });
  await page.locator('.s-year-days button.lv3').first().click();
  await page.locator('.s-h1', { hasText: /Sat|Sun|Mon|Tue|Wed|Thu|Fri/ }).waitFor({ timeout: 5000 }).catch(() => {});
  check('clicking a day opens that day', (await page.locator('[role=tab][aria-selected=true]').innerText()) === 'Day');
  await page.locator('[role=tab]', { hasText: 'Year' }).click();
  await page.locator('button[aria-label="Next"]').click();
  check('Next moves to next year', (await page.locator('.s-h1').innerText()) === String(y + 1));
} catch (e) { check('no crash', false, String(e).slice(0, 300)); }
await finish();

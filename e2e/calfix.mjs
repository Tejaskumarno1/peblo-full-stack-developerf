// Calendar page layout is intact, and notes groups collapse one by one.
import { boot } from './lib.mjs';

const { base, api, page, check, finish } = await boot();
try {
  await api('POST', '/api/notes', { title: 'Alpha', content: 'a', tags: ['os'] });
  await api('POST', '/api/notes', { title: 'Beta', content: 'b', tags: ['dbms'] });
  await api('POST', '/api/todos', { text: 'Calendar task', priority: 'medium', deadline: new Date().toISOString() });
  await page.setViewportSize({ width: 1500, height: 950 });
  await page.goto(base + '/calendar');
  await page.locator('.s-week-day').first().waitFor({ timeout: 15000 });
  const boxes = await page.locator('.s-week-day').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().width)));
  check('week view has 7 day columns, each wide', boxes.length === 7 && boxes.every((w) => w > 60), boxes.join(','));
  const side = await page.locator('.s-cal-side').evaluate((e) => Math.round(e.getBoundingClientRect().width));
  check('calendar side panel is 300px wide', side > 250 && side < 340, String(side));
  await page.screenshot({ path: 'C:/Users/tejas/peblo-e2e/calendar.png' });

  await page.goto(base + '/notes');
  await page.locator('.s-note-row').first().waitFor({ timeout: 15000 });
  await page.getByRole('button', { name: /^Group/ }).click();
  await page.getByRole('menuitemradio', { name: 'Tag' }).click();
  await page.waitForTimeout(300);
  const heads = page.locator('.s-grp-toggle');
  check('each tag group has a collapse header', (await heads.count()) >= 2);
  const before = await page.locator('.s-note-row').count();
  await heads.first().click();
  await page.waitForTimeout(200);
  const after = await page.locator('.s-note-row').count();
  check('collapsing one tag hides only its notes', after < before && after > 0, `${before} -> ${after}`);
  await heads.first().click();
  check('expanding brings them back', (await page.locator('.s-note-row').count()) === before);
  await page.getByRole('button', { name: /^Group/ }).click();
  await page.getByRole('menuitemradio', { name: 'Date' }).click();
  await page.waitForTimeout(300);
  const dh = page.locator('.s-grp-toggle');
  check('date groups have collapse headers', (await dh.count()) >= 1);
  const b2 = await page.locator('.s-note-row').count();
  await dh.first().click();
  check('collapsing a date group hides its notes', (await page.locator('.s-note-row').count()) < b2);
} catch (e) {
  check('calfix ran', false, String(e));
} finally {
  await finish();
}

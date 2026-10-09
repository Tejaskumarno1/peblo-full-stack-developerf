// PEB-76: a repeating task is one series; deleting asks which tasks, and cancelling changes nothing.
import { boot } from './lib.mjs';
const { base, api, page, check, finish } = await boot();
try {
  const when = new Date(); when.setUTCHours(12, 0, 0, 0); when.setUTCDate(when.getUTCDate() + 1);
  const made = await api('POST', '/api/todos', { text: 'Series e2e', deadline: when.toISOString(), recurrence: 'daily' });
  check('creating a daily task returns a series id', !!(made.todo || made).seriesId, made);
  const count = async () => ((await api('GET', '/api/todos')).todos || []).filter((t) => t.text === 'Series e2e').length;
  const n0 = await count();
  check('about 60 days are ready, not 30', n0 >= 59, n0);

  await page.goto(base + '/tasks');
  await page.locator('.tasks-row', { hasText: 'Series e2e' }).first().waitFor({ timeout: 15000 });
  const del = () => page.getByLabel(/^Delete "Series e2e"/).first().click({ force: true });

  await del();
  const dlg = page.getByRole('dialog', { name: /Delete a repeating task/ });
  await dlg.waitFor({ timeout: 5000 });
  check('delete asks which tasks (this / following / all)', (await dlg.getByRole('button').allInnerTexts()).join('|').includes('Just this one') && (await dlg.innerText()).includes('This and following') && (await dlg.innerText()).includes('All in the series'));
  await dlg.getByRole('button', { name: 'Cancel' }).click();
  await page.waitForTimeout(500);
  check('Cancel leaves every task alone', (await count()) === n0, await count());

  await del();
  await dlg.waitFor({ timeout: 5000 });
  await dlg.getByRole('button', { name: 'Just this one' }).click();
  await page.waitForTimeout(1200);
  check('"Just this one" removes exactly one', (await count()) === n0 - 1, await count());

  await del();
  await dlg.waitFor({ timeout: 5000 });
  await dlg.getByRole('button', { name: 'All in the series' }).click();
  await page.waitForTimeout(1500);
  check('"All in the series" removes the whole series', (await count()) === 0, await count());

  // Calendar offers "Every weekday"
  await page.goto(base + '/calendar');
  await page.waitForTimeout(1200);
  await page.locator('body').click({ position: { x: 5, y: 5 } }).catch(() => {});
  await page.keyboard.press('n');
  await page.waitForTimeout(500);
  const opts = await page.locator('select.cal-recurrence-select option').allInnerTexts().catch(() => []);
  check('Calendar repeat list has "Every weekday"', opts.includes('Every weekday') || (await page.locator('option', { hasText: 'Every weekday' }).count()) > 0, opts);
} catch (e) { console.error(e); process.exitCode = 1; }
await finish();

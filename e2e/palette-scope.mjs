import { boot } from './lib.mjs';
const { base, api, page, check, finish } = await boot();
try {
  await page.setViewportSize({ width: 1440, height: 900 });
  await api('POST', '/api/notes', { title: 'Sprint notes', content: 'x' });
  await api('POST', '/api/todos', { text: 'Plan sprint review', priority: 'high', deadline: new Date(Date.now() + 864e5).toISOString() });
  await page.goto(base);
  await page.waitForTimeout(1500);
  await page.locator('.soft-search').click();
  await page.locator('.cmd-input').fill('sprint');
  await page.locator('.cmd-item', { hasText: 'Plan sprint review' }).waitFor({ timeout: 8000 });
  await page.locator('.cmd-item', { hasText: 'Sprint notes' }).waitFor({ timeout: 8000 });
  check('All shows notes and tasks', true);
  await page.waitForTimeout(700);
  await page.screenshot({ path: 'D:/Peblo/_shots/palette-all.png' });
  await page.keyboard.press('Tab');
  check('Tab moves to Notes', (await page.locator('.cmd-tabs .on').innerText()) === 'Notes');
  check('Notes scope hides tasks', (await page.locator('.cmd-item', { hasText: 'Plan sprint review' }).count()) === 0 && (await page.locator('.cmd-item', { hasText: 'Sprint notes' }).count()) === 1);
  await page.keyboard.press('Tab');
  check('Tasks scope shows only the task', (await page.locator('.cmd-tabs .on').innerText()) === 'Tasks' && (await page.locator('.cmd-item', { hasText: 'Plan sprint review' }).count()) === 1 && (await page.locator('.cmd-item', { hasText: 'Sprint notes' }).count()) === 0);
  await page.keyboard.press('Shift+Tab');
  check('Shift+Tab goes back', (await page.locator('.cmd-tabs .on').innerText()) === 'Notes');
  await page.locator('.cmd-tabs button', { hasText: 'All' }).click();
  check('clicking All restores everything', (await page.locator('.cmd-item').count()) >= 2);
  await page.keyboard.press('Escape');
  await page.locator('.soft-search').click();
  check('palette reopens on All', (await page.locator('.cmd-tabs .on').innerText()) === 'All');
} catch (e) { check('no crash', false, String(e).slice(0, 300)); }
await finish();



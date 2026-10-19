// Round 7: Orbit look preferences (text size, font, width, accent, contrast, motion) kept in the account.
import { boot } from './lib.mjs';
const { base, api, page, check, finish } = await boot();
try {
  await page.goto(base + '/tasks');
  await page.evaluate(() => { localStorage.setItem('peblo-style', 'orbit'); localStorage.setItem('peblo-orbit-help-seen', '1'); });
  await page.goto(base + '/');
  await page.waitForTimeout(1200);
  const root = () => page.locator('.orbit').first();
  await page.evaluate(() => window.dispatchEvent(new Event('peblo:open-settings')));
  await page.getByRole('button', { name: /Preferences/ }).click();
  const pick = async (label, value) => { await page.getByLabel(label).selectOption(value); await page.waitForTimeout(500); };

  await pick('Orbit Accent colour', 'green');
  check('accent colour changes the map colour', (await root().evaluate((el) => el.style.getPropertyValue('--o-path'))) === '#14804A');
  await pick('Orbit Text size', 'large');
  check('text size scales Orbit', (await root().evaluate((el) => el.style.zoom)) === '1.12');
  await pick('Orbit Font', 'serif');
  check('font choice is applied', await root().evaluate((el) => el.classList.contains('o-font-serif')));
  await pick('Orbit Sheet width', 'wide');
  check('wide sheets are applied', await root().evaluate((el) => el.classList.contains('o-wide')));
  await page.getByLabel('High contrast').click();
  await page.waitForTimeout(500);
  check('high contrast is applied', await root().evaluate((el) => el.classList.contains('o-contrast')));
  await pick('Orbit Animations', 'off');
  check('reduce motion is applied', await root().evaluate((el) => el.classList.contains('o-reduce')));

  await pick('Orbit Daily goal (tasks to finish)', '2');
  await page.keyboard.press('Escape');
  const at = new Date(); at.setHours(23, 59, 0, 0);
  const a = (await api('POST', '/api/todos', { text: 'Goal task', deadline: at.toISOString() })).todo;
  await api('PATCH', '/api/todos/' + a.id, { completed: true });
  await page.goto(base + '/tasks');
  await page.waitForTimeout(1500);
  check('the daily goal shows progress', (await page.getByText('1 of 2 tasks finished today').count()) === 1);
  await page.goto(base + '/');
  await page.reload();
  await page.waitForTimeout(1500);
  check('the choices survive a reload', await root().evaluate((el) => el.classList.contains('o-font-serif') && el.classList.contains('o-reduce') && el.style.getPropertyValue('--o-path') === '#14804A'));
} catch (e) {
  check('script ran to the end', false, String(e).slice(0, 300));
}
await finish();

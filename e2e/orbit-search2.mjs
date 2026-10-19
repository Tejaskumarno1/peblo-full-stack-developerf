// Round 15: Orbit map search (recent searches, scopes, "/" hint) and the date format setting.
import { boot } from './lib.mjs';
const { base, api, page, check, finish } = await boot();
const go = async (path) => {
  await page.goto(base + '/tasks');
  await page.evaluate(() => { localStorage.setItem('peblo-style', 'orbit'); localStorage.setItem('peblo-orbit-help-seen', '1'); });
  await page.goto(base + path);
  await page.waitForTimeout(1800);
};
try {
  for (const t of ['alpha', 'bravo']) await api('POST', '/api/notes', { title: `${t} note`, content: `about ${t}`, tags: [t] });
  await go('/');
  const box = page.getByLabel('Jump to a topic');
  await box.click();
  check('focusing the search explains the / shortcut', (await page.getByLabel('Search help').innerText()).includes('anywhere on the map'));
  check('three scopes are offered', (await page.getByRole('group', { name: 'Search in' }).getByRole('button').count()) === 3);
  await box.fill('alp');
  check('a match is listed', (await page.getByRole('listbox', { name: 'Matching topics' }).count()) === 1);
  await page.getByRole('group', { name: 'Search in' }).getByRole('button', { name: 'Notes' }).click();
  await page.waitForTimeout(300);
  const kinds = await page.locator('.o-jump-list .k').allInnerTexts();
  check('the Notes scope only lists notes', kinds.length > 0 ? kinds.every((k) => k === 'N') : true, kinds.join(','));
  await page.getByRole('group', { name: 'Search in' }).getByRole('button', { name: 'All' }).click();
  await box.press('Enter');
  await page.waitForTimeout(500);
  await box.fill('');
  await box.click();
  await page.waitForTimeout(300);
  check('the finished search is listed under recent searches', (await page.getByLabel('Recent searches').innerText()).toLowerCase().includes('alp'));
  await page.getByLabel('Recent searches').getByRole('button').first().click();
  check('clicking a recent search fills the box', (await box.inputValue()).toLowerCase() === 'alp');

  // date format
  await page.evaluate(() => window.dispatchEvent(new Event('peblo:open-settings')));
  await page.getByRole('button', { name: /Preferences/ }).click();
  const sel = page.getByLabel('Orbit Date format');
  check('Settings has a Date format choice', (await sel.count()) === 1);
  await sel.selectOption('iso');
  await page.waitForTimeout(900);
  await go('/');
  await page.evaluate(() => window.dispatchEvent(new Event('peblo:open-settings')));
  await page.getByRole('button', { name: /Preferences/ }).click();
  check('the date format choice is kept after a reload', (await page.getByLabel('Orbit Date format').inputValue()) === 'iso');
} catch (e) { check('test ran to the end', false, String(e).slice(0, 400)); } finally { await finish(); }

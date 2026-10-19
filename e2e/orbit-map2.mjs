// PEB-149/151/152/153/154/157/158: Orbit map: templates, shortcut tooltips, jump box, filter, fit/reset, hover card, remembered view.
import { boot } from './lib.mjs';
const { base, api, page, check, finish } = await boot();
const go = async () => {
  await page.goto(base + '/tasks');
  await page.evaluate(() => { localStorage.setItem('peblo-style', 'orbit'); localStorage.setItem('peblo-orbit-help-seen', '1'); });
  await page.goto(base + '/');
  await page.waitForTimeout(1100);
};
const scale = () => page.locator('.o-world').evaluate((e) => { const m = e.style.transform.match(/scale\(([\d.]+)\)/); return m ? +m[1] : null; });
try {
  await go();

  // PEB-149 empty map starter
  check('empty map offers "Add your first subject"', await page.getByRole('button', { name: 'Add your first subject' }).isVisible());
  await page.getByRole('button', { name: 'Add your first subject' }).click();
  check('..which opens the new-topic box', await page.getByRole('textbox', { name: /^New topic/ }).isVisible());
  await page.keyboard.press('Escape');
  const tplGroup = page.getByRole('group', { name: 'Starter templates' });
  check('three templates are offered', (await tplGroup.getByRole('button').count()) === 3);
  await tplGroup.getByRole('button', { name: 'Exams' }).click();
  await page.locator('.o-node .ball:not(.center)').first().waitFor({ timeout: 15000 });
  check('a template creates its topics in one click', (await page.locator('.o-node .ball:not(.center)').count()) === 3);
  check('..and the empty state goes away', (await page.getByText('Your map is empty').count()) === 0);

  // PEB-151 tooltips with shortcut keys
  const titles = await page.locator('.o-tools .o-tool, .o-zoom .o-tool').evaluateAll((els) => els.map((e) => e.title));
  check('every toolbar and zoom button has a tooltip', titles.length >= 8 && titles.every((t) => t), titles.join(' | '));
  check('..each tooltip names its shortcut key', titles.every((t) => /\(.\)$/.test(t)), titles.join(' | '));

  // PEB-154 / 158 zoom, fit, reset, remembered view
  await page.keyboard.press('+');
  await page.keyboard.press('+');
  const z = await scale();
  check('+ zooms in', z > 1, String(z));
  await page.keyboard.press('f');
  const fz = await scale();
  check('F fits the map to the screen', fz >= 0.55 && fz <= 1.8, String(fz));
  await page.keyboard.press('+');
  const before = await scale();
  await page.waitForTimeout(200);
  await page.reload(); await page.waitForTimeout(1300);
  const after = await scale();
  check('the view is remembered after reopening', Math.abs(after - before) < 0.001, `${before} vs ${after}`);
  await page.getByRole('button', { name: 'Back to the middle' }).click();
  check('Reset view returns to 100%', (await scale()) === 1);
  await page.waitForTimeout(200);
  check('..and clears the saved view', (await page.evaluate(() => localStorage.getItem('peblo-orbit-view-all'))) === null);
  await page.reload(); await page.waitForTimeout(1300);
  check('..so it stays reset on the next visit', (await scale()) === 1);
  await page.getByRole('button', { name: 'Fit to screen' }).click();
  check('the Fit button works too', (await scale()) !== null);
  await page.keyboard.press('0');
  check('0 resets the view', (await scale()) === 1);

  // PEB-157 hover card
  const first = page.locator('.o-node .ball:not(.center)').first();
  await first.hover();
  const card = page.locator('.o-hover:visible').first();
  await card.waitFor({ timeout: 3000 });
  const ct = await card.innerText();
  check('hovering a topic shows its notes, tasks and mastery', /1 note/.test(ct) && /task/.test(ct) && /Not quizzed yet/.test(ct), ct);
  await page.mouse.move(5, 5);

  // PEB-152 jump box
  await page.keyboard.press('/');
  check('/ focuses the jump box', await page.getByLabel('Jump to a topic').evaluate((e) => e === document.activeElement));
  await page.getByLabel('Jump to a topic').fill('plan');
  check('typing finds nothing in other templates', (await page.getByRole('listbox', { name: 'Matching topics' }).getByRole('option').count()) === 0);
  await page.getByLabel('Jump to a topic').fill('revi');
  check('typing lists the matching topic', (await page.getByRole('listbox', { name: 'Matching topics' }).getByRole('option').count()) === 1);
  await page.getByLabel('Jump to a topic').press('Enter');
  await page.waitForTimeout(300);
  check('Enter highlights the topic', (await page.locator('.ball.hit').count()) === 1);
  const box = await page.locator('.ball.hit').boundingBox();
  const map = await page.locator('.o-map').boundingBox();
  check('..and centres it', Math.abs(box.x + box.width / 2 - (map.x + map.width / 2)) < 60 && Math.abs(box.y + box.height / 2 - (map.y + map.height / 2)) < 60);

  // PEB-153 filter
  const tag = (await api('GET', '/api/notes')).notes?.[0]?.tags?.[0] || 'revision';
  const mkTodo = await api('POST', '/api/todos', { text: 'Finish revision', deadline: new Date(Date.now() + 86400000).toISOString(), tags: [tag] });
  await page.reload(); await page.waitForTimeout(1300);
  const dim = () => page.locator('.o-node.dim').count();
  check('no topic is dimmed by default', (await dim()) === 0);
  await page.getByLabel('Filter the map').selectOption('due');
  check('"Due soon" dims the topics with nothing due', (await dim()) === 2, `dim=${await dim()} todo=${JSON.stringify(mkTodo).slice(0, 80)}`);
  check('..and shows a chip to clear it', await page.getByRole('button', { name: 'Clear filter' }).isVisible());
  await page.getByRole('button', { name: 'Clear filter' }).click();
  check('clearing brings every topic back', (await dim()) === 0);
  await page.getByLabel('Filter the map').selectOption('weak');
  check('"Weak topics" dims topics that are not weak', (await dim()) === 3);
} catch (e) {
  console.log('FAIL: test crashed', e.message);
  process.exitCode = 1;
}
await finish();

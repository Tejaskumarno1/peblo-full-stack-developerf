// PEB-122/123/124: Orbit Due keeps ticked tasks (struck through), offers Undo, and the notes list folds and pages.
import { boot } from './lib.mjs';
const { base, api, page, check, finish } = await boot();
const go = async (path) => {
  await page.goto(base + '/tasks');
  await page.evaluate(() => { localStorage.setItem('peblo-style', 'orbit'); localStorage.removeItem('peblo-orbit-hide-done'); });
  await page.goto(base + path);
  await page.waitForTimeout(900);
};
const exists = async (text) => (await api('GET', '/api/todos')).todos?.some((t) => t.text === text);
try {
  const yest = new Date(Date.now() - 86400000).toISOString();
  await api('POST', '/api/todos', { text: 'Orbit overdue one', deadline: yest });
  await api('POST', '/api/todos', { text: 'Orbit undated one' });
  await api('POST', '/api/todos', { text: 'Orbit delete me' });
  await go('/tasks');
  const row = (t) => page.locator('.o-task', { hasText: t }).first();
  await row('Orbit overdue one').waitFor({ timeout: 15000 });

  // PEB-122: a ticked overdue task stays, is struck through, and can be un-ticked
  await row('Orbit overdue one').getByRole('checkbox').check();
  await page.waitForTimeout(600);
  check('ticked overdue task stays visible', await row('Orbit overdue one').isVisible());
  check('ticked task has the done style', await row('Orbit overdue one').evaluate((e) => e.classList.contains('done')));
  const deco = await row('Orbit overdue one').locator('.t').evaluate((e) => getComputedStyle(e).textDecorationLine);
  check('ticked task text is struck through', deco.includes('line-through'), deco);
  await page.reload(); await page.waitForTimeout(900);
  check('ticked task is still there after a reload', await row('Orbit overdue one').isVisible());
  await row('Orbit overdue one').getByRole('checkbox').uncheck();
  await page.waitForTimeout(500);
  check('un-ticking removes the done style', !(await row('Orbit overdue one').evaluate((e) => e.classList.contains('done'))));

  // Hide completed
  await row('Orbit undated one').getByRole('checkbox').click();
  await page.waitForTimeout(600);
  check('undated ticked task stays too', await row('Orbit undated one').isVisible());
  check('..and is marked done', await row('Orbit undated one').evaluate((e) => e.classList.contains('done')));
  await page.getByLabel('Hide completed').check();
  await page.waitForTimeout(300);
  check('Hide completed hides ticked tasks', (await page.locator('.o-task', { hasText: 'Orbit undated one' }).count()) === 0);
  await page.reload(); await page.waitForTimeout(900);
  check('Hide completed is remembered', await page.getByLabel('Hide completed').isChecked());
  await page.getByLabel('Hide completed').uncheck();

  // PEB-123: Undo after a tick
  await row('Orbit undated one').getByRole('checkbox').click();
  await page.waitForTimeout(500);
  await row('Orbit undated one').getByRole('checkbox').click();
  await page.waitForTimeout(300);
  await page.locator('.o-toast').getByRole('button', { name: 'Undo' }).click();
  await page.waitForTimeout(500);
  check('Undo reverses a tick', !(await row('Orbit undated one').evaluate((e) => e.classList.contains('done'))));

  // Undo a delete: task comes back and is never deleted
  await row('Orbit delete me').getByLabel(/^Delete/).click();
  check('deleted task leaves the list at once', (await page.locator('.o-task', { hasText: 'Orbit delete me' }).count()) === 0);
  await page.locator('.o-toast').getByRole('button', { name: 'Undo' }).click();
  await page.waitForTimeout(500);
  check('Undo brings a deleted task back', await row('Orbit delete me').isVisible());
  await page.waitForTimeout(6800);
  check('an undone delete is not deleted on the server', await exists('Orbit delete me'));

  // Without Undo it really goes after the window
  await row('Orbit delete me').getByLabel(/^Delete/).click();
  await page.waitForTimeout(7000);
  check('delete goes through after the undo time', !(await exists('Orbit delete me')));

  // PEB-124: big groups are folded, then paged
  for (let i = 1; i <= 14; i++) await api('POST', '/api/notes', { title: `Big topic note ${i}`, content: 'body ' + i, tags: ['bigtopic'] });
  await api('POST', '/api/notes', { title: 'Small topic note', content: 'x', tags: ['smalltopic'] });
  await go('/notes');
  const head = page.locator('button.o-group-head', { hasText: 'bigtopic' }).first();
  await head.waitFor({ timeout: 15000 });
  check('a group of 14 starts folded', (await head.getAttribute('aria-expanded')) === 'false');
  await head.click();
  check('opening shows only the first page', (await page.locator('.o-note-tile', { hasText: 'Big topic note' }).count()) === 8);
  await page.getByRole('button', { name: /Show .* more/ }).first().click();
  check('Show more adds the rest', (await page.locator('.o-note-tile', { hasText: 'Big topic note' }).count()) === 14);
  await page.getByRole('button', { name: 'Collapse all' }).click();
  check('Collapse all folds every group', (await page.locator('.o-note-tile').count()) === 0);
  await page.getByRole('button', { name: 'Expand all' }).click();
  check('Expand all opens them again', (await page.locator('.o-note-tile').count()) > 0);
  await page.getByPlaceholder('Search notes…').fill('Big topic note 1');
  await page.waitForTimeout(300);
  check('searching opens the matching groups', (await page.locator('.o-note-tile').count()) > 0);
} catch (err) {
  console.log('FAIL (exception)', err.message);
  check('script ran to the end', false, err.message);
} finally {
  await finish();
}

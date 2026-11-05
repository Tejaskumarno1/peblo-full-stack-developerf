// Task lists as cards: cards, new list, drag to move, right-click menu, group-by mini cards, delete-list choices.
import { boot } from './lib.mjs';
import fs from 'node:fs';

const { base, api, page, check, finish } = await boot();
const shots = 'D:/Peblo/_shots';
fs.mkdirSync(shots, { recursive: true });
const at = (dayOffset, h) => { const d = new Date(); d.setDate(d.getDate() + dayOffset); d.setHours(h, 0, 0, 0); return d.toISOString(); };
const all = async () => (await api('GET', '/api/todos')).todos;
const find = async (text) => (await all()).find((t) => t.text === text);
const lcard = (name) => page.locator(`[data-testid="list-card"][data-list="${name}"]`);
try {
  await page.setViewportSize({ width: 1440, height: 900 });
  await api('POST', '/api/todos', { text: 'Revise BCNF', deadline: at(0, 22), meta: { list: 'Exams' } });
  await api('POST', '/api/todos', { text: 'Past paper', deadline: at(2, 10), meta: { list: 'Exams' } });
  await api('POST', '/api/todos', { text: 'Pay rent', deadline: at(0, 9), meta: { list: 'Home' } });
  await api('POST', '/api/todos', { text: 'Renew card', deadline: at(-1, 9), meta: { list: 'Home' } });
  await api('POST', '/api/todos', { text: 'Loose task', deadline: at(1, 9) });
  await page.goto(base + '/tasks');
  await page.locator('#task-add').waitFor({ timeout: 15000 });

  await page.getByRole('button', { name: 'Lists', exact: true }).click();
  await lcard('Exams').waitFor();
  check('list cards show for lists tasks already use', (await lcard('Home').count()) === 1);
  check('a card says how many are open', /2 open/.test(await lcard('Exams').innerText()));
  check('a card says what is overdue', /[12] overdue/.test(await lcard('Home').innerText()));
  check('Inbox card counts tasks with no list', /1 not sorted/.test(await page.getByTestId('list-card-inbox').innerText()));
  await page.screenshot({ path: `${shots}/lists-cards.png` });

  // open a list
  await lcard('Exams').click();
  check('Opening a card shows only its tasks', (await page.locator('[data-testid="task-card"]').count()) === 2 && (await page.getByText('Pay rent').count()) === 0);
  check('breadcrumb says Lists / Exams', /Exams/.test(await page.getByTestId('list-crumbs').innerText()));
  await lcard('Exams').click();
  check('Clicking it again shows all tasks', (await page.getByText('Pay rent').count()) >= 1);

  // new list
  await page.getByRole('button', { name: 'New list' }).click();
  await page.getByLabel('List name').fill('Travel');
  await page.getByRole('button', { name: 'Create list' }).click();
  await lcard('Travel').waitFor();
  check('New list makes a card', (await lcard('Travel').count()) === 1);

  // drag a task onto a card
  await page.getByRole('button', { name: 'Show all' }).click();
  await page.locator('[data-testid="task-card"]', { hasText: 'Loose task' }).first().dragTo(lcard('Travel'));
  await page.waitForTimeout(1200);
  check('Dragging a task onto a card moves it', (await find('Loose task')).meta?.list === 'Travel');

  // rename, colour from the right-click menu
  await lcard('Home').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Rename' }).click();
  await page.getByLabel('List name').fill('House');
  await page.getByRole('button', { name: 'Save' }).click();
  await page.waitForTimeout(1500);
  check('Rename changes it on every task', (await find('Pay rent')).meta?.list === 'House' && (await find('Renew card')).meta?.list === 'House');
  await lcard('House').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Colour' }).click();
  await page.getByRole('button', { name: 'mint' }).click();
  await page.waitForTimeout(500);
  check('Colour changes the card', /205, 235, 219|#cdebdb/i.test(await lcard('House').evaluate((e) => getComputedStyle(e).backgroundColor + e.getAttribute('style'))));
  await lcard('Travel').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Archive' }).click();
  await page.waitForTimeout(500);
  check('Archive hides the card', (await lcard('Travel').count()) === 0);

  // group by cards
  await page.getByRole('tab', { name: 'List', exact: true }).click();
  await page.getByRole('group', { name: 'Group tasks by' }).getByRole('button', { name: 'Date' }).click();
  await page.getByTestId('mini-card').first().waitFor();
  const labels = await page.getByTestId('mini-card').allInnerTexts();
  check('Group by Date shows small cards', labels.some((l) => /Today/.test(l)) && labels.some((l) => /Overdue/.test(l)), labels.join('|'));
  await page.getByTestId('mini-card').filter({ hasText: 'Overdue' }).click();
  check('Picking a mini card shows only its tasks', (await page.locator('[data-testid="task-card"]').count()) === 1);
  await page.screenshot({ path: `${shots}/lists-group.png` });
  await page.getByTestId('mini-card').filter({ hasText: 'Overdue' }).click();
  check('Clicking it again shows all', (await page.locator('[data-testid="task-card"]').count()) > 1);
  await page.getByRole('group', { name: 'Group tasks by' }).getByRole('button', { name: 'List', exact: true }).click();
  check('Group by List makes a card per list', (await page.getByTestId('mini-card').count()) >= 3);

  // delete a list: Inbox
  await page.getByRole('tab', { name: 'Board', exact: true }).click();
  await lcard('House').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  const dlg = page.getByRole('alertdialog');
  check('Delete asks what happens to the tasks', /open and .* finished/.test(await dlg.innerText()) && /Move them to Inbox/.test(await dlg.innerText()) && /Trash with the list/.test(await dlg.innerText()));
  await page.screenshot({ path: `${shots}/lists-delete.png` });
  await dlg.getByRole('button', { name: 'Delete list' }).click();
  await page.waitForTimeout(1500);
  check('Inbox choice keeps the tasks with no list', !(await find('Pay rent')).meta?.list);
  check('the card is gone', (await lcard('House').count()) === 0);
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(1500);
  check('Undo brings the list and its tasks back', (await find('Pay rent')).meta?.list === 'House' && (await lcard('House').count()) === 1);

  // delete with Trash choice: nothing is deleted until the undo time passes
  await lcard('Exams').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await page.getByRole('radio', { name: /Trash with the list/ }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete list' }).click();
  await page.waitForTimeout(800);
  check('Trash choice waits so Undo can cancel it', !!(await find('Revise BCNF')));
  await page.waitForTimeout(9000);
  check('Trash choice then removes the tasks', !(await find('Revise BCNF')) && !(await find('Past paper')));
} catch (e) { check('lists test ran', false, String(e.stack || e)); }
await finish();

// Select mode, bulk bar with Undo/Redo, delete that says what goes, the ? shortcut sheet, keys, command palette Add.
import { boot } from './lib.mjs';
import fs from 'node:fs';

const { base, api, page, check, finish } = await boot();
const shots = 'D:/Peblo/_shots';
fs.mkdirSync(shots, { recursive: true });
const at = (dayOffset, h) => { const d = new Date(); d.setDate(d.getDate() + dayOffset); d.setHours(h, 0, 0, 0); return d.toISOString(); };
const all = async () => (await api('GET', '/api/todos')).todos;
const find = async (text) => (await all()).find((t) => t.text === text);
const card = (text) => page.locator('[data-testid="task-card"]', { hasText: text }).first();
try {
  await page.setViewportSize({ width: 1440, height: 900 });
  await api('POST', '/api/todos', { text: 'Pay rent', priority: 'high', deadline: at(0, 23) });
  await api('POST', '/api/todos', { text: 'Revise BCNF', priority: 'medium', deadline: at(0, 22), tags: ['exams'] });
  await api('POST', '/api/todos', { text: 'Call the vet', priority: 'medium', deadline: at(0, 21) });
  await api('POST', '/api/todos', { text: 'Send invoice', priority: 'medium', deadline: at(1, 10) });
  await api('POST', '/api/todos', { text: 'Gym', priority: 'low', deadline: at(0, 20), recurrence: 'daily' });
  await page.goto(base + '/tasks');
  await page.locator('#task-add').waitFor({ timeout: 15000 });

  // select mode
  await page.getByRole('button', { name: 'Select', exact: true }).click();
  check('Select mode shows a "0 selected" heading', /0 selected/.test(await page.locator('h1.s-h1').innerText()));
  await card('Pay rent').click();
  await card('Revise BCNF').click({ modifiers: ['Shift'] });
  const n = Number((await page.locator('h1.s-h1').innerText()).match(/(\d+) selected/)?.[1]);
  check('Shift-click selects a range', n >= 3, String(n));
  await page.getByTestId('bulk-bar').waitFor();
  await page.screenshot({ path: `${shots}/bulk-select.png` });

  // priority via the bar, undo with Ctrl Z, redo with Ctrl Shift Z
  await page.getByTestId('bulk-bar').getByRole('button', { name: 'Priority' }).click();
  await page.getByRole('menuitem', { name: 'Low' }).click();
  await page.waitForTimeout(900);
  check('Priority moves every selected task to Low', (await find('Pay rent')).priority === 'low' && (await find('Call the vet')).priority === 'low');
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(900);
  check('Ctrl Z puts the priorities back', (await find('Pay rent')).priority === 'high' && (await find('Call the vet')).priority === 'medium');
  await page.keyboard.press('Control+Shift+z');
  await page.waitForTimeout(900);
  check('Ctrl Shift Z does it again', (await find('Pay rent')).priority === 'low');
  check('an Undo and Redo chip is shown', (await page.getByTestId('undo-redo').count()) === 1);

  // tag + move to a list
  await page.getByTestId('bulk-bar').getByRole('button', { name: 'Tag' }).click();
  await page.getByLabel('Tag to add').fill('urgent');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(900);
  check('Tag adds a tag to all selected', ((await find('Pay rent')).todoTags || []).includes('urgent') && ((await find('Call the vet')).todoTags || []).includes('urgent'));
  await page.getByTestId('bulk-bar').getByRole('button', { name: 'Move' }).click();
  await page.getByLabel('New list name').fill('Exams');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(900);
  check('Move puts them in a list', (await find('Pay rent')).meta?.list === 'Exams');

  // delete says what goes (series), cancel first, undo second, really delete third
  await page.keyboard.press('Escape'); // leaves select mode
  check('Esc leaves select mode', /Tasks/.test(await page.locator('h1.s-h1').innerText()));
  await page.getByRole('button', { name: 'Select', exact: true }).click();
  await card('Gym').click();
  await page.getByTestId('bulk-bar').getByRole('button', { name: 'Delete' }).click();
  const dlg = page.getByRole('dialog', { name: 'Delete tasks' });
  await dlg.waitFor();
  const dt = await dlg.innerText();
  check('delete says the task repeats and how many copies go', /repeat/.test(dt) && /\d+ in all/.test(dt), dt);
  await page.screenshot({ path: `${shots}/bulk-delete.png` });
  await dlg.getByRole('button', { name: 'Cancel' }).click();
  const gymCount = (await all()).filter((t) => t.text === 'Gym').length;
  check('Cancel deletes nothing', gymCount > 5, String(gymCount));
  await page.getByTestId('bulk-bar').getByRole('button', { name: 'Delete' }).click();
  await page.getByRole('dialog', { name: 'Delete tasks' }).getByRole('button', { name: 'Delete' }).click();
  await page.waitForTimeout(400);
  check('the task goes from the board at once', (await card('Gym').count()) === 0);
  await page.getByRole('button', { name: 'Undo', exact: true }).first().click();
  await page.waitForTimeout(1200);
  check('one Undo brings the whole series back', (await card('Gym').count()) === 1 && (await all()).filter((t) => t.text === 'Gym').length === gymCount);
  await page.getByRole('button', { name: 'Select', exact: true }).click();
  await card('Gym').click();
  await page.getByTestId('bulk-bar').getByRole('button', { name: 'Delete' }).click();
  await page.getByRole('dialog', { name: 'Delete tasks' }).getByRole('button', { name: 'Delete' }).click();
  await page.waitForTimeout(9500);
  check('left alone, it is really deleted with every copy', (await all()).filter((t) => t.text === 'Gym').length === 0);

  // shortcuts
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('?');
  const keys = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
  await keys.waitFor({ timeout: 3000 });
  const kt = await keys.innerText();
  check('? opens the keyboard sheet with both groups', /Anywhere/i.test(kt) && /On a task/i.test(kt) && /Command palette/.test(kt) && /Priority 1, 2, 3/.test(kt), kt.slice(0, 200));
  check('and the general help dialog did not open as well', (await page.getByRole('dialog').count()) === 1);
  await page.screenshot({ path: `${shots}/bulk-keys.png` });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  check('Esc closes it', (await page.getByRole('dialog').count()) === 0);
  await page.keyboard.press('/');
  check('/ jumps to search', (await page.evaluate(() => document.activeElement?.id)) === 's-task-search');
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('n');
  check('N jumps to the add box', (await page.evaluate(() => document.activeElement?.id)) === 'task-add');
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('j');
  check('J puts the cursor on a task', (await page.locator('.s-card.kb').count()) === 1);
  const cur = await page.locator('.s-card.kb .s-card-open').first().innerText();
  await page.keyboard.press('2');
  await page.waitForTimeout(800);
  check('2 sets that task to normal priority', (await find(cur)).priority === 'medium', cur);
  await page.keyboard.press('1');
  await page.waitForTimeout(800);
  check('1 sets it to high', (await find(cur)).priority === 'high');
  await page.keyboard.press('m');
  await page.waitForTimeout(800);
  const due = new Date((await find(cur)).deadline);
  const tmr = new Date(); tmr.setDate(tmr.getDate() + 1);
  check('M makes it due tomorrow', due.toDateString() === tmr.toDateString(), String(due));
  await page.keyboard.press('x');
  await page.waitForTimeout(800);
  check('X completes it', (await find(cur)).completed === true);

  // command palette
  await page.keyboard.press('Control+k');
  await page.getByPlaceholder(/Search notes and tasks/).fill('add call mum tomorrow 6pm');
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${shots}/bulk-palette.png` });
  check('palette shows an Add row with the understood date', /Add: call mum/.test(await page.locator('.cmd-item.selected').innerText()), await page.locator('.cmd-item.selected').innerText());
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1200);
  const mum = await find('call mum');
  const mumDue = mum && new Date(mum.deadline);
  check('Enter adds the task for tomorrow 6 pm', !!mum && mumDue.toDateString() === tmr.toDateString() && mumDue.getHours() === 18, String(mum && mum.deadline));
  await page.keyboard.press('Control+k');
  await page.getByPlaceholder(/Search notes and tasks/).fill('revise');
  await page.waitForTimeout(1200);
  check('palette finds tasks by words', (await page.locator('.cmd-item', { hasText: 'Revise BCNF' }).count()) >= 1, (await page.locator('.cmd-item').allInnerTexts()).join(' | '));
  await page.locator('.cmd-item', { hasText: 'Revise BCNF' }).first().click();
  await page.getByRole('dialog').first().waitFor({ timeout: 6000 });
  check('picking a task opens it', (await page.locator('#s-sheet-title').inputValue()) === 'Revise BCNF');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+k');
  await page.getByPlaceholder(/Search notes and tasks/).fill('exams');
  await page.waitForTimeout(700);
  check('palette finds tags', (await page.locator('.cmd-item', { hasText: '#exams' }).count()) >= 1);
} catch (e) {
  console.error(e);
  check('no crash', false, String(e));
}
await finish();

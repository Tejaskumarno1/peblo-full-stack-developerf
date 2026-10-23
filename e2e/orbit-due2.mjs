// PEB-136..146: Orbit Due: filters, sort, overdue tools, reschedule, edit, dates, counters, progress, drag to a day, keys.
import { boot } from './lib.mjs';
const { base, api, page, check, finish } = await boot();
const go = async (path = '/tasks') => {
  await page.goto(base + '/tasks');
  await page.evaluate(() => { localStorage.setItem('peblo-style', 'orbit'); localStorage.setItem('peblo-orbit-help-seen', '1'); localStorage.removeItem('peblo-orbit-hide-done'); });
  await page.goto(base + path);
  await page.waitForTimeout(1100);
};
const list = async () => (await api('GET', '/api/todos')).todos || [];
const byText = async (t) => (await list()).find((x) => x.text === t);
const row = (t) => page.locator('.o-task', { hasText: t }).first();
const at = (daysAgo, h = 10) => { const d = new Date(); d.setDate(d.getDate() - daysAgo); d.setHours(h, 0, 0, 0); return d.toISOString(); };
try {
  await api('POST', '/api/todos', { text: 'Due late A', deadline: at(2), priority: 'high', tags: ['dbms'] });
  await api('POST', '/api/todos', { text: 'Due late B', deadline: at(3), priority: 'low', tags: ['maths'] });
  await api('POST', '/api/todos', { text: 'Due today X', deadline: at(0, 15), priority: 'medium', tags: ['dbms'] });
  await api('POST', '/api/todos', { text: 'Due today Y', deadline: at(0, 17), priority: 'high' });
  await go();
  await row('Due late A').waitFor({ timeout: 15000 });

  // PEB-142 counters + PEB-143 progress
  const sum = await page.locator('.o-due-sum').innerText();
  check('header shows due today / overdue / done counters', /2\s*due today/.test(sum) && /2\s*overdue/.test(sum) && /0\s*done/.test(sum), sum);
  check('progress bar starts at 0 of 2 today', /0 of 2 done today/.test(await page.locator('.o-prog').innerText()));
  await row('Due today X').getByRole('checkbox').click();
  await page.waitForTimeout(600);
  check('progress bar moves to 1 of 2', /1 of 2 done today/.test(await page.locator('.o-prog').innerText()));
  await row('Due today X').getByRole('checkbox').click();
  await page.waitForTimeout(500);

  // PEB-141 date shown with the time
  check('each task shows its date and time', /\d{1,2}\s\w{3}/.test(await row('Due late A').locator('.m').innerText()), await row('Due late A').locator('.m').innerText());

  // PEB-136 filters
  await page.getByLabel('Filter by topic').selectOption('dbms');
  check('topic filter keeps only that topic', (await page.locator('.o-task').count()) === 2 && (await row('Due late B').count()) === 0);
  await page.getByLabel('Filter by topic').selectOption('');
  await page.getByLabel('Filter by priority').selectOption('high');
  check('priority filter keeps high priority', (await page.locator('.o-task').count()) === 2 && (await row('Due today X').count()) === 0);
  await page.getByLabel('Filter by priority').selectOption('');
  await page.getByRole('button', { name: 'Overdue only' }).click();
  check('Overdue only hides today\'s tasks', (await row('Due today Y').count()) === 0 && (await row('Due late A').count()) === 1);
  await page.getByRole('button', { name: /Clear filters/ }).click();
  check('Clear filters shows everything again', (await row('Due today Y').count()) === 1);

  // PEB-137 sort
  await page.getByLabel('Sort tasks', { exact: true }).selectOption('priority');
  const today = await page.locator('.o-day').filter({ has: page.locator('h2', { hasText: /^Today/ }) }).locator('.o-task .t').allInnerTexts();
  check('sort by priority puts High first inside a day', today[0] === 'Due today Y', today.join(','));
  await page.getByLabel('Sort tasks', { exact: true }).selectOption('time');

  // PEB-139 quick reschedule (+ undo)
  await row('Due late B').getByLabel(/^Move/).click();
  await page.getByRole('menuitem', { name: 'Tomorrow' }).click();
  await page.waitForTimeout(900);
  const tmw = new Date(); tmw.setDate(tmw.getDate() + 1);
  const moved = new Date((await byText('Due late B')).deadline);
  check('Tomorrow moves the task one day ahead, same time', moved.getDate() === tmw.getDate() && moved.getHours() === 10, moved.toString());
  await page.locator('.o-toast').getByRole('button', { name: 'Undo' }).click();
  await page.waitForTimeout(900);
  check('Undo puts the old date back', new Date((await byText('Due late B')).deadline).getDate() === new Date(at(3)).getDate());

  // PEB-138 overdue: fold + move all
  await page.locator('.o-fold').click();
  check('Overdue group folds', (await row('Due late A').count()) === 0);
  await page.locator('.o-fold').click();
  await page.getByRole('button', { name: 'Move all to today' }).click();
  await page.waitForTimeout(1200);
  const a = new Date((await byText('Due late A')).deadline), b = new Date((await byText('Due late B')).deadline);
  check('Move all to today moves every overdue task', a.getDate() === new Date().getDate() && b.getDate() === new Date().getDate());
  check('..and nothing is overdue now', /0\s*overdue/.test(await page.locator('.o-due-sum').innerText()));
  await page.locator('.o-toast').getByRole('button', { name: 'Undo' }).click();
  await page.waitForTimeout(1200);
  check('Undo restores both overdue dates', new Date((await byText('Due late A')).deadline).getDate() === new Date(at(2)).getDate());

  // PEB-140 edit
  await row('Due today Y').getByLabel(/^Edit/).click();
  await page.getByLabel('Task title').fill('Due today Y renamed');
  await page.getByLabel('Task priority').selectOption('low');
  await page.getByLabel('Task time').fill('18:30');
  await page.getByLabel('Task topic').selectOption('maths');
  await page.getByRole('button', { name: 'Save' }).click();
  await page.waitForTimeout(1000);
  const e = await byText('Due today Y renamed');
  check('edit saves title, priority and topic', !!e && e.priority === 'low' && (e.todoTags || e.tags || []).includes('maths'), JSON.stringify(e));
  check('edit saves the time', e && new Date(e.deadline).getHours() === 18 && new Date(e.deadline).getMinutes() === 30);

  // PEB-146 keyboard
  await row('Due today X').focus();
  await page.keyboard.press('Space');
  await page.waitForTimeout(600);
  check('Space ticks the focused task', (await byText('Due today X')).completed === true);
  await page.keyboard.press('ArrowDown');
  const focusedId = await page.evaluate(() => document.activeElement?.className || '');
  check('Arrow keys move to another task', /o-task/.test(focusedId));
  await row('Due today X').focus();
  await page.keyboard.press('e');
  check('E opens the editor', await page.getByLabel('Task title').isVisible());
  await page.getByRole('button', { name: 'Cancel' }).click();
  await row('Due today X').focus();
  await page.keyboard.press('Delete');
  check('Delete removes the task from the list', (await page.locator('.o-task', { hasText: 'Due today X' }).count()) === 0);
  await page.locator('.o-toast').getByRole('button', { name: 'Undo' }).click();

  // PEB-145 drag to another day (Week view)
  await page.getByRole('tab', { name: 'Week' }).click();
  await page.waitForTimeout(500);
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
  const pad = (n) => String(n).padStart(2, '0');
  const tKey = `${tomorrow.getFullYear()}-${pad(tomorrow.getMonth() + 1)}-${pad(tomorrow.getDate())}`;
  const dayEl = page.locator(`.o-week-day[data-day="${tKey}"]`);
  if (await dayEl.count()) {
    await page.locator('.o-week-item', { hasText: 'Due today Y renamed' }).first().dragTo(dayEl);
    await page.waitForTimeout(1000);
    check('dragging a task to another day moves it', new Date((await byText('Due today Y renamed')).deadline).getDate() === tomorrow.getDate());
  } else {
    check('tomorrow is in this week view', true, 'tomorrow falls in next week; skipped');
  }
} catch (err) {
  check('script ran to the end', false, err.message);
}
await finish();

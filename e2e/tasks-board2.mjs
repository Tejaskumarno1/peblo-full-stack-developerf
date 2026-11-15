// Tasks board v2: quick-add keeps the cursor, shows what Peblo understood, a repeating task shows once,
// smart views with counts, steps progress, drag to set a date, Table and Timeline views.
import { boot } from './lib.mjs';
import fs from 'node:fs';

const { base, api, page, check, finish } = await boot();
const shots = 'D:/Peblo/_shots';
fs.mkdirSync(shots, { recursive: true });
try {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(base + '/tasks');
  await page.locator('#task-add').waitFor({ timeout: 15000 });

  // 1. understood preview + rapid add
  await page.locator('#task-add').fill('Pay rent every 1st 9am !high #home');
  const u = page.getByTestId('understood');
  await u.waitFor({ timeout: 3000 });
  const ut = await u.innerText();
  check('preview says what it understood: repeat, next date, priority, tag', /Pay rent/.test(ut) && /Every 1st/.test(ut) && /Next/.test(ut) && /High/.test(ut) && /#home/.test(ut), ut);
  await page.screenshot({ path: `${shots}/board2-understood.png` });
  await page.locator('#task-add').press('Enter');
  await page.getByTestId('just-added').waitFor({ timeout: 6000 });
  check('Enter adds without opening a sheet', (await page.getByRole('dialog').count()) === 0);
  check('the cursor stays in the add box and it is empty', (await page.evaluate(() => document.activeElement?.id)) === 'task-add' && (await page.locator('#task-add').inputValue()) === '');
  await page.locator('#task-add').type('Call the vet tomorrow');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(700);
  await page.locator('#task-add').type('Someday plan trip #someday');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(700);

  // 2. a repeating task shows once
  const todos = (await api('GET', '/api/todos')).todos;
  const rent = todos.filter((t) => t.text === 'Pay rent');
  check('the server really made many monthly copies', rent.length > 3, String(rent.length));
  await page.waitForTimeout(500);
  const cards = await page.locator('[data-testid="task-card"]', { hasText: 'Pay rent' }).count();
  check('the board shows the series once', cards === 1, String(cards));
  const card = page.locator('[data-testid="task-card"]', { hasText: 'Pay rent' }).first();
  const ct = await card.innerText();
  check('with "Every 1st" and "+N later"', /Every 1st/.test(ct) && /\+\d+ later/.test(ct), ct);

  // 3. steps progress
  const call = todos.find((t) => t.text === 'Call the vet');
  await api('PATCH', `/api/todos/${call.id}`, { meta: { subtasks: [{ id: 'a', text: 'Find number', done: true }, { id: 'b', text: 'Ring', done: false }] } });
  await page.reload();
  await page.locator('#task-add').waitFor();
  const vet = page.locator('[data-testid="task-card"]', { hasText: 'Call the vet' }).first();
  check('steps show progress on the card', /1 of 2 steps/.test(await vet.innerText()), await vet.innerText());

  // 4. smart views with counts
  const pills = await page.locator('.s-filter').innerText();
  check('smart views list Inbox, Today, Upcoming, Waiting, Someday', ['Inbox', 'Today', 'Upcoming', 'Waiting', 'Someday'].every((w) => pills.includes(w)), pills);
  await page.getByRole('tab', { name: /^Someday/ }).click();
  check('Someday shows only the someday task', (await page.locator('[data-testid="task-card"]').count()) === 1 && (await page.locator('[data-testid="task-card"]', { hasText: 'Someday plan trip' }).count()) === 1);
  await page.getByRole('tab', { name: /^All/ }).click();

  // 5. drag to set a date
  const target = page.locator('[data-col="tomorrow"]');
  const src = page.locator('[data-testid="task-card"]', { hasText: 'Pay rent' }).first();
  await src.dragTo(target);
  await page.waitForTimeout(900);
  const after = (await api('GET', '/api/todos')).todos.filter((t) => t.text === 'Pay rent').sort((a, b) => new Date(a.deadline) - new Date(b.deadline))[0];
  const tmr = new Date(); tmr.setDate(tmr.getDate() + 1);
  check('dropping a card on Tomorrow sets its date', !!after && new Date(after.deadline).toDateString() === tmr.toDateString(), String(after && after.deadline));
  await page.screenshot({ path: `${shots}/board2-board.png` });

  // 6. table + timeline
  await page.getByRole('tab', { name: 'Table' }).click();
  await page.getByTestId('task-table').waitFor();
  const tt = await page.getByTestId('task-table').innerText();
  check('Table shows due, repeat, priority, steps and tags columns', /repeat/i.test(tt) && /Every 1st/.test(tt) && /1\/2/.test(tt) && /#home/.test(tt), tt.slice(0, 200));
  await page.screenshot({ path: `${shots}/board2-table.png` });
  await page.getByRole('tab', { name: 'Timeline' }).click();
  await page.getByTestId('task-timeline').waitFor();
  check('Timeline lists the next days with the vet call', /Call the vet/.test(await page.getByTestId('task-timeline').innerText()));
  await page.screenshot({ path: `${shots}/board2-timeline.png` });
  await page.getByRole('tab', { name: 'Board' }).click();
} catch (e) {
  console.error(e);
  check('no crash', false, String(e));
}
await finish();


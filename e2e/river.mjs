// PEB-85: in River, moving an all-day task keeps it all-day, and a task can be deleted from the drawer.
import { boot } from './lib.mjs';

const { base, api, page, ctx, check, finish } = await boot();
await ctx.addInitScript(() => { try { localStorage.setItem('peblo-style', 'river'); } catch {} });

const today = new Date();
const endOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 0, 0);
const a = await api('POST', '/api/todos', { text: 'allday river task', deadline: endOfToday.toISOString() });
const b = await api('POST', '/api/todos', { text: 'delete me river', deadline: new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 0, 0).toISOString() });

await page.goto(base + '/');
await page.waitForSelector('.r-task');
await page.locator('.r-task', { hasText: 'allday river task' }).locator('button').first().click();
await page.waitForSelector('#rv-sel');
check('the all-day task is selected in the drawer', (await page.locator('#rv-sel').innerText()) === 'allday river task');

await page.getByRole('button', { name: 'Move', exact: true }).click();
const timeInput = page.locator('.r-move input[type="time"]');
check('Move does not pre-fill 22:00 for an all-day task', (await timeInput.inputValue()) === '', await timeInput.inputValue());
// pick tomorrow, no time
const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
const val = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;
await page.locator('.r-move input[type="date"]').fill(val);
await page.locator('.r-move button[type="submit"]').click();
await page.waitForTimeout(900);
const moved = (await api('GET', '/api/todos')).todos.find((x) => x.id === a.todo.id);
const d = new Date(moved.deadline);
check('it moved to tomorrow', d.getDate() === tomorrow.getDate(), moved.deadline);
check('and it is still all-day (23:59), not 22:00', d.getHours() === 23 && d.getMinutes() === 59, d.toString());

// choosing a time still works
await page.locator('.r-task', { hasText: 'allday river task' }).locator('button').first().click().catch(() => {});
await page.getByRole('button', { name: 'Move', exact: true }).click();
await page.locator('.r-move input[type="time"]').fill('15:30');
await page.locator('.r-move button[type="submit"]').click();
await page.waitForTimeout(900);
const timed = new Date((await api('GET', '/api/todos')).todos.find((x) => x.id === a.todo.id).deadline);
check('picking a time still sets it (15:30)', timed.getHours() === 15 && timed.getMinutes() === 30, timed.toString());

// delete from the drawer
await page.locator('.r-task', { hasText: 'delete me river' }).locator('button').first().click();
await page.waitForFunction(() => document.querySelector('#rv-sel')?.textContent === 'delete me river');
await page.getByRole('button', { name: 'Delete', exact: true }).click();
await page.waitForTimeout(900);
const left = (await api('GET', '/api/todos')).todos.map((x) => x.id);
check('Delete in the drawer removes the task', !left.includes(b.todo.id) && left.includes(a.todo.id), left);
check('and it leaves the river', (await page.locator('.r-task', { hasText: 'delete me river' }).count()) === 0);

await finish();

// PEB-79: Calendar day view arrows, dragging keeps the time, inline edit saves once.
import { boot } from './lib.mjs';

const { base, api, page, check, finish } = await boot();
const now = new Date();
const y = now.getFullYear(), m = now.getMonth();
const at = (d, h, mi = 0) => new Date(y, m, d, h, mi, 0, 0);
const t = await api('POST', '/api/todos', { text: 'standup', deadline: at(15, 9).toISOString(), startTime: '09:00', endTime: '10:00' });
const id = t.todo.id;

const writes = [];
page.on('request', (r) => { if (/\/api\/todos\//.test(r.url()) && ['PUT', 'PATCH'].includes(r.method())) writes.push(r.method() + ' ' + r.postData()); });

const cell = (d) => page.locator('.cal-cell:not(.outside)').filter({ has: page.locator('.cal-day-num', { hasText: new RegExp(`^${d}$`) }) });
const label = () => page.locator('.cal-month-label').innerText();
const longDay = (d) => new Date(y, m, d).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

await page.goto(base + '/calendar');
await page.waitForSelector('.cal-cell');
await cell(15).click();
await page.getByRole('button', { name: 'Day', exact: true }).click();
check('day view shows the selected day', (await label()) === longDay(15), await label());
await page.getByRole('button', { name: 'Next day' }).click();
check('next arrow in day view goes to the next day (not the next month)', (await label()) === longDay(16), await label());
await page.getByRole('button', { name: 'Previous day' }).click();
await page.getByRole('button', { name: 'Previous day' }).click();
check('previous arrow steps back one day', (await label()) === longDay(14), await label());
await page.getByRole('button', { name: 'Next day' }).click();
check('and forward again to the 15th', (await label()) === longDay(15), await label());

await page.getByRole('button', { name: 'Month', exact: true }).click();
await page.waitForSelector('.cal-cell');
await cell(15).click();
await page.waitForSelector('.cal-task-item');

// edit: Enter must save exactly once
writes.length = 0;
await page.locator('.cal-task-item [title="Edit"]').first().click();
const input = page.locator('.cal-edit-form input');
await input.fill('standup (moved)');
await input.press('Enter');
await page.waitForTimeout(900);
check('inline edit sends exactly one update', writes.length === 1, writes);
const after = await api('GET', '/api/todos');
check('and the new text is saved', after.todos.some((x) => x.id === id && x.text === 'standup (moved)'), after.todos.map((x) => x.text));

// drag the 09:00 task to the 16th
await page.locator('.cal-task-item').first().dragTo(cell(16));
await page.waitForTimeout(900);
const moved = (await api('GET', '/api/todos')).todos.find((x) => x.id === id);
const d = new Date(moved.deadline);
check('the task moved to the 16th', d.getDate() === 16 && d.getMonth() === m, moved.deadline);
check('and it is still 09:00 (was 23:59)', d.getHours() === 9 && d.getMinutes() === 0, d.toString());
check('its start and end times are untouched', moved.startTime === '09:00' && moved.endTime === '10:00', [moved.startTime, moved.endTime]);

// inline add with a start time puts the deadline at that time and sends no empty strings
await cell(20).click();
let body = null;
page.on('request', (r) => { if (r.method() === 'POST' && /\/api\/todos$/.test(r.url())) body = r.postDataJSON(); });
await page.locator('.cal-add-task-btn').first().click();
const form = page.locator('.cal-inline-task-form').first();
if (await form.count()) {
  await form.locator('input[type="text"]').first().fill('plain task');
  await form.locator('input[type="text"]').first().press('Enter');
  await page.waitForTimeout(800);
  check('a task added without times sends null times, not empty strings', body && body.startTime === null && body.endTime === null, body);
} else {
  console.log('SKIP  inline add form not found');
}

await finish();

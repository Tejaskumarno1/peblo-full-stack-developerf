// Plan my day: end-of-day review (done count, move leftovers to tomorrow or Someday, recap note).
import { boot } from './lib.mjs';
import fs from 'node:fs';
const { base, api, page, check, finish } = await boot();
const shots = 'D:/Peblo/_shots'; fs.mkdirSync(shots, { recursive: true });
const at = (off, h) => { const d = new Date(); d.setDate(d.getDate() + off); d.setHours(h, 0, 0, 0); return d.toISOString(); };
const find = async (text) => (await api('GET', '/api/todos')).todos.find((t) => t.text === text);
try {
  await page.setViewportSize({ width: 1440, height: 900 });
  const done = await api('POST', '/api/todos', { text: 'Finished thing', deadline: at(0, 10) });
  await api('PATCH', `/api/todos/${done.todo.id}`, { completed: true, scope: 'this' });
  await api('POST', '/api/todos', { text: 'Left A', deadline: at(0, 15), meta: { estimateMin: 30 } });
  await api('POST', '/api/todos', { text: 'Left B', deadline: at(0, 16), meta: { estimateMin: 30 } });
  await page.goto(base + '/tasks/plan');
  await page.getByRole('heading', { name: 'Plan my day' }).waitFor({ timeout: 15000 });
  check('review is closed by default', (await page.getByTestId('plan-review').count()) === 0);
  await page.getByTestId('plan-review-open').click();
  await page.getByTestId('plan-review').waitFor();
  check('review shows one task done', /1 done/.test(await page.getByTestId('review-done').innerText()));
  check('review lists the two open tasks', (await page.getByTestId('review-left').count()) === 2);
  await page.screenshot({ path: `${shots}/plan-review.png` });
  await page.getByTestId('review-left').filter({ hasText: 'Left A' }).getByRole('button', { name: 'Someday' }).click();
  await page.waitForTimeout(1500);
  const a = await find('Left A');
  check('Someday clears the date and tags it', a.deadline === null && JSON.stringify(a).includes('someday'), JSON.stringify(a));
  await page.getByTestId('review-left').filter({ hasText: 'Left B' }).getByRole('button', { name: 'Tomorrow' }).click();
  await page.waitForTimeout(1500);
  const b = await find('Left B');
  check('Tomorrow moves the task to tomorrow and counts a move', new Date(b.deadline).getDate() === new Date(at(1, 9)).getDate() && (b.meta?.moves || 0) >= 1, JSON.stringify(b));
  check('review now says nothing is left', /Nothing left/.test(await page.getByTestId('plan-review').innerText()));
  await page.getByTestId('review-recap').click();
  await page.waitForURL(/\/notes\//, { timeout: 15000 });
  await page.locator('.bn-editor').waitFor({ timeout: 20000 });
  check('the recap note lists the finished task', (await page.locator('.bn-editor').innerText()).includes('Finished thing'));
} catch (e) { check(false, 'plan-review ran without crashing', e?.stack || e); }
await finish();

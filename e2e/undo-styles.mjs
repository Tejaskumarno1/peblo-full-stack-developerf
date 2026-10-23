// PEB-123 in Studio, Soft and River: an Undo message after ticking a task; Soft's delete can be undone.
import { boot } from './lib.mjs';
const { base, api, page, check, finish } = await boot();
const go = async (style, path) => {
  await page.goto(base + '/tasks');
  await page.evaluate((s) => localStorage.setItem('peblo-style', s), style);
  await page.goto(base + path);
  await page.waitForTimeout(1000);
};
const find = async (text) => ((await api('GET', '/api/todos')).todos || []).find((t) => t.text === text);
const undo = () => page.locator('.pb-undo').getByRole('button', { name: 'Undo' });
try {
  const when = new Date(); when.setHours(Math.min(when.getHours() + 1, 22), 0, 0, 0);
  await api('POST', '/api/todos', { text: 'Undo studio task', deadline: when.toISOString() });
  await api('POST', '/api/todos', { text: 'Undo soft task', deadline: when.toISOString() });
  await api('POST', '/api/todos', { text: 'Undo river task', deadline: when.toISOString() });

  // Studio (Console shares the page)
  for (const style of ['studio', 'console']) {
    await go(style, '/tasks');
    await page.getByLabel(/Mark "Undo studio task" (done|not done)/).first().click();
    await undo().waitFor({ timeout: 5000 });
    check(`${style}: ticking shows an Undo message`, true);
    await undo().click();
    await page.waitForTimeout(700);
    check(`${style}: Undo puts the task back`, !(await find('Undo studio task')).completed);
  }

  // Soft
  await go('soft', '/tasks');
  await page.getByLabel(/Mark "Undo soft task" (done|not done)/).first().click();
  await undo().waitFor({ timeout: 5000 });
  await undo().click();
  await page.waitForTimeout(700);
  check('soft: Undo reverses a tick', !(await find('Undo soft task')).completed);
  await page.getByLabel('Delete "Undo soft task"').first().click();
  check('soft: deleted task leaves the board at once', (await page.getByLabel('Delete "Undo soft task"').count()) === 0);
  await undo().click();
  await page.waitForTimeout(600);
  check('soft: Undo brings the task back', (await page.getByLabel('Delete "Undo soft task"').count()) > 0);
  await page.waitForTimeout(6800);
  check('soft: an undone delete never reaches the server', !!(await find('Undo soft task')));
  await page.getByLabel('Delete "Undo soft task"').first().click();
  await page.waitForTimeout(7000);
  check('soft: delete goes through after the undo time', !(await find('Undo soft task')));

  // River
  await go('river', '/');
  const box = page.getByLabel('Done: Undo river task').first();
  if (await box.count()) {
    await box.click();
    await undo().waitFor({ timeout: 5000 });
    await undo().click();
    await page.waitForTimeout(700);
    check('river: Undo reverses a tick', !(await find('Undo river task')).completed);
  } else {
    check('river: task is on the timeline', false, 'task not found on River home');
  }
} catch (err) {
  check('script ran to the end', false, err.message);
}
await finish();

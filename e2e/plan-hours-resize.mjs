// Plan my day: working-hours pickers, drag the bottom edge of a block to resize it, focus-timer link from a block.
import { boot } from './lib.mjs';
import fs from 'node:fs';

const { base, api, page, check, finish } = await boot();
const shots = 'D:/Peblo/_shots';
fs.mkdirSync(shots, { recursive: true });
const at = (h, m = 0) => { const d = new Date(); d.setHours(h, m, 0, 0); return d.toISOString(); };
const find = async (text) => (await api('GET', '/api/todos')).todos.find((t) => t.text === text);
try {
  await page.setViewportSize({ width: 1440, height: 900 });
  await api('POST', '/api/todos', { text: 'Draft proposal', deadline: at(10), startTime: '10:00', endTime: '11:00', meta: { planned: true, estimateMin: 60 } });
  await page.goto(base + '/tasks/plan');
  await page.getByRole('heading', { name: 'Plan my day' }).waitFor({ timeout: 15000 });
  await page.getByTestId('plan-block').waitFor({ timeout: 10000 });

  // working hours: default window 8 am to 8 pm, narrowing it changes the hour rows and survives a reload
  const rows = () => page.locator('.pl-hr').count();
  check('the day column starts with 12 hour rows', (await rows()) === 12);
  await page.getByTestId('plan-from').selectOption('9');
  await page.getByTestId('plan-to').selectOption('17');
  check('narrowing the hours to 9 to 17 leaves 8 rows', (await rows()) === 8);
  check('the planned block is still shown', (await page.getByTestId('plan-block').count()) === 1);
  await page.reload();
  await page.getByTestId('plan-block').waitFor({ timeout: 10000 });
  check('the chosen hours are remembered after a reload', (await rows()) === 8 && (await page.getByTestId('plan-from').inputValue()) === '9');
  await page.screenshot({ path: `${shots}/plan-hours.png` });

  // resize: drag the grip 56 px down (one hour) and the block grows from 60 to 120 minutes
  const grip = page.getByTestId('plan-resize');
  const box = await grip.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 28, { steps: 4 });
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 56, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(1500);
  const t = await find('Draft proposal');
  check('dragging the edge down by one hour ends the block at 12:00', t.endTime === '12:00', t.endTime);
  check('the estimate follows the new length', t.meta?.estimateMin === 120, JSON.stringify(t.meta));
  check('the start time did not move', t.startTime === '10:00', t.startTime);
  await page.screenshot({ path: `${shots}/plan-resize.png` });

  // a block cannot be dragged over the next one
  await api('POST', '/api/todos', { text: 'Standup', deadline: at(12, 30), startTime: '12:30', endTime: '13:00' });
  await page.reload();
  await page.getByTestId('plan-block').waitFor({ timeout: 10000 });
  const g2 = await page.getByTestId('plan-resize').boundingBox();
  await page.mouse.move(g2.x + g2.width / 2, g2.y + g2.height / 2);
  await page.mouse.down();
  await page.mouse.move(g2.x + g2.width / 2, g2.y + g2.height / 2 + 150, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(1500);
  const t2 = await find('Draft proposal');
  check('a resize stops at the next meeting (12:30)', t2.endTime === '12:30', t2.endTime);

  // focus link opens the focus screen for that task
  await page.getByTestId('plan-focus').click();
  await page.waitForURL(new RegExp(`/tasks/focus/${t2.id}`), { timeout: 10000 });
  check('the focus link opens the focus screen for the task', page.url().includes(`/tasks/focus/${t2.id}`));
} catch (e) { check('plan hours/resize test ran', false, String(e.stack || e)); }
await finish();

// Plan my day extras: capacity warning, breaks between auto-fitted tasks, move unfinished work to tomorrow.
import { boot } from './lib.mjs';
import fs from 'node:fs';

const { base, api, page, check, finish } = await boot();
const shots = 'D:/Peblo/_shots';
fs.mkdirSync(shots, { recursive: true });
const at = (dayOffset, h, m = 0) => { const d = new Date(); d.setDate(d.getDate() + dayOffset); d.setHours(h, m, 0, 0); return d.toISOString(); };
const all = async () => (await api('GET', '/api/todos')).todos;
const find = async (text) => (await all()).find((t) => t.text === text);
const mins = (s) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
try {
  await page.setViewportSize({ width: 1440, height: 900 });
  await api('POST', '/api/todos', { text: 'Write report', deadline: at(0, 23), meta: { estimateMin: 60 } });
  await api('POST', '/api/todos', { text: 'Review code', deadline: at(0, 23), meta: { estimateMin: 60 } });
  await page.goto(base + '/tasks/plan');
  await page.getByRole('heading', { name: 'Plan my day' }).waitFor({ timeout: 15000 });
  check('no capacity warning while the day has room', (await page.getByTestId('plan-over').count()) === 0);
  check('no carry button while nothing is planned', (await page.getByTestId('plan-carry').count()) === 0);

  await page.getByRole('button', { name: 'Auto-fit my gaps' }).click();
  await page.waitForTimeout(3000);
  const a = await find('Write report');
  const b = await find('Review code');
  const [first, second] = mins(a.startTime) <= mins(b.startTime) ? [a, b] : [b, a];
  check('both tasks were fitted', a.meta?.planned && b.meta?.planned);
  check('auto-fit leaves a break of at least 10 minutes between tasks', mins(second.startTime) - mins(first.endTime) >= 10, `${first.endTime} -> ${second.startTime}`);
  await page.screenshot({ path: `${shots}/plan-breaks.png` });

  // capacity warning: more work than the day holds
  for (const n of [1, 2, 3, 4]) await api('POST', '/api/todos', { text: `Big job ${n}`, deadline: at(0, 23), meta: { estimateMin: 240 } });
  await page.reload();
  await page.getByTestId('plan-over').waitFor({ timeout: 10000 });
  check('the capacity warning says by how much the day is over', /Over by \d/.test(await page.getByTestId('plan-over').innerText()));
  await page.screenshot({ path: `${shots}/plan-over.png` });

  // end of day: carry the unfinished planned tasks to tomorrow
  check('the carry button counts the planned tasks', /Move 2 unfinished to tomorrow/.test(await page.getByTestId('plan-carry').innerText()));
  await page.getByTestId('plan-carry').click();
  await page.waitForTimeout(1500);
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
  const a2 = await find('Write report');
  check('a carried task is on tomorrow, no longer planned, with no time block', new Date(a2.deadline).getDate() === tomorrow.getDate() && !a2.meta?.planned && !a2.startTime, JSON.stringify(a2).slice(0, 200));
  check('carrying counts as a move', a2.meta?.moves === 1, JSON.stringify(a2.meta));
  check('the carry button goes away', (await page.getByTestId('plan-carry').count()) === 0);
} catch (e) { check('plan extras test ran', false, String(e.stack || e)); }
await finish();

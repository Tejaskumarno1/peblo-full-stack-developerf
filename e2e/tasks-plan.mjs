// Plan my day: picks, auto-fit around a meeting, drag into a gap, approval inbox, task health, calm mode, briefing note.
import { boot } from './lib.mjs';
import fs from 'node:fs';

const { base, api, page, check, finish } = await boot();
const shots = 'D:/Peblo/_shots';
fs.mkdirSync(shots, { recursive: true });
const at = (dayOffset, h, m = 0) => { const d = new Date(); d.setDate(d.getDate() + dayOffset); d.setHours(h, m, 0, 0); return d.toISOString(); };
const all = async () => (await api('GET', '/api/todos')).todos;
const find = async (text) => (await all()).find((t) => t.text === text);
try {
  await page.setViewportSize({ width: 1440, height: 900 });
  await api('POST', '/api/todos', { text: 'Standup', deadline: at(0, 10), startTime: '10:00', endTime: '11:00' });
  await api('POST', '/api/todos', { text: 'Pay rent', priority: 'high', deadline: at(0, 9), meta: { estimateMin: 30 } });
  await api('POST', '/api/todos', { text: 'Revise BCNF', deadline: at(-1, 22), meta: { estimateMin: 45 } });
  await api('POST', '/api/todos', { text: 'Read chapter 4', deadline: at(0, 23), meta: { estimateMin: 30 } });
  await api('POST', '/api/todos', { text: 'Call the vet', deadline: at(0, 23) });
  await api('POST', '/api/todos', { text: 'Renew library card', deadline: at(-3, 9), meta: { moves: 3 } });
  await api('POST', '/api/todos', { text: 'Book flights for the offsite', deadline: at(1, 9), meta: { proposal: { by: 'Claude', from: 'Pi planning note' } } });

  // proposals never reach the normal lists
  check('a proposed task stays out of the normal list', !(await all()).some((t) => t.text === 'Book flights for the offsite'));

  await page.goto(base + '/tasks');
  await page.locator('#task-add').waitFor({ timeout: 15000 });
  check('Tasks page does not show a proposal', (await page.getByText('Book flights for the offsite').count()) === 0);
  await page.getByRole('link', { name: 'Plan my day' }).click();
  await page.getByRole('heading', { name: 'Plan my day' }).waitFor();
  check('subtitle says free time and what tasks need', /free, your tasks need/.test(await page.locator('.s-sub').innerText()));
  check('Pick for today lists the backlog', (await page.getByTestId('plan-pick').count()) >= 4);
  check('Standup is on the day as a calendar meeting', (await page.getByTestId('plan-meeting').count()) === 1);
  await page.screenshot({ path: `${shots}/plan-before.png` });

  // tap the plus on one task
  await page.getByRole('button', { name: 'Put "Pay rent" in my day' }).click();
  await page.waitForTimeout(1200);
  const rent = await find('Pay rent');
  check('The plus puts a task into the day', rent.meta?.planned === true && !!rent.startTime && !!rent.endTime);
  const clash = (a, b) => a.startTime < b.endTime && b.startTime < a.endTime;
  check('it does not overlap the meeting', !clash(rent, await find('Standup')));

  // drag one into the day
  const pick = page.getByTestId('plan-pick').filter({ hasText: 'Read chapter 4' });
  await pick.dragTo(page.getByTestId('plan-day'), { targetPosition: { x: 200, y: 400 } });
  await page.waitForTimeout(1200);
  const read = await find('Read chapter 4');
  check('Dragging onto the day plans the task', read.meta?.planned === true);

  // auto-fit the rest
  await page.getByRole('button', { name: 'Auto-fit my gaps' }).click();
  await page.waitForTimeout(3000);
  const bcnf = await find('Revise BCNF');
  check('Auto-fit plans the others in gaps', bcnf.meta?.planned === true && !!bcnf.startTime);
  const blocks = (await all()).filter((t) => t.meta?.planned || t.text === 'Standup').filter((t) => t.startTime);
  let overlap = false;
  for (const a of blocks) for (const b of blocks) if (a.id < b.id && clash(a, b)) overlap = true;
  check('nothing overlaps after auto-fit', !overlap);
  check('the day shows the planned blocks', (await page.getByTestId('plan-block').count()) >= 3);
  await page.screenshot({ path: `${shots}/plan-day.png` });

  // take one out of the day
  await page.getByRole('button', { name: 'Take "Revise BCNF" out of my day' }).click();
  await page.waitForTimeout(1200);
  check('The x takes a task out of the day again', !(await find('Revise BCNF')).meta?.planned);

  // approval inbox
  const inbox = page.getByTestId('approval-inbox');
  check('Approval inbox lists the proposal with who proposed it', /Book flights/.test(await inbox.innerText()) && /Claude/.test(await inbox.innerText()));
  await inbox.getByRole('button', { name: 'Approve' }).click();
  await page.waitForTimeout(1200);
  const flights = await find('Book flights for the offsite');
  check('Approve puts the task in the lists', !!flights && !flights.meta?.proposal);
  check('the inbox is empty after approving', /Nothing waiting/.test(await inbox.innerText()));
  await api('POST', '/api/todos', { text: 'Review the draft', meta: { proposal: { by: 'Priya', from: 'guest on your shared list' } } });
  await page.reload();
  await inbox.getByRole('button', { name: 'Reject' }).waitFor();
  await inbox.getByRole('button', { name: 'Reject' }).click();
  await page.waitForTimeout(500);
  check('Reject waits so Undo can bring it back', !!(await api('GET', '/api/todos?proposals=only')).todos.find((t) => t.text === 'Review the draft'));

  // task health
  const health = page.getByTestId('task-health');
  check('Task health asks about a task moved three times', /Renew library card was moved 3 times/.test(await health.innerText()));
  await page.screenshot({ path: `${shots}/plan-inbox.png` });
  await health.getByRole('button', { name: 'Move to Someday' }).click();
  await page.waitForTimeout(1200);
  const card = await find('Renew library card');
  check('Move to Someday tags it and clears the date and the count', !card.deadline && (card.todoTags || []).includes('someday') && !card.meta?.moves);

  // moving a task to a later day counts
  const dp = await find('Call the vet');
  await api('PATCH', '/api/todos/' + dp.id, { deadline: at(2, 9), scope: 'this' });
  check('Pushing a task to a later day counts as a move', (await find('Call the vet')).meta?.moves === 1);

  // calm mode
  await page.getByLabel(/Calm mode/).check();
  await page.waitForTimeout(600);
  check('Calm mode marks the page', (await page.locator('.s-plan.calm').count()) === 1);

  // briefing note
  await page.getByRole('button', { name: "Write today's briefing note" }).click();
  await page.waitForURL(/\/notes\//, { timeout: 10000 });
  check('The briefing note opens as a note', /\/notes\/[\w-]+/.test(page.url()));
} catch (e) { check('plan test ran', false, String(e.stack || e)); }
await finish();

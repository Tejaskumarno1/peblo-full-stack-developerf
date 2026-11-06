import { boot } from './lib.mjs';
// Tasks v3 (docs mockups TasksV3*): compact header, one filter row, board starts high, Plan my day is visible.
const { base, api, page, check, finish } = await boot();
try {
  await page.setViewportSize({ width: 1440, height: 900 });
  const d = (n) => new Date(Date.now() + n * 864e5).toISOString();
  for (const [text, n] of [['Write the spec', 0], ['Review PRs', 0], ['Book flights', 0], ['Call the bank', 1], ['Outline the talk', 1], ['Revise BCNF', 3], ['Send invoice', 4], ['Renew passport', 5]]) await api('POST', '/api/todos', { text, priority: n === 0 ? 'high' : 'medium', deadline: d(n) });
  await page.goto(base + '/tasks');
  await page.locator('.s-board').waitFor({ timeout: 8000 });
  const box = (sel) => page.locator(sel).first().boundingBox();
  const head = await box('.s-page-title'); const add = await box('.s-addbar'); const plan = await box('.plan-link'); const seg = await box('.s-page-head .s-seg'); const board = await box('.s-board'); const tools = await box('.s-tasktools');
  check('add bar sits in the header row beside the title', Math.abs((add.y + add.height / 2) - (head.y + head.height / 2)) < 30 && add.x > head.x + head.width - 5, JSON.stringify({ head, add }));
  check('Plan my day is visible, same row, between the add bar and the view switch', plan.width > 100 && plan.x >= add.x + add.width - 2 && plan.x + plan.width <= seg.x + 2 && Math.abs(plan.y - add.y) < 6, JSON.stringify({ add, plan, seg }));
  check('filter row is a single line', tools.height < 50, 'height ' + tools.height);
  check('the board starts high on the page (was ~540px)', board.y < 240, 'board.y ' + board.y);
  check('the board is tall (more than 520px)', board.height > 520, 'height ' + board.height);
  check('no "No saved views yet" hint', (await page.getByText('No saved views yet').count()) === 0);
  check('All tasks and Save view share the filter row', (await page.getByRole('button', { name: 'All tasks' }).boundingBox()).y < tools.y + tools.height);
  await page.screenshot({ path: 'D:/Peblo/_shots/tasks-compact.png' });
  await page.getByRole('tab', { name: 'List' }).click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'D:/Peblo/_shots/tasks-compact-list.png' });
  await page.getByRole('tab', { name: 'Board' }).click();
  await page.getByRole('link', { name: 'Plan my day' }).click();
  await page.getByRole('heading', { name: 'Plan my day' }).waitFor({ timeout: 8000 });
  check('Plan my day opens the planner', page.url().includes('/tasks/plan'));
} catch (e) { check('no crash', false, String(e).slice(0, 300)); }
await finish();
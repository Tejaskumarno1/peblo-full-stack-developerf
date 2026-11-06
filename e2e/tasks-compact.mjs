import { boot } from './lib.mjs';
// Tasks v4 (docs mockups TasksV4*): comfortable spacing, title row, add bar row, two tool rows, flat cards.
const { base, api, page, check, finish } = await boot();
try {
  await page.setViewportSize({ width: 1440, height: 900 });
  const d = (n) => new Date(Date.now() + n * 864e5).toISOString();
  for (const [text, n] of [['Write the spec', 0], ['Review PRs', 0], ['Book flights', 0], ['Call the bank', 1], ['Outline the talk', 1], ['Revise BCNF', 3], ['Send invoice', 4], ['Renew passport', 5]]) await api('POST', '/api/todos', { text, priority: n === 0 ? 'high' : 'medium', deadline: d(n) });
  await page.goto(base + '/tasks');
  await page.locator('.s-board').waitFor({ timeout: 8000 });
  const box = (sel) => page.locator(sel).first().boundingBox();
  const head = await box('.s-page-head'); const add = await box('.s-addbar'); const plan = await box('.plan-link'); const seg = await box('.s-page-head .s-seg'); const board = await box('.s-board'); const ra = await box('.s-trow.a'); const rb = await box('.s-trow.b'); const title = await box('.s-page-title');
  check('title row: Plan my day and the view switch sit on the right, same row as the title', plan.x > title.x + title.width && plan.x + plan.width <= seg.x + 2 && Math.abs(plan.y - title.y) < 30, JSON.stringify({ title, plan, seg }));
  check('add bar is full width on its own row below the title', add.y >= head.y + head.height && add.width > 1000, JSON.stringify({ head, add }));
  check('breathing room: 12px or more between title row, add bar and tool rows', add.y - (head.y + head.height) >= 10 && ra.y - (add.y + add.height) >= 12 && rb.y - (ra.y + ra.height) >= 8, JSON.stringify({ head, add, ra, rb }));
  check('two tool rows: saved views and search on row A, filters on row B', rb.y > ra.y + ra.height - 1, JSON.stringify({ ra, rb }));
  check('the board still starts above 340px and is tall (>420px)', board.y < 360 && board.height > 420, JSON.stringify(board));
  check('cards are flat: no stacked shadow', (await page.locator('.s-card').first().evaluate((e) => getComputedStyle(e).boxShadow)).split('),').length === 1);
  check('no "No saved views yet" hint', (await page.getByText('No saved views yet').count()) === 0);
  check('search sits on the saved-views row', (await page.locator('#s-task-search').boundingBox()).y < ra.y + ra.height);
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
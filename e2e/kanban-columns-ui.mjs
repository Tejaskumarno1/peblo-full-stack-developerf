// Custom board columns, collapsing, drag and drop, the assign pop-up, and teams staying apart from Personal.
import fs from 'node:fs';
const { boot } = await import('./lib.mjs');
const b = await boot();
const ok = (c, m, x) => b.check(m, !!c, x);
const shots = process.env.SHOTS || 'D:\\Peblo\\_shots';
try { fs.mkdirSync(shots, { recursive: true }); } catch {}
const p = b.page;
const call = (path, method, body, sp) => p.evaluate(async ({ path, method, body, sp }) => {
  const t = localStorage.getItem('peblo-token');
  const r = await fetch(path, { method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t, ...(sp ? { 'x-peblo-space': sp } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return r.json();
}, { path, method, body, sp });
try {
  await p.setViewportSize({ width: 1440, height: 900 });
  const made = await b.api('POST', '/api/workspaces/orgs', { name: 'Studio Co', start: 'team' });
  const team = made.spaceId;
  await p.goto(b.base + '/', { waitUntil: 'networkidle' });
  await p.evaluate((sp) => localStorage.setItem('peblo-space', sp), team);
  const d = new Date(Date.now() + 864e5).toISOString();
  await call('/api/todos', 'POST', { text: 'Screen the candidates', deadline: d }, team);
  await call('/api/todos', 'POST', { text: 'Book the studio', deadline: d }, team);
  await call('/api/todos', 'POST', { text: 'My private errand', deadline: d }, null);

  // columns are saved per team through the settings page
  await p.goto(b.base + '/settings/board', { waitUntil: 'networkidle' });
  await p.getByTestId('board-settings').waitFor({ timeout: 10000 });
  ok((await p.getByTestId('board-col').count()) === 4, 'a team starts with the four standard columns');
  await p.getByLabel('New column name').fill('Interview done');
  await p.getByTestId('board-add').click();
  await p.getByLabel('New column name').fill('Offer sent');
  await p.getByTestId('board-add').click();
  ok((await p.getByTestId('board-col').count()) === 6, 'two columns are added');
  await p.screenshot({ path: shots + '\\board-settings.png' });
  await p.getByTestId('board-save').click();
  await p.getByTestId('board-msg').waitFor({ timeout: 8000 });
  const saved = await call('/api/todos/board', 'GET', null, team);
  ok(saved.columns.map((c) => c.name).join('|') === 'To do|In progress|In review|Interview done|Offer sent|Done', 'the board is saved in order', JSON.stringify(saved.columns.map((c) => c.name)));
  const personal = await call('/api/todos/board', 'GET', null, null);
  ok(personal.columns.length === 4, 'Personal keeps its own four columns', String(personal.columns.length));

  // the board shows them; empty extra columns fold into strips
  await p.goto(b.base + '/tasks', { waitUntil: 'networkidle' });
  await p.getByRole('tab', { name: 'Kanban' }).click();
  await p.getByTestId('kanban').waitFor({ timeout: 8000 });
  ok((await p.locator('[data-col]').count()) === 6, 'the board shows six columns');
  const folded = await p.locator('[data-folded="true"]').count();
  ok(folded >= 4, 'empty columns collapse on their own', String(folded));
  ok((await p.getByTestId('task-card').count()) === 2, 'only the team\'s tasks are on the team board');
  ok(!(await p.getByText('My private errand').count()), 'a Personal task does not show in the team');
  await p.screenshot({ path: shots + '\\kb-columns.png' });

  // drag a card into a folded custom column: it opens and the task is saved there
  await p.locator('[data-kb-card]', { hasText: 'Screen the candidates' }).dragTo(p.locator('[data-col="c_interview_done"]'));
  await p.waitForTimeout(1500);
  const todos = (await call('/api/todos', 'GET', null, team)).todos;
  const s = todos.find((x) => x.text === 'Screen the candidates');
  ok(s?.meta?.status === 'c_interview_done', 'dragging into Interview done saves the status', JSON.stringify(s?.meta));
  ok((await p.locator('[data-col="c_interview_done"][data-folded="true"]').count()) === 0, 'the column opens when a card lands in it');
  ok((await p.getByTestId('kb-count-c_interview_done').innerText()) === '1', 'its count is 1');
  // and on to Done
  await p.locator('[data-kb-card]', { hasText: 'Screen the candidates' }).dragTo(p.locator('[data-col="done"]'), { targetPosition: { x: 100, y: 60 } });
  await p.waitForTimeout(1200);
  const t2 = (await call('/api/todos', 'GET', null, team)).todos.find((x) => x.text === 'Screen the candidates');
  ok(t2.completed === true && !t2.meta?.status, 'dragging to Done completes it');

  // collapse and open by hand
  await p.getByTestId('kb-collapse-todo').click();
  ok((await p.locator('[data-col="todo"][data-folded="true"]').count()) === 1, 'a column can be collapsed by hand');
  await p.getByTestId('kb-expand-todo').click();
  ok((await p.locator('[data-col="todo"][data-folded="true"]').count()) === 0, 'and opened again');

  // assign pop-up with search
  await p.getByTestId('kb-assign').first().click();
  await p.getByTestId('assign-dialog').waitFor({ timeout: 5000 });
  await p.getByLabel('Search people').fill('zzzz');
  ok(/Nobody matches/.test(await p.getByTestId('assign-dialog').innerText()), 'searching for a stranger finds nobody');
  await p.getByLabel('Search people').fill('');
  await p.getByTestId('assign-me').click();
  await p.waitForTimeout(1000);
  ok((await p.getByTestId('assign-person').first().getAttribute('aria-checked')) === 'true', 'Assign to me ticks me');
  await p.screenshot({ path: shots + '\\kb-assign-dialog.png' });
  await p.getByTestId('assign-done').click();
  ok((await p.getByTestId('kb-avatar').count()) >= 1, 'the avatar shows on the card');

  // add a task straight into a column
  await p.getByTestId('kb-addtask-todo').click();
  await p.getByTestId('kb-new-input-todo').fill('Call the venue');
  await p.keyboard.press('Enter');
  await p.getByText('Call the venue').first().waitFor({ timeout: 8000 });
  ok(true, 'Add task creates a card in To do');
  await p.getByTestId('kb-addtask-done').click();
  await p.getByTestId('kb-new-input-done').fill('Already finished');
  await p.keyboard.press('Enter');
  await p.waitForTimeout(1200);
  const dn = (await call('/api/todos', 'GET', null, team)).todos.find((x) => x.text === 'Already finished');
  ok(dn && dn.completed === true, 'Add task in Done creates a finished task');
  const sh = await p.locator('.kb-col').first().evaluate((el) => getComputedStyle(el).backgroundColor); const pg = await p.evaluate(() => getComputedStyle(document.body).backgroundColor);
  ok(sh !== pg, 'columns are tinted differently from the page', sh + ' vs ' + pg);
  await p.screenshot({ path: shots + '\\kb-addtask.png' });

  // many columns scroll sideways
  const cols = [{ key: 'todo', name: 'To do' }, ...Array.from({ length: 8 }, (_, i) => ({ key: 'x' + i, name: 'Stage ' + (i + 1), tone: 'sky' })), { key: 'done', name: 'Done' }];
  await call('/api/todos/board', 'PUT', { columns: cols }, team);
  for (let i = 0; i < 8; i++) await call('/api/todos', 'POST', { text: 'In stage ' + i, deadline: d, column: 'x' + i }, team);
  await p.goto(b.base + '/tasks', { waitUntil: 'networkidle' });
  await p.getByRole('tab', { name: 'Kanban' }).click();
  await p.getByTestId('kanban').waitFor({ timeout: 8000 });
  await p.waitForTimeout(500);
  const wide = await p.locator('.kb-board').evaluate((el) => el.scrollWidth > el.clientWidth + 20);
  ok(wide, 'ten columns scroll sideways instead of squeezing');
  await p.screenshot({ path: shots + '\\kb-many.png' });

  // Personal board is separate
  await p.evaluate(() => localStorage.removeItem('peblo-space'));
  await p.goto(b.base + '/tasks', { waitUntil: 'networkidle' });
  await p.getByRole('tab', { name: 'Kanban' }).click();
  await p.getByTestId('kanban').waitFor({ timeout: 8000 });
  ok((await p.locator('[data-col]').count()) === 4, 'Personal shows its own four columns');
  ok((await p.getByText('My private errand').count()) >= 1 && !(await p.getByText('Book the studio').count()), 'Personal shows Personal tasks only');
} catch (e) {
  b.check('no crash: ' + (e.message || e).toString().split('\n')[0], false);
  try { await p.screenshot({ path: shots + '\\kb-columns-fail.png' }); } catch {}
}
await b.finish();

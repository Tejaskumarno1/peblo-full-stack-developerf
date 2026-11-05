// Share a list: owner dialog, public page per permission, ends, approvals, stop sharing, text version for AI.
import { boot } from './lib.mjs';
import fs from 'node:fs';

const { base, api, page, ctx, check, finish } = await boot();
const shots = 'D:/Peblo/_shots';
fs.mkdirSync(shots, { recursive: true });
const at = (d, h) => { const x = new Date(); x.setDate(x.getDate() + d); x.setHours(h, 0, 0, 0); return x.toISOString(); };
const pub = (token, path = '', init) => fetch(`${base}/api/public/list/${token}${path}`, init);
const sid = 'g' + 'abcdef0123456789abcdef01';
const jpost = (token, path, body, method = 'POST') => pub(token, path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: sid, name: 'Priya', ...body }) });
try {
  await page.setViewportSize({ width: 1440, height: 900 });
  const a = await api('POST', '/api/todos', { text: 'Revise BCNF', deadline: at(0, 22), meta: { list: 'Exams', subtasks: [{ text: 'Read notes', done: true }, { text: 'Do questions', done: false }] } });
  await api('POST', '/api/todos', { text: 'Past paper', deadline: at(2, 10), meta: { list: 'Exams' } });
  const done = await api('POST', '/api/todos', { text: 'Book the hall', meta: { list: 'Exams' } });
  await api('PATCH', `/api/todos/${done.todo.id}`, { completed: true });
  await api('POST', '/api/todos', { text: 'Not in list', meta: { list: 'Home' } });

  // owner dialog
  await page.goto(base + '/tasks');
  await page.locator('#task-add').waitFor({ timeout: 15000 });
  await page.getByRole('button', { name: 'Lists', exact: true }).click();
  const card = page.locator('[data-testid="list-card"][data-list="Exams"]');
  await card.waitFor();
  await card.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Share' }).click();
  const dlg = page.getByRole('dialog', { name: /Share the list Exams/ });
  await dlg.waitFor();
  await dlg.getByText('Nobody can see this list yet').waitFor();
  check('dialog names the list and the open tasks', /2 open tasks/.test(await dlg.innerText()));
  check('nothing is shared until the link is turned on', /Nobody can see this list yet/.test(await dlg.innerText()));
  await dlg.getByRole('button', { name: 'Turn the link on' }).click();
  await dlg.getByText('Link active').waitFor();
  const url = await dlg.getByLabel('List link').inputValue();
  const token = url.split('/s/list/')[1];
  check('link looks like /s/list/<token>', !!token && token.length >= 20);
  for (const n of ['Can view', 'Can tick and comment', 'Can add tasks (you approve)', 'Can edit']) check(`permission pill: ${n}`, (await dlg.getByRole('radio', { name: n }).count()) === 1);
  check('Can view is chosen first', (await dlg.getByRole('radio', { name: 'Can view' }).getAttribute('aria-checked')) === 'true');
  check('Share with AI shows the text link', (await dlg.getByLabel('Text version link').inputValue()) === url + '.md');
  check('Share with AI shows the MCP address', /\/mcp$/.test(await dlg.getByLabel('MCP address').inputValue()));
  await dlg.getByRole('radio', { name: 'In 30 days' }).click();
  await page.waitForTimeout(600);
  check('link end date is saved', (await api('GET', '/api/task-lists/shares')).shares[0].expiresAt != null);
  await page.screenshot({ path: `${shots}/share-dialog.png` });

  // view-only guest
  const g = await (await pub(token)).json();
  check('guest sees the list and 2 of 3 tasks open', g.list === 'Exams' && g.tasks.length === 3 && g.progress.done === 1 && g.progress.total === 3);
  check('guest does not see other lists', !g.tasks.some((t) => t.text === 'Not in list'));
  check('view-only link refuses a tick', (await jpost(token, `/tasks/${a.todo.id}`, { completed: true }, 'PUT')).status === 403);
  check('view-only link refuses adding', (await jpost(token, '/tasks', { text: 'x' })).status === 403);

  const gp = await ctx.newPage();
  await gp.setViewportSize({ width: 1100, height: 900 });
  await gp.goto(`${base}/s/list/${token}`);
  await gp.getByRole('heading', { name: 'Exams' }).waitFor();
  check('public page says Read-only and when it ends', /Read-only · ends/.test(await gp.getByTestId('shared-perm').innerText()));
  check('public page shows progress "1 of 3 done"', /1 of 3 done/.test(await gp.getByTestId('shared-progress').innerText()));
  check('public page has no tick boxes for view-only', (await gp.getByRole('checkbox').count()) === 0);
  await gp.screenshot({ path: `${shots}/share-public-view.png` });

  // tick permission
  await api('POST', '/api/task-lists/share', { list: 'Exams', perm: 'tick' });
  await gp.reload();
  await gp.getByRole('checkbox', { name: /Revise BCNF/ }).click();
  await gp.waitForTimeout(900);
  check('a guest tick lands in the owner list', (await api('GET', '/api/todos')).todos.find((t) => t.text === 'Revise BCNF').completed === true);
  check('guest comment is accepted', (await jpost(token, `/tasks/${a.todo.id}/comments`, { body: 'Chapter 3 next' })).status === 201);
  check('tick-only link refuses adding', (await jpost(token, '/tasks', { text: 'x' })).status === 403);

  // add permission: proposal, hidden until approved
  await api('POST', '/api/task-lists/share', { list: 'Exams', perm: 'add' });
  const r = await (await jpost(token, '/tasks', { text: 'Ask about viva' })).json();
  check('add link answers waiting for approval', r.waiting === true);
  check('proposal stays out of the normal task list', !(await api('GET', '/api/todos')).todos.some((t) => t.text === 'Ask about viva'));
  const props = await api('GET', '/api/todos?proposals=only');
  check('proposal shows in the approval inbox', props.todos.some((t) => t.text === 'Ask about viva' && t.meta?.proposal?.by === 'Priya'));

  // dialog shows guests and comments
  await page.reload();
  await page.locator('#task-add').waitFor({ timeout: 15000 });
  await page.locator('[data-testid="list-card"][data-list="Exams"]').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Share' }).click();
  const d2 = page.getByRole('dialog', { name: /Share the list Exams/ });
  await d2.getByTestId('list-guests').waitFor();
  check('dialog lists the guest by name', /Priya/.test(await d2.getByTestId('list-guests').innerText()));
  check('dialog shows the comment', /Chapter 3 next/.test(await d2.getByTestId('list-comments').innerText()));
  check('Add pill is the chosen one', (await d2.getByRole('radio', { name: 'Can add tasks (you approve)' }).getAttribute('aria-checked')) === 'true');
  await page.screenshot({ path: `${shots}/share-dialog-guests.png` });

  // text version for AI
  const md = await (await fetch(`${base}/s/list/${token}.md`)).text();
  check('.md version lists tasks, steps and progress', /# Exams/.test(md) && /\[x\] Revise BCNF/.test(md) && /Do questions/.test(md) && /2 of 3 done|done\./.test(md));
  check('.md version leaves out the pending proposal', !/viva/.test(md));

  // stop sharing
  await d2.getByRole('button', { name: 'Stop sharing' }).click();
  await d2.getByText('Nobody can see this list yet').waitFor();
  check('after Stop sharing the link is dead', (await pub(token)).status === 404);
  check('and the .md link is dead too', (await fetch(`${base}/s/list/${token}.md`)).status === 404);
  await gp.reload();
  await gp.getByRole('heading', { name: /not shared any more/ }).waitFor({ timeout: 8000 }).catch(() => {});
  check('public page says it is not shared any more', (await gp.getByText('not shared any more').count()) >= 1);
  await gp.screenshot({ path: `${shots}/share-public-gone.png` });
} catch (e) { console.error(e); check('no crash: ' + e.message.split('\n')[0], false); }
await finish();

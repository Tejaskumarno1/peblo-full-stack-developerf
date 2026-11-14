// Batch 2 (mockups K02/K08/K09): the Kanban status board.
import fs from 'node:fs';
const { boot } = await import('./lib.mjs');
const b = await boot();
const ok = (c, m, x) => b.check(m, !!c, x);
const shots = process.env.SHOTS || 'D:\\Peblo\\_shots';
try { fs.mkdirSync(shots, { recursive: true }); } catch {}
const p = b.page;
try {
  await p.setViewportSize({ width: 1440, height: 900 });
  const made = await b.api('POST', '/api/workspaces/orgs', { name: 'Studio Co', start: 'team' });
  const team = made.spaceId;
  await p.goto(b.base + '/', { waitUntil: 'networkidle' });
  await p.evaluate((sp) => localStorage.setItem('peblo-space', sp), team);
  await p.evaluate(async (sp) => {
    const t = localStorage.getItem('peblo-token');
    const post = (body) => fetch('/api/todos', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t, 'x-peblo-space': sp }, body: JSON.stringify(body) });
    const d = new Date().toISOString();
    await post({ text: 'Plan the shoot', deadline: d });
    await post({ text: 'Cut the reel', deadline: d, column: 'doing' });
    await post({ text: 'Check captions', deadline: d, column: 'review' });
    await post({ text: 'Old task', deadline: d, column: 'done' });
    for (let i = 1; i <= 10; i++) await post({ text: 'Extra ' + i, deadline: d });
  }, team);
  await p.goto(b.base + '/tasks', { waitUntil: 'networkidle' });
  await p.getByRole('tab', { name: 'Kanban' }).click();
  await p.getByTestId('kanban').waitFor({ timeout: 8000 });
  const n = async (k) => Number(await p.getByTestId('kb-count-' + k).innerText());
  ok((await n('todo')) === 11 && (await n('doing')) === 1 && (await n('review')) === 1 && (await n('done')) === 1, 'cards sit in the column that matches their status', `${await n('todo')}/${await n('doing')}/${await n('review')}/${await n('done')}`);
  ok(await p.getByText('Show 8 more').isVisible(), 'a long column shows "Show 8 more"');
  await p.screenshot({ path: shots + '\\kb-board.png' });
  await p.getByText('Show 8 more').click();
  await p.locator('[data-kb-card]', { hasText: 'Plan the shoot' }).dragTo(p.locator('[data-col="doing"]'));
  await p.waitForTimeout(1200);
  ok((await n('doing')) === 2 && (await n('todo')) === 10, 'dragging a card to In progress moves it');
  await p.reload({ waitUntil: 'networkidle' });
  await p.getByRole('tab', { name: 'Kanban' }).click();
  await p.getByTestId('kanban').waitFor({ timeout: 8000 });
  ok((await n('doing')) === 2, 'the move is saved');
  await p.locator('[data-kb-card]', { hasText: 'Cut the reel' }).dragTo(p.locator('[data-col="done"]'), { targetPosition: { x: 100, y: 50 } });
  await p.waitForTimeout(1200);
  ok((await n('done')) === 2, 'dragging to Done completes the task', `${await n('todo')}/${await n('doing')}/${await n('review')}/${await n('done')} ` + JSON.stringify(await p.evaluate(async (sp) => { const t = localStorage.getItem('peblo-token'); const r = await fetch('/api/todos', { headers: { Authorization: 'Bearer ' + t, 'x-peblo-space': sp } }).then((x) => x.json()); return (r.todos || []).filter((x) => x.text === 'Cut the reel').map((x) => [x.completed, x.meta]); }, team)));
  await p.getByTestId('kb-who').click();
  await p.getByTestId('kb-me').click();
  ok((await n('doing')) === 0 && (await n('todo')) === 0, 'the Mine filter hides tasks that are not assigned to me');
  await p.getByTestId('kb-who').click();
  await p.getByRole('menuitemradio', { name: 'Everyone' }).click();
  ok((await n('todo')) === 10, 'Everyone brings them back');
  await p.screenshot({ path: shots + '\\kb-filter.png' });
  // assign from the board
  const before = await p.getByTestId('kb-avatar').count();
  await p.getByTestId('kb-assign').first().click();
  await p.getByTestId('assign-person').first().click();
  await p.getByTestId('assign-done').click();
  await p.waitForTimeout(1200);
  ok((await p.getByTestId('kb-avatar').count()) === before + 1, 'assigning from a card shows an avatar on it', `${before} -> ${await p.getByTestId('kb-avatar').count()}`);
  const bar = await p.locator('.s-addbar').boundingBox();
  const colTop = await p.locator('.kb-board').boundingBox();
  ok(colTop.y < 330, 'the board starts high on the page', String(colTop.y));
  await p.keyboard.press('Escape');
  await p.getByTestId('kanban').screenshot({ path: shots + '\\kb-assign.png' });
  await p.screenshot({ path: shots + '\\kb-full.png' });
} catch (e) { b.check('kanban UI ran without error', false, e.stack || e.message); }
await b.finish();

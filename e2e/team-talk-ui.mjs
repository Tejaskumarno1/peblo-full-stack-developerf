// Batches 4 and 5 in the app (mockups K04, K05, K06): task discussion, team activity with "For you", workload tab.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const { boot, REPO } = await import('./lib.mjs');
const b = await boot();
const ok = (c, m, x) => b.check(m, !!c, x);
const shots = process.env.SHOTS || 'D:\\Peblo\\_shots';
try { fs.mkdirSync(shots, { recursive: true }); } catch {}
const p = b.page;
try {
  const made = await b.api('POST', '/api/workspaces/orgs', { name: 'Studio Co', start: 'team' });
  const team = made.spaceId;
  const { default: db } = await import(pathToFileURL(path.join(REPO, process.env.PEBLO_SERVER_DIST || 'dist', 'server', 'db.js')).href);
  const email = `ana-${Date.now()}@peblo.test`;
  const su = await fetch(b.base + '/api/auth/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'correct horse battery', name: 'Ana' }) }).then((x) => x.json());
  await db.user.updateMany({ where: { email }, data: { emailVerifiedAt: new Date() } });
  const inv = await b.api('POST', `/api/workspaces/orgs/${made.id}/invites`, { email, orgRole: 'member', spaceIds: [team], spaceRole: 'member' });
  await fetch(b.base + '/api/workspaces/invites/accept', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${su.token}` }, body: JSON.stringify({ token: new URL(inv.link).searchParams.get('token') }) });
  const ana = (path, method = 'GET', body) => fetch(b.base + path, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${su.token}`, 'x-peblo-space': team }, body: body ? JSON.stringify(body) : undefined }).then((x) => x.json());

  await p.goto(b.base + '/', { waitUntil: 'networkidle' });
  await p.evaluate((sp) => localStorage.setItem('peblo-space', sp), team);
  const todo = await p.evaluate(async (sp) => {
    const t = localStorage.getItem('peblo-token');
    const r = await fetch('/api/todos', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t, 'x-peblo-space': sp }, body: JSON.stringify({ text: 'Edit the reel cuts', deadline: new Date(Date.now() - 2 * 864e5).toISOString() }) });
    return (await r.json()).todo;
  }, team);
  const me = await p.evaluate(async () => (await fetch('/api/auth/me', { headers: { Authorization: 'Bearer ' + localStorage.getItem('peblo-token') } }).then((x) => x.json())).user?.id);
  await ana(`/api/todos/${todo.id}/comments`, 'POST', { body: 'Hey @Dev the intro needs a trim', mentions: [me] });

  // K04: the discussion in the task sheet
  await p.goto(b.base + '/tasks?task=' + todo.id, { waitUntil: 'networkidle' });
  await p.getByTestId('task-thread').waitFor({ timeout: 10000 });
  await p.getByTestId('thread-comment').first().waitFor({ timeout: 8000 });
  ok(/Ana/.test(await p.getByTestId('thread-comment').first().innerText()), 'the sheet shows a teammate\'s comment');
  await p.getByTestId('thread-mention').click();
  await p.getByTestId('thread-person').filter({ hasText: 'Ana' }).click();
  await p.getByLabel('Write a comment').fill((await p.getByLabel('Write a comment').inputValue()) + 'can you check the music?');
  await p.screenshot({ path: shots + '\\tt-thread.png' });
  await p.getByTestId('thread-send').click();
  await p.waitForTimeout(1200);
  ok((await p.getByTestId('thread-comment').count()) === 2, 'my comment is added to the thread');
  ok(/@Ana/.test(await p.getByTestId('thread-comment').nth(1).innerText()), 'the mention is kept in the text');
  const anaNotes = await ana('/api/collab/notifications');
  ok((anaNotes.notifications || []).some((n) => n.kind === 'mention' && n.todoId === todo.id), 'Ana gets a mention notification that points at the task');
  await p.getByTestId('thread-review').click();
  await p.getByTestId('thread-person').filter({ hasText: 'Ana' }).click();
  await p.waitForTimeout(1200);
  ok((await p.getByTestId('thread-activity').count()) >= 1, 'asking for a review shows in the trail');
  await p.screenshot({ path: shots + '\\tt-thread2.png' });
  await p.keyboard.press('Escape');

  // K06: Workload
  await p.goto(b.base + '/tasks', { waitUntil: 'networkidle' });
  await p.getByRole('tab', { name: 'Workload' }).click();
  await p.getByTestId('workload').waitFor({ timeout: 8000 });
  await p.getByTestId('workload-row').first().waitFor({ timeout: 8000 });
  ok((await p.getByTestId('workload-row').count()) === 2, 'workload lists every member');
  ok(await p.getByTestId('overdue-row').first().isVisible(), 'the overdue task is listed');
  ok(/Finished/.test(await p.getByTestId('week-summary').innerText()), 'the weekly summary is shown');
  await p.getByTestId('avail-busy').click();
  await p.getByTestId('avail-chip').first().waitFor({ timeout: 8000 });
  ok(/Busy/.test(await p.getByTestId('avail-chip').first().innerText()), 'setting myself busy shows a Busy chip');
  await p.screenshot({ path: shots + '\\wl-view.png' });
  await p.getByTestId('overdue-row').first().click();
  await p.getByTestId('task-thread').waitFor({ timeout: 8000 });
  ok(await p.getByTestId('task-thread').isVisible(), 'an overdue row opens that task (deep link)');
  await p.keyboard.press('Escape');

  // K05: Team activity and For you
  await p.goto(b.base + '/team-activity', { waitUntil: 'networkidle' });
  await p.getByTestId('feed-item').first().waitFor({ timeout: 8000 });
  ok((await p.getByTestId('feed-item').count()) >= 2, 'the activity feed lists the comment and the review');
  await p.getByTestId('ta-comments').click();
  ok((await p.getByTestId('feed-item').count()) === 2, 'the Comments filter keeps only comments', String(await p.getByTestId('feed-item').count()));
  await p.getByTestId('ta-all').click();
  await p.screenshot({ path: shots + '\\ta-feed.png' });
  await p.getByTestId('feed-item').first().locator('a').click();
  await p.getByTestId('task-thread').waitFor({ timeout: 8000 });
  ok(p.url().includes('/tasks') && await p.getByTestId('task-thread').isVisible(), 'a feed row links to the task');
  await p.goto(b.base + '/team-activity', { waitUntil: 'networkidle' });
  ok((await p.getByTestId('for-you-item').count()) >= 1, 'the For you column lists the mention');
} catch (e) { b.check('team talk UI ran without error', false, e.stack || e.message); }
await b.finish();

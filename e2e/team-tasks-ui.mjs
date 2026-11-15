// Batch 1 UI (mockups K03/K04): task sheet with several assignees, who can see it, status, watch; card chips.
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
  const mk = async (name) => {
    const email = `${name.toLowerCase()}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@peblo.test`;
    const su = await fetch(b.base + '/api/auth/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'correct horse battery', name }) }).then((x) => x.json());
    await db.user.updateMany({ where: { email }, data: { emailVerifiedAt: new Date() } });
    const inv = await b.api('POST', `/api/workspaces/orgs/${made.id}/invites`, { email, orgRole: 'member', spaceIds: [team], spaceRole: 'member' });
    await fetch(b.base + '/api/workspaces/invites/accept', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${su.token}` }, body: JSON.stringify({ token: new URL(inv.link).searchParams.get('token') }) });
    return { id: su.user?.id, token: su.token };
  };
  const ana = await mk('Ana'); const bo = await mk('Bo');
  const todosFor = async (tok) => (await fetch(b.base + '/api/todos', { headers: { Authorization: 'Bearer ' + tok, 'x-peblo-space': team } }).then((x) => x.json())).todos || [];

  await p.goto(b.base + '/', { waitUntil: 'networkidle' });
  await p.evaluate((sp) => localStorage.setItem('peblo-space', sp), team);
  await p.evaluate(async (sp) => {
    const t = localStorage.getItem('peblo-token');
    await fetch('/api/todos', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t, 'x-peblo-space': sp }, body: JSON.stringify({ text: 'Edit the Warangal reel', deadline: new Date().toISOString() }) });
  }, team);
  await p.goto(b.base + '/tasks', { waitUntil: 'networkidle' });
  await p.getByText('Edit the Warangal reel').first().click();
  await p.getByTestId('assignee-add').waitFor({ timeout: 8000 });
  ok(await p.getByTestId('vis-team').getAttribute('aria-checked') === 'true', 'a new team task is visible to the whole team by default');

  // two assignees
  await p.getByTestId('assignee-add').click();
  await p.getByTestId('assign-pill').filter({ hasText: 'Ana' }).click();
  await p.getByTestId('assignee-add').click();
  await p.getByTestId('assign-pill').filter({ hasText: 'Bo' }).click();
  ok((await p.getByTestId('sheet-assignee').count()) === 2, 'two people can be assigned to the same task');

  // picked people + status + watch
  await p.getByTestId('vis-people').click();
  await p.getByTestId('viewer-pill').filter({ hasText: 'Ana' }).click();
  await p.getByTestId('status-doing').click();
  await p.getByTestId('task-watch').click();
  await p.screenshot({ path: shots + '\\tk-sheet.png' });
  await p.getByRole('button', { name: 'Save', exact: true }).click();
  await p.waitForTimeout(1200);

  const mine = (await todosFor(b.token)).find((t) => t.text === 'Edit the Warangal reel');
  ok(mine?.meta?.assignees?.length === 2, 'both assignees were saved', JSON.stringify(mine?.meta));
  ok(mine?.meta?.visibility === 'people' && mine.meta.viewers?.includes(ana.id), 'Picked people was saved with Ana');
  ok(mine?.meta?.status === 'doing', 'status In progress was saved');
  ok(Array.isArray(mine?.meta?.watchers) && mine.meta.watchers.length === 1, 'watching was saved');
  ok((await todosFor(ana.token)).some((t) => t.text === 'Edit the Warangal reel'), 'Ana sees the task');
  ok((await todosFor(bo.token)).some((t) => t.text === 'Edit the Warangal reel'), 'Bo is assigned, so he sees it too');

  // card chips
  ok((await p.getByTestId('assignee-chip').count()) >= 2, 'the card shows both assignees');
  ok(await p.getByTestId('vis-chip').first().isVisible(), 'the card shows that it is for picked people');
  await p.screenshot({ path: shots + '\\tk-card.png' });
} catch (e) {
  b.check('no crash', false, e.stack || String(e));
}
await b.finish();


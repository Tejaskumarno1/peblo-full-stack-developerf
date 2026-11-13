// Team sharing in the app (mockups T01 to T07): share from the note menu, "Shared by members", a teammate's folder, the To-do/Done strip and toast.
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
  const email = `ana-${Date.now()}@peblo.test`;
  const su = await fetch(b.base + '/api/auth/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'correct horse battery', name: 'Ana' }) }).then((x) => x.json());
  const { default: db } = await import(pathToFileURL(path.join(REPO, process.env.PEBLO_SERVER_DIST || 'dist', 'server', 'db.js')).href);
  await db.user.updateMany({ where: { email }, data: { emailVerifiedAt: new Date() } });
  const inv = await b.api('POST', `/api/workspaces/orgs/${made.id}/invites`, { email, orgRole: 'member', spaceIds: [team], spaceRole: 'member' });
  await fetch(b.base + '/api/workspaces/invites/accept', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${su.token}` }, body: JSON.stringify({ token: new URL(inv.link).searchParams.get('token') }) });
  const note = await b.api('POST', '/api/notes', { title: 'Reel script: Warangal fort', content: 'Hook, three beats, outro' });

  // ---- T01/T02: the author shares from the note menu
  await p.goto(`${b.base}/notes/${note.note.id}`, { waitUntil: 'networkidle' });
  await p.getByLabel('More', { exact: true }).first().click();
  ok(await p.getByTestId('menu-team-share').isVisible(), 'the note menu has "Share with team"');
  await p.screenshot({ path: shots + '\\ts-menu.png' });
  await p.getByTestId('menu-team-share').click();
  ok(await p.getByTestId('ts-teams').isVisible(), 'the dialog lists the team');
  ok(/will see it/.test(await p.getByTestId('ts-people').innerText()), 'it says who will see the note');
  await p.getByTestId('ts-tasks-toggle').check();
  await p.getByLabel('Task 1').fill('Record the voice-over');
  await p.getByLabel('Task 1').press('Enter');
  await p.getByLabel('Task 2').fill('Design the thumbnail');
  await p.screenshot({ path: shots + '\\ts-dialog.png' });
  await p.getByTestId('ts-confirm').click();
  await p.getByTestId('ts-confirm').waitFor({ state: 'detached', timeout: 8000 });
  ok(/Shared with/.test(await p.content()), 'a "Shared with" toast confirms it');

  // ---- T03/T04: a teammate looks in "Shared by members"
  const ctx2 = await b.ctx.browser().newContext({ viewport: { width: 1440, height: 900 } });
  await ctx2.addInitScript(([t, s]) => { try { localStorage.setItem('peblo-token', t); localStorage.setItem('peblo-space', s); } catch {} }, [su.token, team]);
  const q = await ctx2.newPage();
  await q.goto(b.base + '/team-shared', { waitUntil: 'networkidle' });
  await q.getByTestId('ts-folders').waitFor({ timeout: 8000 }).catch(async (e) => { console.log('PAGE:', (await q.locator('body').innerText()).slice(0, 400).replace(/\n/g, ' | '), q.url()); await q.screenshot({ path: shots + '\\ts-fail.png' }); throw e; });
  ok(await q.getByTestId('ts-folder').count() === 1, 'one member folder');
  ok(/E2E/.test(await q.getByTestId('ts-folder').innerText()) && /1 note/.test(await q.getByTestId('ts-folder').innerText()) && /1 to-do list/.test(await q.getByTestId('ts-folder').innerText()), 'the card names the sharer with 1 note and 1 to-do list', await q.getByTestId('ts-folder').innerText());
  await q.screenshot({ path: shots + '\\ts-folders.png' });
  await q.getByTestId('ts-folder').click();
  await q.getByTestId('ts-member').waitFor({ timeout: 8000 });
  ok(/To-do 0 of 2/.test(await q.getByTestId('ts-note').innerText()), 'the folder row shows To-do 0 of 2', await q.getByTestId('ts-note').innerText());
  await q.screenshot({ path: shots + '\\ts-member.png' });

  // ---- T05/T06: open the shared note, finish the tasks, get the Done tag and toast
  await q.getByTestId('ts-note').click();
  await q.getByTestId('ts-strip').waitFor({ timeout: 8000 });
  ok(/Shared by E2E/.test(await q.getByTestId('ts-strip').innerText()) && /Can edit/.test(await q.getByTestId('ts-strip').innerText()), 'the note says who shared it and Can edit', await q.getByTestId('ts-strip').innerText());
  ok(/To-do 0 of 2/.test(await q.getByTestId('ts-progress').innerText()), 'the strip shows To-do 0 of 2');
  await q.screenshot({ path: shots + '\\ts-note.png' });
  const asAna = async (method, url, body) => (await fetch(b.base + url, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${su.token}`, 'x-peblo-space': team }, body: body ? JSON.stringify(body) : undefined })).json();
  const todos = (await asAna('GET', `/api/todos?noteId=${(await asAna('GET', '/api/notes')).notes[0].id}`)).todos;
  await asAna('PATCH', `/api/todos/${todos[0].id}`, { completed: true });
  await q.waitForFunction(() => /To-do 1 of 2/.test(document.querySelector('[data-testid="ts-strip"]')?.innerText || ''), null, { timeout: 15000 });
  ok(true, 'the strip moves to To-do 1 of 2 by itself');
  await asAna('PATCH', `/api/todos/${todos[1].id}`, { completed: true });
  await q.getByTestId('ts-done').waitFor({ timeout: 15000 });
  ok(true, 'the strip turns Done when the last task is finished');
  await q.getByTestId('ts-done-toast').waitFor({ timeout: 4000 });
  ok(/All 2 tasks finished/.test(await q.getByTestId('ts-done-toast').innerText()), 'a toast says all 2 tasks finished');
  await q.screenshot({ path: shots + '\\ts-done.png' });
  await q.getByTestId('ts-done-toast').getByRole('button', { name: 'Undo' }).click();
  await q.waitForFunction(() => /To-do 1 of 2/.test(document.querySelector('[data-testid="ts-strip"]')?.innerText || ''), null, { timeout: 15000 });
  ok(true, 'Undo reopens the last task');

  // ---- T07: a team where nobody shared yet
  const empty = await b.api('POST', `/api/workspaces/orgs/${made.id}/spaces`, { name: 'Quiet team', kind: 'team' });
  await ctx2.addInitScript((s) => { try { localStorage.setItem('peblo-space', s); } catch {} }, empty.id || empty.space?.id || team);
  if (empty.id || empty.space?.id) {
    const e = await ctx2.newPage();
    await e.addInitScript((s) => { try { localStorage.setItem('peblo-space', s); } catch {} }, empty.id || empty.space?.id);
    await b.page.evaluate((s) => { try { localStorage.setItem('peblo-space', s); } catch {} }, empty.id || empty.space?.id);
    await b.page.goto(b.base + '/team-shared', { waitUntil: 'networkidle' });
    await b.page.getByTestId('ts-empty').waitFor({ timeout: 8000 });
    ok(/Nobody has shared a note yet/.test(await b.page.getByTestId('ts-empty').innerText()), 'a team with nothing shared shows the empty state');
    await b.page.screenshot({ path: shots + '\\ts-empty.png' });
  }
} catch (e) { b.check('team share UI ran without error', false, e.stack || e.message); }
await b.finish();

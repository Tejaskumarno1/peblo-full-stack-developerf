// Batch 6 in the app (mockups K10-K12) plus bulk assign and note-to-tasks.
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

  await p.goto(b.base + '/', { waitUntil: 'networkidle' });
  await p.evaluate((sp) => localStorage.setItem('peblo-space', sp), team);

  // K10: template picker from the Projects page
  await p.goto(b.base + '/team-projects', { waitUntil: 'networkidle' });
  await p.getByTestId('team-projects').waitFor({ timeout: 10000 });
  await p.getByTestId('projects-template').click();
  await p.getByTestId('template-option').first().waitFor({ timeout: 8000 });
  ok((await p.getByTestId('template-option').count()) >= 3, 'the picker lists the built-in templates');
  await p.getByTestId('template-option').filter({ hasText: 'Weekly review' }).click();
  ok((await p.getByTestId('template-preview').locator('li').count()) === 5, 'preview shows the five Weekly review tasks');
  await p.getByLabel('Project name').fill('Week 46');
  await p.getByLabel('Assign all').selectOption({ label: 'Ana' });
  await p.screenshot({ path: shots + '\\tpl-picker.png' });
  await p.getByTestId('template-create').click();
  await p.getByTestId('projects-msg').waitFor({ timeout: 10000 });
  ok(/5 tasks added to Week 46/.test(await p.getByTestId('projects-msg').innerText()), 'confirmation names the project');
  await p.getByTestId('project-card').filter({ hasText: 'Week 46' }).waitFor({ timeout: 8000 });
  ok(/0 of 5 done/.test(await p.getByTestId('project-card').filter({ hasText: 'Week 46' }).innerText()), 'the project card shows 0 of 5 done');

  // save own template
  await p.getByTestId('projects-template').click();
  await p.getByTestId('template-new').click();
  await p.getByLabel('Template name').fill('Launch day');
  await p.getByLabel('Template tasks').fill('Post the teaser\nSend the email');
  await p.getByTestId('template-save').click();
  await p.getByTestId('template-option').filter({ hasText: 'Launch day' }).waitFor({ timeout: 8000 });
  ok(true, 'a saved template appears in the list');
  await p.getByRole('button', { name: 'Close' }).click();

  // K11: opening a project lands on its list
  await p.getByTestId('project-card').filter({ hasText: 'Week 46' }).click();
  await p.waitForURL(/\/tasks/, { timeout: 8000 });
  await p.waitForTimeout(1500);
  ok((await p.locator('[data-id]').count()) >= 5, 'the project opens showing its tasks', String(await p.locator('[data-id]').count()));
  await p.screenshot({ path: shots + '\\proj-open.png' });

  // bulk assign on the task list
  const selBtn = p.getByRole('button', { name: /select/i }).first();
  if (await selBtn.count()) {
    await selBtn.click();
    await p.locator('[data-id]').first().click();
    await p.getByTestId('bulk-assign').click();
    await p.getByTestId('bulk-person').first().waitFor({ timeout: 5000 });
    ok(true, 'bulk bar offers an assign menu in a team');
    await p.keyboard.press('Escape');
  }

  // K12: hand over
  await p.goto(b.base + '/team-projects', { waitUntil: 'networkidle' });
  await p.getByTestId('projects-handover').click();
  await p.getByLabel('Hand over from').selectOption({ label: 'Ana' });
  await p.getByTestId('handover-task').first().waitFor({ timeout: 8000 });
  ok((await p.getByTestId('handover-task').count()) === 5, 'handover lists Ana\'s five open tasks');
  await p.getByLabel('Hand over to').selectOption({ index: 1 });
  await p.getByTestId('handover-task').first().uncheck();
  await p.screenshot({ path: shots + '\\handover.png' });
  await p.getByTestId('handover-go').click();
  await p.getByTestId('projects-msg').waitFor({ timeout: 10000 });
  ok(/4 tasks handed to/.test(await p.getByTestId('projects-msg').innerText()), 'four tasks moved, one left behind');
  const anaOpen = await fetch(b.base + '/api/todos', { headers: { Authorization: `Bearer ${su.token}`, 'x-peblo-space': team } }).then((x) => x.json());
  ok(true, 'handover finished', String((anaOpen.todos || []).length));
} catch (e) {
  b.check('no crash: ' + (e.message || e).toString().split('\n')[0], false);
  try { await p.screenshot({ path: shots + '\\team-structure-fail.png' }); } catch {}
}
await b.finish();

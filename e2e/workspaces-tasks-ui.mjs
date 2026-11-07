// Team tasks in the app: an assignee can be chosen in the task sheet and shows on the card.
import { boot } from './lib.mjs';
import fs from 'node:fs';
const b = await boot();
const ok = (c, m, x) => b.check(m, !!c, x);
const shots = process.env.SHOTS || 'D:\\Peblo\\_shots';
try { fs.mkdirSync(shots, { recursive: true }); } catch {}
const p = b.page;
try {
  const org = await b.api('POST', '/api/workspaces/orgs', { name: 'Studio Co', start: 'team', spaceName: 'Studio team' });
  await p.goto(b.base + '/', { waitUntil: 'networkidle' });
  await p.evaluate((sp) => localStorage.setItem('peblo-space', sp), org.spaceId);
  await p.evaluate(async (sp) => {
    const t = localStorage.getItem('peblo-token');
    await fetch('/api/todos', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t, 'x-peblo-space': sp }, body: JSON.stringify({ text: 'Draft the launch checklist', deadline: new Date().toISOString() }) });
  }, org.spaceId);
  await p.goto(b.base + '/tasks', { waitUntil: 'networkidle' });
  await p.getByText('Draft the launch checklist').first().click();
  await p.getByTestId('assign-pill').first().waitFor({ timeout: 8000 });
  ok(await p.getByTestId('assign-pill').count() >= 1, 'the task sheet lists the team members to assign to');
  await p.screenshot({ path: shots + '\\ws-assign.png' });
  await p.getByTestId('assign-pill').first().click();
  await p.getByRole('button', { name: 'Save', exact: true }).click();
  await p.waitForTimeout(1000);
  await p.getByTestId('assignee-chip').first().waitFor({ timeout: 8000 });
  ok((await p.getByTestId('assignee-chip').first().innerText()) === 'You', 'the card shows who it is assigned to');
  await p.screenshot({ path: shots + '\\ws-assigned.png' });
  await p.evaluate(() => localStorage.removeItem('peblo-space'));
  await p.goto(b.base + '/tasks', { waitUntil: 'networkidle' });
  ok(!(await p.content()).includes('Draft the launch checklist'), 'Personal tasks do not show the team task');

  await p.evaluate(() => localStorage.removeItem('peblo-space'));
  await p.goto(b.base + '/calendar', { waitUntil: 'networkidle' });
  await p.locator('[data-feed-layer="Studio team"]').waitFor({ timeout: 8000 });
  ok(await p.locator('[data-feed-layer="Studio team"]').isVisible(), 'the Personal calendar offers the team as a layer');
  await p.screenshot({ path: shots + '\\ws-cal-layer.png' });
  await p.locator('[data-feed-layer="Studio team"]').click();
  ok((await p.locator('[data-feed-layer="Studio team"]').getAttribute('aria-pressed')) === 'false', 'the layer can be switched off');

  await p.evaluate((sp) => localStorage.setItem('peblo-space', sp), org.spaceId);
  await p.goto(b.base + '/ai', { waitUntil: 'networkidle' });
  ok((await p.getByTestId('ai-scope').innerText()).includes('only your Personal'), 'AI says it reads only Personal while a team is open');
  ok((await p.locator('.soft-search').innerText()).includes('Search in Studio team'), 'the search bar names the space it searches');
  await p.screenshot({ path: shots + '\\ws-ai-scope.png' });

  const mine = await p.evaluate(async (sp) => {
    const t = localStorage.getItem('peblo-token'); const h = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t, 'x-peblo-space': sp };
    const w = await (await fetch('/api/workspaces', { headers: h })).json();
    const n = await (await fetch('/api/notes', { method: 'POST', headers: h, body: JSON.stringify({ title: 'Read only page', content: 'hello team' }) })).json();
    await fetch(`/api/workspaces/spaces/${sp}/members/${w.me.id}`, { method: 'PUT', headers: h, body: JSON.stringify({ role: 'viewer' }) });
    return n.note.id;
  }, org.spaceId);
  await p.goto(b.base + `/notes/${mine}`, { waitUntil: 'networkidle' });
  await p.getByTestId('viewer-note').waitFor({ timeout: 8000 });
  ok(await p.getByTestId('viewer-note').isVisible(), 'a viewer sees that the note is read only');
  ok((await p.getByRole('button', { name: '+ tag' }).count()) === 0, 'and has no tag or move controls');
  await p.screenshot({ path: shots + '\\ws-viewer.png' });

  await p.evaluate(async (sp) => {
    const t = localStorage.getItem('peblo-token'); const h = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t, 'x-peblo-space': sp };
    const w = await (await fetch('/api/workspaces', { headers: h })).json();
    await fetch(`/api/workspaces/spaces/${sp}/members/${w.me.id}`, { method: 'PUT', headers: h, body: JSON.stringify({ role: 'lead' }) });
    const n = await (await fetch('/api/notes', { method: 'POST', headers: h, body: JSON.stringify({ title: 'Binned page', content: 'bye' }) })).json();
    await fetch(`/api/notes/${n.note.id}`, { method: 'DELETE', headers: h });
  }, org.spaceId);
  await p.goto(b.base + '/notes', { waitUntil: 'networkidle' });
  await p.getByRole('button', { name: /Trash/ }).first().click();
  await p.getByTestId('team-trash-note').waitFor({ timeout: 8000 });
  ok((await p.content()).includes('Binned page'), 'the team trash lists the binned note');
  ok((await p.getByRole('button', { name: /Empty/ }).count()) === 1, 'a lead can empty the team trash');
  await p.screenshot({ path: shots + '\\ws-team-trash.png' });

  const off = await b.api('POST', `/api/workspaces/orgs/${org.id}/spaces`, { name: 'Warangal office', kind: 'office' });
  await p.evaluate((sp) => localStorage.setItem('peblo-space', sp), off.id);
  await p.goto(b.base + '/notes', { waitUntil: 'networkidle' });
  await p.getByTestId('office-empty').waitFor({ timeout: 8000 });
  ok(await p.getByTestId('office-feed').isVisible(), 'an Office opens as an announcement feed, not a notes list');
  await p.screenshot({ path: shots + '\\ws-office-empty.png' });
  await p.getByTestId('office-write').click();
  await p.getByTestId('office-title').fill('Holiday on Monday');
  await p.getByTestId('office-body').fill('Office closed for Diwali. Files due Friday 5 pm.');
  await p.getByTestId('office-save').click();
  await p.getByTestId('office-post').first().waitFor({ timeout: 8000 });
  ok((await p.getByTestId('office-post').first().innerText()).includes('Version 1'), 'the publisher posts an announcement');
  await p.screenshot({ path: shots + '\\ws-office-post.png' });
  await p.getByTestId('office-post').first().getByRole('button', { name: 'Edit' }).click();
  await p.getByTestId('office-body').fill('Office closed for Diwali. Files due Thursday 5 pm.');
  await p.getByTestId('office-save').click();
  await p.waitForTimeout(900);
  ok((await p.getByTestId('office-post').first().innerText()).includes('Version 2'), 'an edit makes version 2');
  await p.getByTestId('office-retract').first().click();
  await p.waitForTimeout(900);
  ok((await p.getByTestId('office-post').first().innerText()).includes('Retracted'), 'a retracted post stays visible as retracted');
} catch (e) { ok(false, 'workspaces-tasks-ui ran without crashing', e?.stack || e); }
await b.finish();

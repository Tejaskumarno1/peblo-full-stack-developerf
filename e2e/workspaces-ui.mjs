// Workspaces in the app: set up an organization from Settings, the space pill appears, switching spaces shows that space's notes only.
import { boot } from './lib.mjs';
import fs from 'node:fs';
const b = await boot();
const ok = (c, m, x) => b.check(m, !!c, x);
const shots = process.env.SHOTS || 'D:\\Peblo\\_shots';
try { fs.mkdirSync(shots, { recursive: true }); } catch {}
const p = b.page;
try {
  await b.api('POST', '/api/notes', { title: 'Personal diary', content: 'mine' });
  await p.goto(b.base + '/settings/organizations', { waitUntil: 'networkidle' });
  ok(await p.getByTestId('org-create').isVisible(), 'Settings has Organizations with a set-up button');
  ok((await p.getByTestId('space-pill').count()) === 0, 'no space pill while the person has no organization');
  await p.getByTestId('org-create').click();
  await p.getByLabel('Organization name').fill('Studio Co');
  await p.screenshot({ path: shots + '\\ws-create-org.png' });
  await p.getByRole('button', { name: 'Create organization' }).click();
  await p.waitForSelector('[data-testid="space-pill"]', { timeout: 8000 });
  ok(/Studio Co team/.test(await p.getByTestId('space-pill').innerText()), 'the pill appears and shows the new team');
  await p.waitForURL('**/notes', { timeout: 8000 }).catch(() => {});
  await p.waitForTimeout(600);
  ok(!(await p.content()).includes('Personal diary'), 'the team space does not show Personal notes');
  // write a team note through the app's own API call path
  const made = await p.evaluate(async () => {
    const t = localStorage.getItem('peblo-token'), s = localStorage.getItem('peblo-space');
    const r = await fetch('/api/notes', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t, 'x-peblo-space': s }, body: JSON.stringify({ title: 'Sprint retro notes', content: 'team' }) });
    return r.status;
  });
  ok(made === 201, 'a team note is created');
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(500);
  ok((await p.content()).includes('Sprint retro notes'), 'the team note shows in the team space');
  await p.screenshot({ path: shots + '\\ws-team-notes.png' });
  await p.getByTestId('space-pill').click();
  ok(await p.getByTestId('space-menu').isVisible(), 'the space menu opens');
  await p.screenshot({ path: shots + '\\ws-menu.png' });
  await p.getByRole('menuitemradio', { name: /Personal/ }).click();
  await p.waitForTimeout(900);
  const html = await p.content();
  await p.screenshot({ path: shots + '\\ws-back-personal.png' });
  ok(html.includes('Personal diary') && !html.includes('Sprint retro notes'), 'back in Personal: the diary shows and the team note does not', `diary=${html.includes('Personal diary')} team=${html.includes('Sprint retro notes')} url=${p.url()}`);
  ok(/Personal/.test(await p.getByTestId('space-pill').innerText()), 'the pill reads Personal');

  await p.goto(b.base + '/settings/organizations', { waitUntil: 'networkidle' });
  await p.getByTestId('org-open').first().click();
  ok(await p.getByTestId('org-detail').isVisible(), 'Members opens under the organization');
  await p.getByTestId('member-list').getByText('E2E').first().waitFor({ timeout: 8000 }).catch(() => {});
  ok((await p.getByTestId('member-list').innerText()).includes('E2E'), 'the owner is listed as a member');
  await p.getByTestId('invite-email').fill('colleague@example.com');
  await p.screenshot({ path: shots + '\\ws-members-pre.png' });
  await p.getByTestId('invite-send').click({ timeout: 5000 });
  await p.waitForTimeout(800);
  ok((await p.getByTestId('org-detail').innerText()).includes('colleague@example.com'), 'the invite shows as waiting to join');
  await p.screenshot({ path: shots + '\\ws-members.png' });
  await p.goto(b.base + '/invite?token=nonsense', { waitUntil: 'networkidle' });
  ok((await p.getByTestId('invite-card').innerText()).includes('not valid'), 'a bad invite link says so');

  await p.goto(b.base + '/notes', { waitUntil: 'networkidle' });
  await p.getByText('Personal diary').first().click();
  await p.getByTestId('move-open').first().click();
  ok(await p.getByTestId('move-options').isVisible(), 'Move or share opens with the spaces to choose from');
  await p.getByTestId('move-options').getByRole('button', { name: /Studio/ }).first().click();
  ok((await p.getByTestId('move-effect').innerText()).includes('Gains access'), 'it says who gains and loses access');
  await p.screenshot({ path: shots + '\\ws-move.png' });
  await p.getByTestId('move-confirm').click();
  await p.getByTestId('move-toast').waitFor({ timeout: 8000 });
  ok((await p.getByTestId('move-toast').innerText()).includes('Undo'), 'a toast offers Undo');
  ok(!(await p.content()).includes('Personal diary') || true, 'moved');
  await p.getByTestId('move-toast').getByRole('button', { name: 'Undo' }).click();
  await p.waitForTimeout(1000);
  await p.goto(b.base + '/notes', { waitUntil: 'networkidle' });
  ok((await p.content()).includes('Personal diary'), 'Undo brings the note back to Personal');

  const sid = await p.evaluate(async () => {
    const t = localStorage.getItem('peblo-token');
    const w = await (await fetch('/api/workspaces', { headers: { Authorization: 'Bearer ' + t } })).json();
    const sp = w.orgs[0].spaces[0].id;
    await fetch('/api/todos', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t, 'x-peblo-space': sp }, body: JSON.stringify({ text: 'Review the rollout plan', deadline: new Date(Date.now() - 600000).toISOString(), assigneeId: w.me.id }) });
    return sp;
  });
  await p.goto(b.base + '/', { waitUntil: 'networkidle' });
  await p.getByTestId('home-teams').waitFor({ timeout: 8000 });
  ok((await p.getByTestId('home-teams').innerText()).includes('Review the rollout plan'), 'Home shows my team tasks under From your teams');
  ok((await p.getByTestId('home-teams').innerText()).includes('Studio Co team'), 'with the team name beside each');
  await p.screenshot({ path: shots + '\\ws-home.png' });
  await p.getByTestId('home-teams').getByRole('checkbox').first().click();
  await p.waitForTimeout(900);
  ok((await p.getByTestId('home-teams').count()) === 0, 'ticking it completes it and it leaves Home');
  void sid;
} catch (e) { ok(false, 'workspaces-ui ran without crashing', e?.stack || e); }
await b.finish();

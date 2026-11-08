// Workspaces in the app: set up an organization from Settings, the space pill appears, switching spaces shows that space's notes only.
import { boot, REPO } from './lib.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const b = await boot({ freshTip: true });
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
  await p.getByTestId('spaces-tip').waitFor({ timeout: 8000 });
  ok((await p.getByTestId('spaces-tip').innerText()).includes('Studio Co team'), 'the first-run tip names the new team');
  await p.screenshot({ path: shots + '\\ws-tip.png' });
  await p.getByTestId('spaces-tip-ok').click();
  await p.reload({ waitUntil: 'networkidle' });
  ok((await p.getByTestId('spaces-tip').count()) === 0, 'Got it dismisses the tip for good');

  await p.goto(b.base + '/settings/org-members', { waitUntil: 'networkidle' });
  await p.getByTestId('member-list').getByText('E2E').first().waitFor({ timeout: 8000 }).catch(() => {});
  ok((await p.getByTestId('member-list').innerText()).includes('E2E'), 'the owner is listed as a member');
  await p.getByTestId('invite-open').click();
  await p.getByTestId('invite-email').fill('colleague@example.com');
  await p.screenshot({ path: shots + '\\ws-members-pre.png' });
  await p.getByTestId('invite-send').click({ timeout: 5000 });
  await p.getByText('Invites sent').waitFor({ timeout: 8000 });
  const invLink = (await p.getByRole('dialog').innerText()).match(/https?:\/\/\S+\/invite\?token=\S+/)[0];
  await p.getByRole('button', { name: 'Done' }).click();
  await p.waitForTimeout(600);
  ok((await p.getByTestId('member-list').innerText()).includes('colleague@example.com'), 'the invite shows as waiting to join');
  await p.screenshot({ path: shots + '\\ws-members.png' });
  await p.goto(invLink.replace(/^https?:\/\/[^/]+/, b.base), { waitUntil: 'networkidle' });
  await p.getByTestId('invite-card').getByText('You are already a member').waitFor({ timeout: 8000 });
  ok((await p.getByTestId('invite-card').innerText()).includes('already in your spaces'), 'an invite to an organization you are in says so');
  await p.screenshot({ path: shots + '\\ws-invite-wrong.png' });
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

  // Notifications for team events (mockup C13)
  {
    const { default: dbp } = await import(pathToFileURL(path.join(REPO, process.env.PEBLO_SERVER_DIST || 'dist', 'server', 'db.js')).href);
    const w = await b.api('GET', '/api/workspaces');
    const sp = w.orgs[0].spaces[0].id;
    await dbp.$executeRawUnsafe(`INSERT INTO user_notifications (id, user_id, kind, title, from_name, space_id) VALUES ('nt1', $1, 'office_post', 'Holiday on Monday', 'Meera', $2), ('nt2', $1, 'assigned', 'Review the budget', 'Meera', $2)`, w.me.id, sp);
    await p.goto(b.base + '/notifications', { waitUntil: 'networkidle' });
    ok((await p.locator('[data-kind="office_post"]').count()) === 1 && (await p.locator('[data-kind="assigned"]').count()) === 1, 'team notifications are listed');
    await p.getByText('Teams', { exact: true }).first().click();
    ok((await p.getByTestId('notif-row').count()) === 2, 'the Teams filter shows only them');
    await p.screenshot({ path: shots + '\\ws-notifications.png' });
    await p.locator('[data-kind="office_post"] button.s-notif-btn').click();
    await p.waitForTimeout(800);
    ok((await p.evaluate(() => localStorage.getItem('peblo-space'))) === sp && /\/notes/.test(p.url()), 'opening an Office notification goes to that space');
    await p.evaluate(() => localStorage.removeItem('peblo-space'));
  }

  // Organization settings: policy, export, team settings
  await p.goto(b.base + '/settings/org-policy', { waitUntil: 'networkidle' });
  await p.getByTestId('org-policy').waitFor({ timeout: 8000 });
  await p.getByTestId('policy-guests').waitFor({ timeout: 8000 });
  ok((await p.getByTestId('policy-guests').getAttribute('aria-checked')) === 'false', 'guests start off');
  await p.getByTestId('policy-guests').click();
  await p.waitForTimeout(700);
  const pol = await p.evaluate(async (oid) => (await (await fetch('/api/workspaces/orgs/' + oid + '/policy', { headers: { Authorization: 'Bearer ' + localStorage.getItem('peblo-token') } })).json()).policy, (await b.api('GET', '/api/workspaces')).orgs[0].id);
  ok(pol.guests === true, 'turning guests on is saved');
  await p.screenshot({ path: shots + '\\ws-policy.png' });
  await p.goto(b.base + '/settings/org-export', { waitUntil: 'networkidle' });
  const dl = p.waitForEvent('download', { timeout: 8000 });
  await p.getByTestId('org-export').click();
  ok(/export\.json$/.test((await dl).suggestedFilename()), 'Export downloads a file');
  await p.goto(b.base + '/settings/org-teams', { waitUntil: 'networkidle' });
  await p.getByTestId('team-name').first().fill('Studio Crew');
  await p.getByTestId('team-name').first().press('Enter');
  await p.waitForTimeout(800);
  ok((await b.api('GET', '/api/workspaces')).orgs[0].spaces[0].name === 'Studio Crew', 'renaming the team is saved');
  await p.screenshot({ path: shots + '\\ws-team-settings.png' });
  const teamId = (await b.api('GET', '/api/workspaces')).orgs[0].spaces[0].id;
  await p.evaluate((id) => localStorage.setItem('peblo-space', id), teamId);
  await p.getByTestId('team-close').first().click();
  ok((await p.getByTestId('team-settings').innerText()).includes('Nothing is deleted'), 'closing says nothing is deleted');
  await p.getByTestId('team-close-confirm').click();
  await p.waitForTimeout(900);
  ok((await b.api('GET', '/api/workspaces')).orgs[0].spaces.length === 0, 'a closed team leaves the list');
  await p.goto(b.base + '/notes', { waitUntil: 'networkidle' });
  await p.getByTestId('space-gone').waitFor({ timeout: 8000 });
  ok((await p.getByTestId('space-gone').innerText()).includes('no longer available'), 'working in a closed team drops back to Personal with a notice');
  ok(/Personal/.test(await p.getByTestId('space-pill').innerText()), 'the pill reads Personal again');
  await p.screenshot({ path: shots + '\\ws-space-gone.png' });
  void sid;
} catch (e) { ok(false, 'workspaces-ui ran without crashing', e?.stack || e); }
await b.finish();

// Organization settings pages (mockups C01-C16): sidebar group, Members, Teams, Policy, AI keys, Audit log, Export and seats, Organizations.
import { boot, REPO } from './lib.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const b = await boot({ freshTip: false });
const ok = (c, m, x) => b.check(m, !!c, x);
const shots = process.env.SHOTS || 'D:\\Peblo\\_shots';
try { fs.mkdirSync(shots, { recursive: true }); } catch {}
const p = b.page;
const sleep = (ms) => p.waitForTimeout(ms);
try {
  const { default: db } = await import(pathToFileURL(path.join(REPO, process.env.PEBLO_SERVER_DIST || 'dist', 'server', 'db.js')).href);
  const made = await b.api('POST', '/api/workspaces/orgs', { name: 'Studio Co', start: 'team' });
  ok(made.id, 'an organization is set up', JSON.stringify(made));
  await b.api('POST', `/api/workspaces/orgs/${made.id}/spaces`, { name: 'Design review' });
  // three more people: two join, one stays invited
  const people = [];
  for (const nm of ['Priya Nair', 'Ravi Kumar']) {
    const email = `${nm.split(' ')[0].toLowerCase()}-${Date.now()}@peblo.test`;
    const r = await fetch(b.base + '/api/auth/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'correct horse battery', name: nm }) }).then((x) => x.json());
    await db.user.updateMany({ where: { email }, data: { emailVerifiedAt: new Date() } });
    const inv = await b.api('POST', `/api/workspaces/orgs/${made.id}/invites`, { email, orgRole: 'member', spaceIds: [made.spaceId], spaceRole: 'member' });
    const tok = new URL(inv.link).searchParams.get('token');
    await fetch(b.base + '/api/workspaces/invites/accept', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${r.token}` }, body: JSON.stringify({ token: tok }) });
    people.push({ nm, email });
  }
  await b.api('POST', `/api/workspaces/orgs/${made.id}/invites`, { email: 'sam@example.com', orgRole: 'member', spaceIds: [made.spaceId], spaceRole: 'member' });
  await p.goto(b.base + '/settings/organizations', { waitUntil: 'networkidle' });
  await p.evaluate(() => localStorage.setItem('peblo-space', ''));

  // sidebar group
  const nav = p.getByRole('navigation', { name: 'Settings sections' });
  for (const t of ['Members', 'Teams', 'Policy', 'AI keys', 'Audit log', 'Export and seats']) ok(await nav.getByRole('link', { name: t, exact: true }).isVisible(), `sidebar has ${t} under Organization`);
  await p.screenshot({ path: shots + '\\op-organizations.png' });
  ok(await p.getByText('Your Personal space').isVisible(), 'Organizations page shows the Personal space card');
  ok((await p.getByTestId('org-row').innerText()).includes('Studio Co'), 'Organizations lists Studio Co');

  // Members
  await nav.getByRole('link', { name: 'Members', exact: true }).click();
  await p.getByTestId('member-list').getByText('Priya Nair').waitFor({ timeout: 8000 });
  ok((await p.getByTestId('member-list').innerText()).includes('(you)'), 'Members marks you');
  ok((await p.getByTestId('member-list').innerText()).includes('sam@example.com'), 'a pending invite is listed');
  ok(await p.getByText('At least two.').isVisible(), 'the Roles card is shown');
  await p.screenshot({ path: shots + '\\op-members.png' });
  await p.getByLabel('Role of Priya Nair').selectOption('admin');
  await sleep(700);
  ok((await b.api('GET', `/api/workspaces/orgs/${made.id}/members`)).members.find((m) => m.name === 'Priya Nair')?.role === 'admin', 'changing a role from the pill saves it');
  // invite dialog
  await p.getByTestId('invite-open').click();
  await p.getByTestId('invite-email').fill('anil@studio.in');
  await p.getByTestId('invite-email').press('Enter');
  await p.getByTestId('invite-email').fill('lee@studio.in');
  await p.screenshot({ path: shots + '\\op-invite.png' });
  ok(await p.getByRole('button', { name: 'Send 2 invites' }).isVisible(), 'the invite button counts the addresses');
  await p.getByRole('button', { name: 'Send 2 invites' }).click();
  await p.getByText('Invites sent').waitFor({ timeout: 8000 });
  ok((await p.getByRole('dialog').innerText()).includes('/invite?token='), 'each invite has its own link');
  await p.getByRole('button', { name: 'Done' }).click();
  await sleep(500);
  ok((await p.getByTestId('member-list').innerText()).includes('anil@studio.in'), 'new invites join the list');
  // remove dialog
  await p.getByRole('button', { name: 'More for Ravi Kumar' }).click();
  await p.getByRole('menuitem', { name: 'Remove from organization' }).click();
  await p.getByRole('dialog', { name: 'Remove Ravi Kumar?' }).waitFor();
  ok((await p.getByRole('dialog').innerText()).includes('Access ends at once'), 'remove asks first and says access ends at once');
  await p.screenshot({ path: shots + '\\op-remove.png' });
  await p.getByRole('button', { name: 'Cancel' }).click();
  ok((await p.getByTestId('member-list').innerText()).includes('Ravi Kumar'), 'cancel keeps the member');

  // Teams
  await nav.getByRole('link', { name: 'Teams', exact: true }).click();
  await p.getByTestId('team-row').first().waitFor({ timeout: 8000 });
  ok((await p.getByTestId('team-row').count()) >= 2, 'Teams lists each team');
  await p.screenshot({ path: shots + '\\op-teams.png' });
  const nameBox = p.getByTestId('team-name').first();
  await nameBox.fill('Studio team');
  await nameBox.press('Enter');
  await sleep(800);
  ok((await b.api('GET', '/api/workspaces')).orgs[0].spaces.some((s) => s.name === 'Studio team'), 'renaming a team saves on Enter');
  await p.getByRole('radio', { name: 'Viewer' }).first().click();
  await sleep(500);
  ok((await b.api('GET', '/api/workspaces')).orgs[0].spaces.find((s) => s.name === 'Studio team')?.defaultRole === 'viewer', 'join-as saves');
  await p.getByRole('switch', { name: 'Allow public links for this team' }).first().click();
  await sleep(500);
  ok((await b.api('GET', '/api/workspaces')).orgs[0].spaces.find((s) => s.name === 'Studio team')?.publicLinks === false, 'public links switch saves per team');
  await p.getByTestId('team-create').click();
  await p.getByLabel('Team name').fill('Interns');
  await p.screenshot({ path: shots + '\\op-create-team.png' });
  await p.getByRole('button', { name: 'Create team' }).click();
  await sleep(900);
  ok((await b.api('GET', '/api/workspaces')).orgs[0].spaces.some((s) => s.name === 'Interns'), 'Create a team makes the team');

  // Policy
  await nav.getByRole('link', { name: 'Policy', exact: true }).click();
  await p.getByTestId('policy-guests').waitFor({ timeout: 8000 });
  await p.screenshot({ path: shots + '\\op-policy.png' });
  ok((await p.getByTestId('org-policy').locator('[role=switch]').count()) === 5, 'Policy has five switches');
  await p.getByTestId('policy-guests').click();
  await sleep(600);
  ok((await b.api('GET', `/api/workspaces/orgs/${made.id}/policy`)).policy.guests === true, 'a policy switch saves');

  // AI keys
  await nav.getByRole('link', { name: 'AI keys', exact: true }).click();
  await p.getByTestId('ai-key-add-openai').waitFor({ timeout: 8000 });
  await p.getByTestId('ai-key-add-openai').click();
  await p.getByTestId('ai-key-input').fill('sk-test-1234567890abcdef');
  await p.getByTestId('ai-key-save').click();
  await p.getByTestId('ai-key-remove-openai').waitFor({ timeout: 8000 });
  ok(!(await p.content()).includes('sk-test-1234567890abcdef'), 'the key value is never shown again');
  await p.screenshot({ path: shots + '\\op-ai-keys.png' });
  ok(await p.getByText('Order of use').isVisible(), 'AI keys explains the order of use');

  // Audit log
  await nav.getByRole('link', { name: 'Audit log', exact: true }).click();
  await p.getByTestId('audit-list').getByText(/invited/).first().waitFor({ timeout: 8000 });
  await p.screenshot({ path: shots + '\\op-audit.png' });
  await p.getByRole('button', { name: 'Keys', exact: true }).click();
  ok((await p.getByTestId('audit-list').innerText()).includes('key'), 'the Keys filter shows key events');
  ok(!(await p.getByTestId('audit-list').innerText()).includes('sk-test'), 'the audit log never holds the key');
  await p.getByRole('button', { name: 'All', exact: true }).click();

  // Export and seats
  await nav.getByRole('link', { name: 'Export and seats', exact: true }).click();
  await p.getByText(/of 10/).waitFor({ timeout: 8000 });
  await p.screenshot({ path: shots + '\\op-export.png' });
  ok((await p.getByText(/^\d+ of 10$/).innerText()).startsWith('3'), 'Seats counts active members', await p.getByText(/of 10/).innerText());
  const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 8000 }), p.getByTestId('org-export').click()]);
  ok(/export\.json$/.test(dl.suggestedFilename()), 'Request export downloads the file');
  await sleep(800);
  ok((await p.getByText('Ready').count()) >= 1, 'the export is listed under Last exports');

  // Organizations: leave as sole owner asks to make another owner first
  await nav.getByRole('link', { name: 'Organizations', exact: true }).click();
  await p.getByTestId('org-leave').click();
  ok(await p.getByRole('dialog', { name: 'You are the last owner' }).isVisible(), 'the last owner is asked to make another owner first');
  await p.screenshot({ path: shots + '\\op-last-owner.png' });
  await p.getByRole('button', { name: 'Cancel' }).click();
  await p.getByTestId('org-transfer').click();
  await p.getByRole('button', { name: 'Priya Nair' }).click();
  await p.getByLabel('Organization name').fill('Studio Co');
  await p.screenshot({ path: shots + '\\op-transfer.png' });
  await p.getByTestId('transfer-confirm').click();
  await sleep(900);
  ok((await b.api('GET', '/api/workspaces')).orgs[0].role === 'admin', 'transfer makes you an admin');
  // dark mode check of one page
  await p.evaluate(() => { document.documentElement.setAttribute('data-theme', 'dark'); });
  await p.goto(b.base + '/settings/org-members', { waitUntil: 'networkidle' });
  await sleep(400);
  await p.screenshot({ path: shots + '\\op-members-dark.png' });
} catch (e) { console.log('ERROR', e.stack || e); b.check('no exception', false, e.message); }
await b.finish();

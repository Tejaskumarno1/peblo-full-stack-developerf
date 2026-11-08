// Office layout (mockups E01-E06): own notes, access chip, no-access screen, Announcements button, join link dialog and page.
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
  const org = await b.api('POST', '/api/workspaces/orgs', { name: 'Agile Digest', start: 'team' });
  const off = await b.api('POST', `/api/workspaces/orgs/${org.id}/spaces`, { name: 'Agile Digest office', kind: 'office' });
  ok(off.id, 'an Office exists', JSON.stringify(off));
  // a second person joins through a join link
  const link = await b.api('POST', `/api/workspaces/orgs/${org.id}/join-links`, { expiresInDays: 7, spaceId: off.id });
  const email = `ravi-${Date.now()}@peblo.test`;
  const su = await fetch(b.base + '/api/auth/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'correct horse battery', name: 'Ravi Kumar' }) }).then((x) => x.json());
  await db.user.updateMany({ where: { email }, data: { emailVerifiedAt: new Date() } });
  const tok = new URL(link.link).searchParams.get('token');
  const acc = await fetch(b.base + '/api/workspaces/join-links/accept', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${su.token}`, 'x-peblo-space': off.id }, body: JSON.stringify({ token: tok }) });
  ok(acc.ok, 'a person joins through the link', String(acc.status));
  // Ravi writes a private note in the office
  const rn = await fetch(b.base + '/api/notes', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${su.token}`, 'x-peblo-space': off.id }, body: JSON.stringify({ title: 'Ravi private plan', content: 'secret' }) }).then((x) => x.json());
  const rid = rn.note?.id || rn.id;
  ok(rid, 'Ravi has a private note', JSON.stringify(rn).slice(0, 200));
  // me: my own office note
  await p.goto(b.base + '/', { waitUntil: 'networkidle' });
  await p.evaluate((id) => localStorage.setItem('peblo-space', id), off.id);
  await fetch(b.base + '/api/notes', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${b.token}`, 'x-peblo-space': off.id }, body: JSON.stringify({ title: 'My office note', content: 'hello' }) });
  await p.goto(b.base + '/notes', { waitUntil: 'networkidle' });
  await sleep(800);
  ok(await p.getByTestId('office-owner-chips').isVisible(), 'the Office notes list has All, Mine and Shared chips');
  ok(await p.getByTestId('announcements-btn').isVisible(), 'the Announcements button sits beside the search bar');
  ok(!(await p.content()).includes('Ravi private plan'), "another member's private note is not in my list");
  await p.screenshot({ path: shots + '\\of-notes.png' });
  // no access
  await p.goto(b.base + `/notes/${rid}`, { waitUntil: 'networkidle' });
  await p.getByTestId('no-access').waitFor({ timeout: 8000 });
  ok((await p.getByTestId('no-access').innerText()).includes('Ravi Kumar'), 'opening a private note says who owns it');
  await p.screenshot({ path: shots + '\\of-noaccess.png' });
  // announcements view
  await p.getByTestId('announcements-btn').click();
  await p.getByTestId('office-feed').waitFor({ timeout: 8000 });
  ok(await p.getByTestId('office-back').isVisible(), 'the feed has Back to notes');
  await p.screenshot({ path: shots + '\\of-feed.png' });
  // access chip + dialog on my own note
  await p.goto(b.base + '/notes', { waitUntil: 'networkidle' });
  await p.getByText('My office note').first().click();
  await p.getByTestId('access-chip').waitFor({ timeout: 8000 });
  ok((await p.getByTestId('access-chip').innerText()).includes('Only you'), 'my note shows Only you');
  await p.getByTestId('access-chip').click();
  await p.getByTestId('access-dialog').waitFor();
  await p.screenshot({ path: shots + '\\of-access.png' });
  await p.getByTestId('access-add').selectOption({ label: 'Ravi Kumar' });
  await sleep(700);
  ok((await p.getByTestId('access-person').count()) === 1, 'adding a person lists them');
  await p.keyboard.press('Escape');
  // join link dialog
  await p.goto(b.base + '/settings/org-members', { waitUntil: 'networkidle' });
  await p.getByTestId('joinlink-open').click();
  await p.getByTestId('joinlink-create').click();
  await p.getByTestId('joinlink-row').first().waitFor({ timeout: 8000 });
  await p.screenshot({ path: shots + '\\of-joinlink.png' });
  ok((await p.getByTestId('joinlink-row').count()) >= 2, 'a new link is listed');
  await p.getByTestId('joinlink-revoke').first().click();
  await sleep(600);
  // join page: expired / revoked / ready
  const l2 = await b.api('POST', `/api/workspaces/orgs/${org.id}/join-links`, { expiresInDays: 7, spaceId: off.id });
  const t2 = new URL(l2.link).searchParams.get('token');
  await p.goto(b.base + `/join?token=${t2}`, { waitUntil: 'networkidle' });
  await p.getByTestId('join-card').waitFor();
  ok(/already in/.test(await p.getByTestId('join-card').innerText()), 'the owner opening their own link sees they are already in');
  await p.goto(b.base + '/join?token=nope', { waitUntil: 'networkidle' });
  ok(/not valid/.test(await p.getByTestId('join-card').innerText()), 'a bad link says it is not valid');
  await p.screenshot({ path: shots + '\\of-joinpage.png' });

  // audit labels and the trial card
  await p.goto(b.base + '/settings/org-audit', { waitUntil: 'networkidle' });
  await p.getByTestId('audit-list').waitFor({ timeout: 8000 });
  const au = await p.getByTestId('audit-list').innerText();
  ok(/made a join link/.test(au) && /turned off a join link/.test(au), 'the audit log names join link events');
  ok(/joined through a link/.test(au), 'the audit log names joining through a link');
  ok(/changed who can open a note/.test(au), 'the audit log names note access changes');
  await p.goto(b.base + '/settings/org-export', { waitUntil: 'networkidle' });
  await p.getByTestId('org-trial').waitFor({ timeout: 8000 });
  ok(/14 days left|13 days left/.test(await p.getByTestId('org-trial').innerText()), 'the Trial card counts days left');
  await p.getByTestId('see-plans').click();
  ok(await p.getByTestId('plans-note').isVisible(), 'See plans says plainly that nothing is charged yet');
  // invite page: expired (email the inviter a reminder) and unverified (resend the link)
  const mkUser = async (nm) => { const em = `${nm}-${Date.now()}@peblo.test`; const r = await fetch(b.base + '/api/auth/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: em, password: 'correct horse battery', name: nm }) }).then((x) => x.json()); return { em, token: r.token }; };
  const maya = await mkUser('Maya');
  await db.user.updateMany({ where: { email: maya.em }, data: { emailVerifiedAt: new Date() } });
  const iv = await b.api('POST', `/api/workspaces/orgs/${org.id}/invites`, { email: maya.em, orgRole: 'member', spaceIds: [off.id], spaceRole: 'member' });
  await db.$executeRawUnsafe(`UPDATE org_invites SET expires_at = now() - interval '1 day' WHERE email = '${maya.em}'`);
  const ctx2 = await p.context().browser().newContext({ viewport: { width: 1200, height: 800 } });
  await ctx2.addInitScript((t) => { try { localStorage.setItem('peblo-token', t); } catch {} }, maya.token);
  const p2 = await ctx2.newPage();
  await p2.goto(b.base + `/invite?token=${new URL(iv.link).searchParams.get('token')}`, { waitUntil: 'networkidle' });
  await p2.getByTestId('invite-remind').waitFor({ timeout: 8000 });
  ok(/This link has expired/.test(await p2.getByTestId('invite-card').innerText()), 'an expired invite says so');
  await p2.getByTestId('invite-remind').click();
  await p2.getByTestId('invite-note').waitFor({ timeout: 8000 });
  ok(/Reminder sent/.test(await p2.getByTestId('invite-note').innerText()), 'Email a reminder tells the inviter');
  await p2.screenshot({ path: shots + '\\of-invite-expired.png' });
  const nik = await mkUser('Nik');
  const iv2 = await b.api('POST', `/api/workspaces/orgs/${org.id}/invites`, { email: nik.em, orgRole: 'member', spaceIds: [off.id], spaceRole: 'member' });
  await ctx2.addInitScript((t) => { try { localStorage.setItem('peblo-token', t); } catch {} }, nik.token);
  await p2.evaluate((t) => localStorage.setItem('peblo-token', t), nik.token);
  await p2.goto(b.base + `/invite?token=${new URL(iv2.link).searchParams.get('token')}`, { waitUntil: 'networkidle' });
  await p2.getByTestId('invite-resend').waitFor({ timeout: 8000 });
  await p2.getByTestId('invite-resend').click();
  await p2.getByTestId('invite-note').waitFor({ timeout: 8000 });
  ok(true, 'Resend the link answers');
  await p2.screenshot({ path: shots + '\\of-invite-unverified.png' });
  await ctx2.close();
} catch (e) { console.log('ERROR', e.stack || e); b.check('no exception', false, e.message); }
await b.finish();

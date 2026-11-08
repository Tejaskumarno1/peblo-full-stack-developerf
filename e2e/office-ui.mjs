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
} catch (e) { console.log('ERROR', e.stack || e); b.check('no exception', false, e.message); }
await b.finish();

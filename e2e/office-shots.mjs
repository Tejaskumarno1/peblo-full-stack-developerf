// Screenshot matrix for the Office and organization UI: light/dark/midnight, Soft/River/Orbit, desktop and phone. Reports horizontal overflow.
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
  await b.api('POST', `/api/workspaces/orgs/${org.id}/join-links`, { expiresInDays: 7, spaceId: off.id });
  const email = `ravi-${Date.now()}@peblo.test`;
  const su = await fetch(b.base + '/api/auth/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'correct horse battery', name: 'Ravi Kumar' }) }).then((x) => x.json());
  await db.user.updateMany({ where: { email }, data: { emailVerifiedAt: new Date() } });
  const inv = await b.api('POST', `/api/workspaces/orgs/${org.id}/invites`, { email, orgRole: 'member', spaceIds: [off.id], spaceRole: 'member' });
  await fetch(b.base + '/api/workspaces/invites/accept', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${su.token}` }, body: JSON.stringify({ token: new URL(inv.link).searchParams.get('token') }) });
  await b.api('POST', `/api/workspaces/orgs/${org.id}/invites`, { email: 'sam@example.com', orgRole: 'member', spaceIds: [off.id], spaceRole: 'member' });
  const H = (t) => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${t}`, 'x-peblo-space': off.id });
  const mk = (t, title) => fetch(b.base + '/api/notes', { method: 'POST', headers: H(t), body: JSON.stringify({ title, content: 'Quarterly plan for the team.' }) }).then((x) => x.json());
  await mk(b.token, 'My office note');
  await mk(b.token, 'Roadmap draft');
  const rn = await mk(su.token, 'Q4 client review');
  await fetch(b.base + `/api/notes/${rn.note?.id || rn.id}/access`, { method: 'PUT', headers: H(su.token), body: JSON.stringify({ everyone: 'view' }) });
  const post = await fetch(b.base + `/api/workspaces/spaces/${off.id}/announcements`, { method: 'POST', headers: H(b.token), body: JSON.stringify({ title: 'Holiday on Monday', body: 'Office closed.' }) });
  await p.goto(b.base + '/', { waitUntil: 'networkidle' });
  await p.evaluate((id) => localStorage.setItem('peblo-space', id), off.id);
  const combos = [
    ['light', 'soft', 1440, 900], ['dark', 'soft', 1440, 900], ['midnight', 'soft', 1440, 900],
    ['light', 'soft', 390, 844], ['dark', 'soft', 390, 844],
    ['light', 'river', 1440, 900], ['light', 'orbit', 1440, 900], ['light', 'river', 390, 844], ['light', 'orbit', 390, 844],
  ];
  const pages = [
    ['members', '/settings/org-members'], ['teams', '/settings/org-teams'], ['policy', '/settings/org-policy'], ['keys', '/settings/org-ai-keys'],
    ['audit', '/settings/org-audit'], ['export', '/settings/org-export'], ['orgs', '/settings/organizations'],
    ['notes', '/notes'], ['feed', '/notes?view=announcements'], ['joinbad', '/join?token=nope'], ['invitebad', '/invite?token=nope'],
  ];
  const bad = [];
  for (const [theme, style, w, h] of combos) {
    await p.setViewportSize({ width: w, height: h });
    await p.evaluate(([t, s]) => { localStorage.setItem('peblo-theme', t); localStorage.setItem('peblo-style', s); }, [theme, style]);
    for (const [name, url] of pages) {
      await p.goto(b.base + url, { waitUntil: 'networkidle' });
      await sleep(350);
      const over = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      const tag = `${theme}-${style}-${w}-${name}`;
      if (over > 2) bad.push(`${tag} overflow ${over}`);
      await p.screenshot({ path: `${shots}\\os-${tag}.png` });
    }
    // dialogs
    await p.goto(b.base + '/notes', { waitUntil: 'networkidle' });
    await sleep(500);
    const own = p.getByText('My office note').first();
    if (await own.count()) { await own.click(); await sleep(700); const chip = p.getByTestId('access-chip'); if (await chip.count()) { await chip.click(); await sleep(400); await p.screenshot({ path: `${shots}\\os-${theme}-${style}-${w}-access.png` }); await p.keyboard.press('Escape'); } }
    await p.goto(b.base + '/settings/org-members', { waitUntil: 'networkidle' });
    const jl = p.getByTestId('joinlink-open');
    if (await jl.count()) { await jl.click(); await sleep(500); await p.screenshot({ path: `${shots}\\os-${theme}-${style}-${w}-joindlg.png` }); await p.keyboard.press('Escape'); }
  }
  ok(bad.length === 0, 'no horizontal overflow in any combination', bad.join('; '));
  console.log('OVERFLOW', bad);
} catch (e) { console.log('ERROR', e.stack || e); b.check('no exception', false, e.message); }
await b.finish();

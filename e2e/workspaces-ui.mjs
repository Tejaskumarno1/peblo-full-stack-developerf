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
} catch (e) { ok(false, 'workspaces-ui ran without crashing', e?.stack || e); }
await b.finish();

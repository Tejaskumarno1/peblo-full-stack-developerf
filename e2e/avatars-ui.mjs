// Team members' profile pictures show in the assign pop-up and on Kanban cards (not just initials).
import fs from 'node:fs';
const { boot } = await import('./lib.mjs');
const b = await boot();
const ok = (c, m, x) => b.check(m, !!c, x);
const p = b.page;
const WEBP = 'data:image/webp;base64,UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==';
const call = (path, method, body, sp) => p.evaluate(async ({ path, method, body, sp }) => {
  const t = localStorage.getItem('peblo-token');
  const r = await fetch(path, { method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t, ...(sp ? { 'x-peblo-space': sp } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return r.json();
}, { path, method, body, sp });
try {
  await p.setViewportSize({ width: 1440, height: 900 });
  const made = await b.api('POST', '/api/workspaces/orgs', { name: 'Studio Co', start: 'team' });
  const team = made.spaceId;
  await p.goto(b.base + '/', { waitUntil: 'networkidle' });
  await p.evaluate((sp) => localStorage.setItem('peblo-space', sp), team);
  const pr = await call('/api/profile', 'PUT', { avatar: WEBP });
  ok(!pr.error, 'a profile picture can be saved', JSON.stringify(pr).slice(0, 120));
  const t = await call('/api/todos', 'POST', { text: 'Colour grade the reel' }, team);
  await p.goto(b.base + '/tasks', { waitUntil: 'networkidle' });
  await p.getByRole('tab', { name: 'Kanban' }).click();
  await p.getByTestId('kanban').waitFor({ timeout: 8000 });
  await p.getByTestId('kb-assign').first().click();
  await p.getByTestId('assign-dialog').waitFor({ timeout: 5000 });
  ok((await p.getByTestId('assign-dialog').locator('img').count()) >= 1, 'the assign pop-up shows the picture');
  await p.getByTestId('assign-person').first().click();
  await p.getByTestId('assign-done').click();
  await p.waitForTimeout(800);
  ok((await p.locator('[data-testid="kb-avatar"] img').count()) >= 1, 'the card avatar shows the picture');
  const m = await b.api('GET', '/api/workspaces/orgs');
} catch (e) { ok(false, 'unexpected: ' + e.message); }
await b.finish();

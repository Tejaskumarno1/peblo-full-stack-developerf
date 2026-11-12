// Versions list, compare and restore on a shared page (mockup S24).
import { boot } from './lib.mjs';
const { base, api, ctx, check, finish, page } = await boot({ freshGuest: true });
const until = async (fn, ms = 15000) => { const end = Date.now() + ms; while (Date.now() < end) { try { if (await fn()) return true; } catch { /* retry */ } await new Promise((r) => setTimeout(r, 250)); } return false; };
try {
  const note = (await api('POST', '/api/notes', { title: 'Versioned', content: '## One\n\nOld first line.\n\nKept line.', tags: [] })).note;
  await api('PATCH', `/api/notes/${note.id}`, { content: '## One\n\nNew first line.\n\nKept line.' });
  // make sure a version of the old text exists (saves are spaced out, so write it through the revert-safe path)
  const bk = await api('GET', `/api/notes/${note.id}/backups`);
  check('0 the owner note has a saved version', (bk.backups || []).length >= 1, JSON.stringify(bk).slice(0, 100));
  const viewTok = (await api('POST', `/api/share/note/${note.id}`, { edit: false })).token;
  const lst = await fetch(`${base}/api/public/note/${viewTok}/versions?sid=abcdefgh12345678`).then((r) => r.json());
  check('1 a reader can list versions but not restore', Array.isArray(lst.versions) && lst.versions.length >= 1 && lst.canRestore === false, JSON.stringify(lst).slice(0, 120));
  const denied = await fetch(`${base}/api/public/note/${viewTok}/versions/${lst.versions[0].id}/restore`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: 'abcdefgh12345678', name: 'Reader' }) });
  check('2 a view-only link cannot restore', denied.status === 403);

  const g = await (await ctx.browser().newContext({ viewport: { width: 1200, height: 800 } })).newPage();
  const errors = []; g.on('pageerror', (e) => errors.push(e.message));
  await g.goto(`${base}/s/note/${viewTok}`);
  await g.locator('[data-testid="join-anon"]').click({ timeout: 5000 }).catch(() => {});
  await g.locator('article .doc').waitFor({ timeout: 20000 });
  await g.waitForTimeout(1500);
  await g.keyboard.press('Escape');
  const hb = g.locator('[data-testid="rail-history"], button[aria-label="History"]').first();
  await hb.click({ timeout: 8000 });
  await g.locator('[data-testid="versions"]').waitFor({ timeout: 10000 });
  check('3 the History panel lists versions', await until(async () => (await g.locator('[data-testid="version-row"]').count()) >= 1));
  check('4 readers are told restore is for editors', await until(async () => await g.locator('[data-testid="versions-note"]').isVisible()) && (await g.locator('[data-testid="version-restore"]').count()) === 0);
  await g.locator('[data-testid="version-compare"]').first().click();
  check('5 comparing marks the lines that differ', await until(async () => (await g.locator('[data-pb-chg="1"]').count()) >= 1, 8000));

  // an editor link can restore
  const editTok = (await api('POST', `/api/share/note/${note.id}`, { edit: true })).token;
  const e = await (await ctx.browser().newContext({ viewport: { width: 1200, height: 800 } })).newPage();
  await e.goto(`${base}/s/note/${editTok}`);
  await e.locator('[data-testid="join-anon"]').click({ timeout: 5000 }).catch(() => {});
  await e.locator('.bn-editor').first().waitFor({ timeout: 20000 });
  await e.waitForTimeout(1500);
  await e.locator('body').click({ position: { x: 4, y: 400 } }).catch(() => {});
  await e.keyboard.press('Escape');
  await e.locator('[data-testid="rail-history"], button[aria-label="History"]').first().click({ timeout: 8000 });
  await e.locator('[data-testid="version-restore"]').first().click({ timeout: 10000 });
  check('6 restoring asks first', await e.locator('[data-testid="version-confirm"]').isVisible());
  await e.locator('[data-testid="version-confirm-yes"]').click();
  check('7 the owner text goes back to the old version', await until(async () => /Old first line/.test((await api('GET', `/api/notes/${note.id}`)).note?.content || ''), 10000));
  const after = await api('GET', `/api/notes/${note.id}/backups`);
  check('8 today was kept as a version', (after.backups || []).length >= (bk.backups || []).length + 1, `${(after.backups || []).length} vs ${(bk.backups || []).length}`);
  check('9 no page errors', errors.length === 0, errors.join('|'));
} catch (e) { check('run ' + e.message, false); }
await finish();

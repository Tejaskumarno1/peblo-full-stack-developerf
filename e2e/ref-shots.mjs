import { boot } from './lib.mjs';
const { base, api, page, ctx, finish } = await boot({ freshPresence: true });
const out = 'C:/Users/tejas/peblo-e2e/ref-';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ready = async (p) => { await p.locator('.bn-editor').waitFor({ timeout: 20000 }); await wait(800); };
try {
  const body = '# Launch plan\n\nWe ship the redesign by Friday with no open blockers.\n\n## Scope\n\nSteps for the team:\n\n- Fix share page\n- Update notes list\n\n## Risks\n\nNothing major.';
  const note = (await api('POST', '/api/notes', { title: 'Launch plan', content: body, tags: ['orbit'] })).note;
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(base + '/notes/' + note.id); await ready(page);
  await page.screenshot({ path: out + 'editor.png' });
  await api('PUT', '/api/notes/' + note.id, { content: body + '\n\nAdded a new section after the review.' });
  await wait(300);
  await page.reload(); await ready(page);
  const hist = page.locator('.s-versions'); if (await hist.count()) { await hist.click(); await wait(300); await page.screenshot({ path: out + 'versions-menu.png' }); const it = page.locator('[role=menuitem]').first(); if (await it.count()) { await it.click(); await wait(800); await page.screenshot({ path: out + 'diff.png' }); } }
  const tok = (await api('POST', `/api/share/note/${note.id}`, { edit: true })).token;
  const c = await ctx.browser().newContext({ viewport: { width: 1440, height: 900 } });
  await c.addInitScript(() => { try { localStorage.setItem('peblo-guest-name', 'Pia'); localStorage.setItem('peblo-guest-tour', '1'); } catch {} });
  const g = await c.newPage(); await g.goto(`${base}/s/note/${tok}`); await ready(g);
  await g.screenshot({ path: out + 'share.png' });
  await g.locator('.bn-editor .bn-block-content').first().click();
  await g.getByTestId('present-btn').waitFor({ timeout: 20000 }).catch(() => {});
  await g.getByTestId('present-btn').click(); await g.getByTestId('present-options').click(); await wait(400);
  await g.screenshot({ path: out + 'present-start.png' });
  await g.getByTestId('present-go').click(); await wait(800);
  await g.screenshot({ path: out + 'present-dock.png' });
} catch (e) { console.log(e.message); }
await finish();

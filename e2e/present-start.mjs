// "Ready to present?": options left, stage preview right, 3 second start, Escape cancels.
import { boot } from './lib.mjs';
const { base, api, page, ctx, check, finish } = await boot();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 10000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await fn()) return true; } catch { /* retry */ } await wait(150); } return false; };
const ready = async (p) => { await p.locator('.bn-editor').waitFor({ timeout: 20000 }); await p.locator('[data-testid="collab-status"]').waitFor({ state: 'detached', timeout: 20000 }).catch(() => {}); };
try {
  const note = (await api('POST', '/api/notes', { title: 'Launch plan', content: '# Launch plan\n\nWe ship the redesign by Friday.\n\n## Scope\n\nFix share page', tags: [] })).note;
  const tok = (await api('POST', `/api/share/note/${note.id}`, { edit: true })).token;
  await page.goto(base + '/notes/' + note.id); await ready(page);
  const c = await ctx.browser().newContext({ viewport: { width: 1100, height: 800 } });
  const g = await c.newPage(); await g.goto(`${base}/s/note/${tok}`); await ready(g);
  await page.evaluate(() => localStorage.setItem('peblo-present-instant', '0'));
  await page.locator('[data-testid="present-btn"]').waitFor({ timeout: 15000 });
  await page.locator('[data-testid="present-btn"]').click();
  const dlg = page.locator('[data-testid="present-start"]');
  check('1 the window opens', await dlg.isVisible());
  check('2 asks Ready to present?', /Ready to present\?/.test(await dlg.innerText()));
  check('3 three ways: follow, tour, point', (await dlg.locator('.opt').count()) === 3);
  check('4 preview shows the note title and a heading', /Launch plan/.test(await page.locator('[data-testid="ps-frame"]').innerText()) && /Scope/.test(await page.locator('[data-testid="ps-frame"]').innerText()));
  check('5 full screen switch and 16:9 label', (await page.locator('[data-testid="opt-full"]').count()) === 1 && /16:9/.test(await dlg.innerText()));
  await page.locator('[data-testid="opt-full"]').uncheck({ force: true });
  await page.keyboard.press('Escape');
  check('6 Escape cancels', await until(async () => (await dlg.count()) === 0, 3000));
  await page.locator('[data-testid="present-btn"]').click();
  await page.locator('[data-testid="present-go"]').click();
  check('7 counting down shows the number', await until(async () => /Starting in/.test(await page.locator('[data-testid="present-go"]').innerText()), 2000));
  check('8 presenting starts after about 3 seconds', await until(async () => (await page.locator('[data-testid="present-btn"][aria-pressed="true"]').count()) === 1, 6000));
  check('9 the window closed', (await dlg.count()) === 0);
} catch (e) { check('crash: ' + e.message, false); }
await finish();

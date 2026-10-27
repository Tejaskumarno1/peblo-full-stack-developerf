// The Present dropdown: four ways to start, options at the foot.
import { boot } from './lib.mjs';
const { base, api, page, ctx, check, finish } = await boot();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 10000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await fn()) return true; } catch { /* retry */ } await wait(150); } return false; };
try {
  const note = (await api('POST', '/api/notes', { title: 'Menu', content: '# Menu\n\nHello', tags: [] })).note;
  const tok = (await api('POST', `/api/share/note/${note.id}`, { edit: true })).token;
  await page.goto(base + '/notes/' + note.id);
  const c = await ctx.browser().newContext({ viewport: { width: 1100, height: 800 } });
  const g = await c.newPage(); await g.goto(`${base}/s/note/${tok}`);
  await g.locator('.bn-editor').waitFor({ timeout: 20000 });
  await page.locator('[data-testid="present-btn"]').waitFor({ timeout: 20000 });
  await page.locator('[data-testid="present-btn"]').click();
  const m = page.getByTestId('present-menu');
  check('1 the menu opens', await m.isVisible());
  check('2 four ways', (await m.locator('.pm-row').count()) === 4);
  check('3 PowerPoint row is disabled', await page.getByTestId('pm-ppt').isDisabled());
  check('4 shows the shortcut', /Ctrl Shift P/.test(await m.innerText()));
  await page.getByTestId('pm-q').click();
  check('5 questions chip toggles', /Questions off/.test(await m.innerText()));
  await page.keyboard.press('Escape');
  check('6 Escape closes', (await page.getByTestId('present-menu').count()) === 0);
  await page.locator('[data-testid="present-btn"]').click();
  await page.getByTestId('present-options').click();
  check('7 Options opens the start window', await page.getByTestId('present-start').isVisible() && (await page.getByTestId('present-menu').count()) === 0);
  await page.getByTestId('present-cancel').click();
  await page.locator('[data-testid="present-btn"]').click();
  await page.getByTestId('pm-tour').click();
  check('8 Guided tour starts presenting', await until(async () => (await page.locator('[data-testid="present-btn"][aria-pressed="true"]').count()) === 1));
  check('9 the side rail is at the left', await until(async () => { const b = await page.getByTestId('presenting-banner').boundingBox(); return b && b.x < 60 && b.width < 90; }));
  await page.locator('[data-testid="present-btn"]').click();
  await page.keyboard.press('Control+Shift+P');
  check('10 Ctrl+Shift+P starts', await until(async () => (await page.locator('[data-testid="present-btn"][aria-pressed="true"]').count()) === 1));
} catch (e) { check('crash: ' + e.message, false); }
await finish();

// Preview as a viewer (role switch) and saving the recap as a note.
import { boot } from './lib.mjs';

const { base, api, page, ctx, check, finish } = await boot();
const until = async (fn, ms = 12000) => { const end = Date.now() + ms; while (Date.now() < end) { try { if (await fn()) return true; } catch { /* retry */ } await new Promise((r) => setTimeout(r, 200)); } return false; };
try {
  const note = (await api('POST', '/api/notes', { title: 'Preview note', content: '## One\n\nHello there.\n\nMore text.', tags: [] })).note;
  const tok = (await api('POST', `/api/share/note/${note.id}`, { edit: true, expiresInDays: 7 })).token;
  await page.addInitScript(() => { try { localStorage.setItem('peblo-guest-tour', '1'); } catch { /* ignore */ } });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`${base}/s/note/${tok}`);
  await page.locator('.bn-editor').waitFor({ timeout: 20000 });
  check('no role switch while editing', (await page.getByTestId('preview-roles').count()) === 0);
  await page.locator('.preview-btn').click();
  await page.getByTestId('preview-roles').waitFor({ timeout: 4000 });
  check('preview shows the editor gone', (await page.locator('.bn-editor').count()) === 0);
  check('the switch says View only', /View only/.test(await page.getByTestId('preview-roles').innerText()));
  await page.getByTestId('preview-as-edit').click();
  check('Can edit brings the editor back', await until(async () => (await page.locator('.bn-editor').count()) === 1));
  check('and the switch goes away', (await page.getByTestId('preview-roles').count()) === 0);

  // recap saved as a note (signed-in presenter)
  const c2 = await ctx.browser().newContext({ viewport: { width: 1100, height: 800 } });
  await c2.addInitScript(() => { try { localStorage.setItem('peblo-guest-tour', '1'); } catch { /* ignore */ } });
  const other = await c2.newPage();
  await other.goto(`${base}/s/note/${tok}`);
  await other.locator('.bn-editor').waitFor({ timeout: 20000 });
  if (await page.getByLabel('Your name').count()) { await page.getByLabel('Your name').fill('Tejas'); await page.getByLabel('Your name').press('Enter'); }
  await until(async () => (await page.getByTestId('present-btn').count()) === 1, 20000);
  await page.getByTestId('present-btn').click({ timeout: 8000 });
  await page.getByTestId('present-go').click();
  await page.getByTestId('presenting-banner').waitFor({ timeout: 8000 });
  await page.getByTestId('present-end').click();
  await page.getByTestId('recap').waitFor({ timeout: 6000 });
  await page.getByTestId('recap-save').click();
  check('the button says it was saved', await until(async () => /Saved to your notes/.test(await page.getByTestId('recap-save').innerText())));
  const list = await api('GET', '/api/notes');
  const arr = list.notes || list;
  check('a recap note exists', arr.some((n) => /^Session recap/.test(n.title)), JSON.stringify(arr.map((n) => n.title)));
  await page.screenshot({ path: 'C:/Users/tejas/peblo-e2e/extras4-recap.png' });
} catch (e) { check('extras4 ran without error', false, String(e)); }
await finish();

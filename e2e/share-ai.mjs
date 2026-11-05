// Share with AI panel: text, PDF and MCP addresses and a copy-as-prompt button on the share dialog.
import { boot } from './lib.mjs';
const { base, api, page, ctx, check, finish } = await boot();
await ctx.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
try {
  const note = (await api('POST', '/api/notes', { title: 'AI share', content: 'Hello bots', tags: [] })).note;
  await page.goto(base + '/notes/' + note.id);
  await page.locator('.s-note-row', { hasText: 'AI share' }).first().waitFor({ timeout: 15000 });
  await page.getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitem', { name: /Share link/ }).click();
  const dlg = page.getByRole('dialog', { name: /Share this note/ });
  await dlg.waitFor({ timeout: 5000 });
  await dlg.getByRole('button', { name: /Create link/ }).click();
  const url = await dlg.getByLabel('Share link').inputValue();
  const ai = dlg.locator('.s-share-ai');
  await ai.waitFor({ timeout: 5000 });
  check('markdown address', (await dlg.getByLabel('Text (markdown)').inputValue()) === url + '.md');
  check('PDF address', (await dlg.getByLabel('PDF with pictures').inputValue()) === url + '.pdf');
  check('MCP address', /\/mcp$/.test(await dlg.getByLabel('MCP address').inputValue()));
  await dlg.getByRole('button', { name: /Copy as AI prompt/ }).click();
  await page.waitForTimeout(400);
  const clip = await page.evaluate(() => navigator.clipboard.readText()).catch(() => '');
  check('prompt has md, pdf and read_shared_link', clip.includes(url + '.md') && clip.includes(url + '.pdf') && clip.includes('read_shared_link'), clip.slice(0, 120));
  const box = await dlg.boundingBox(); const vp = page.viewportSize();
  check('dialog fits on screen', !!box && box.y >= 0 && box.y + box.height <= vp.height, JSON.stringify(box));
  await page.screenshot({ path: 'D:\\Peblo\\_shots\\share-ai.png' });
} finally { await finish(); }

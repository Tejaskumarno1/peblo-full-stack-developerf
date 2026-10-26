import { boot } from './lib.mjs';
const { base, api, page, ctx, finish } = await boot();
try {
  for (const t of ['Alpha', 'Beta', 'Gamma']) await api('POST', '/api/notes', { title: t, content: `${t} text`, tags: ['x'] });
  await page.goto(base + '/notes'); await page.locator('.s-note-row').first().waitFor();
  await page.screenshot({ path: 'tmp-np-wide.png' });
  await page.getByRole('button', { name: 'New folder' }).click(); await page.waitForTimeout(300);
  await page.screenshot({ path: 'tmp-np-newfolder.png' });
  await page.getByRole('radio', { name: 'Smart folder' }).click(); await page.waitForTimeout(300);
  await page.locator('.s-notes-list').screenshot({ path: 'tmp-np-smart.png' });
  await page.setViewportSize({ width: 390, height: 800 }); await page.goto(base + '/notes'); await page.waitForTimeout(1200);
  await page.screenshot({ path: 'tmp-np-mobile.png' });
} catch (e) { console.log(e.message); }
await finish();

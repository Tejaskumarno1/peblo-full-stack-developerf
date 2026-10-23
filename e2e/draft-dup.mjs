import { boot } from './lib.mjs';
const { base, api, page, check, finish } = await boot();
try {
  // Slow network: every create takes 4 s, longer than the 1.5 s autosave delay
  let posts = 0;
  await page.route('**/api/notes', async (route) => {
    if (route.request().method() === 'POST') { posts++; await new Promise((r) => setTimeout(r, 4000)); }
    await route.continue();
  });
  await page.goto(base + '/notes');
  await page.getByLabel('New note', { exact: true }).first().click();
  const title = page.getByPlaceholder('Untitled note');
  await title.waitFor({ timeout: 15000 });
  await title.click();
  // keep typing across several autosave windows
  for (const ch of 'Slow network note title that keeps going') { await page.keyboard.type(ch); await page.waitForTimeout(220); }
  await page.waitForTimeout(9000);
  const list = (await api('GET', '/api/notes')).notes || [];
  const mine = list.filter((n) => (n.title || '').startsWith('Slow network'));
  check('slow create does not produce duplicate notes', mine.length === 1, `notes=${mine.length} posts=${posts}`);
  check('typed text fully saved on the one note', mine[0] && mine[0].title === 'Slow network note title that keeps going', mine[0] && mine[0].title);
} catch (e) { console.error(e); process.exitCode = 1; }
await finish();

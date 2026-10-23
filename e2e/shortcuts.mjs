import { boot } from './lib.mjs';
const { base, api, page, check, finish } = await boot();
try {
  await api('POST', '/api/notes', { title: 'Shortcut note', content: 'x' });
  await page.goto(base + '/notes');
  await page.locator('.nl-row', { hasText: 'Shortcut note' }).first().waitFor({ timeout: 15000 });
  const palette = page.getByPlaceholder('Search notes or type a command...');

  // PEB-78: Ctrl+K opens the command palette on the Notes screen
  await page.keyboard.press('Control+k');
  await page.waitForTimeout(500);
  check('Ctrl+K opens the command palette on Notes', await palette.isVisible().catch(() => false));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  // PEB-78: Ctrl+Shift+S must not trigger the Ctrl+S save handler
  let saved = 0;
  await page.route('**/api/notes/**', (route) => { if (route.request().method() === 'PATCH') saved++; route.continue(); });
  await page.locator('.nl-row', { hasText: 'Shortcut note' }).first().click();
  await page.waitForTimeout(800);
  await page.keyboard.press('Control+Shift+s');
  await page.waitForTimeout(800);
  check('Ctrl+Shift+S does not fire the Ctrl+S save', saved === 0, `patches=${saved}`);

  // Ctrl+N still makes a new note; Ctrl+Alt+N too (the tooltip says so)
  await page.keyboard.press('Control+n');
  await page.waitForTimeout(2000);
  const tv = await page.getByPlaceholder('Untitled note').inputValue().catch((e) => 'ERR ' + e.message.slice(0,80));
  check('Ctrl+N starts a new note', tv === '', JSON.stringify(tv) + ' url=' + page.url());
} catch (e) { console.error(e); process.exitCode = 1; }
await finish();

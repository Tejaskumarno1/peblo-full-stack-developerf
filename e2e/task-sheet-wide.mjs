import { boot } from './lib.mjs';
const { base, api, page, check, finish } = await boot();
try {
  await page.setViewportSize({ width: 1440, height: 900 });
  await api('POST', '/api/todos', { text: 'Write the spec', priority: 'high', deadline: new Date(Date.now() + 864e5).toISOString() });
  await page.goto(base + '/tasks');
  await page.locator('.s-card-open', { hasText: 'Write the spec' }).first().click();
  await page.locator('.s-sheet.wide').waitFor({ timeout: 8000 });
  const cols = await page.locator('.s-sheet-col').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().x));
  check('two columns side by side', cols.length === 2 && cols[1] > cols[0] + 300, cols.join());
  check('sheet fits the window without scrolling', await page.evaluate(() => { const s = document.querySelector('.s-sheet'); return s.scrollHeight <= s.clientHeight + 2; }));
  await page.screenshot({ path: 'D:/Peblo/_shots/sheet-wide.png' });
  await page.getByRole('button', { name: 'Pick a date' }).click();
  await page.locator('.s-mcal-day').first().waitFor({ timeout: 4000 });
  const sq = await page.locator('.s-mcal-day').evaluateAll((els) => els.every((e) => { const r = e.getBoundingClientRect(); return Math.abs(r.width - r.height) < 1.5; }));
  check('date picker days are true circles (square boxes)', sq);
  await page.screenshot({ path: 'D:/Peblo/_shots/sheet-picker.png' });
  await page.getByRole('button', { name: 'Pick a date' }).click().catch(() => {});
  await page.fill('#s-sheet-title', 'Write the spec v2');
  await page.keyboard.press('Control+Enter');
  await page.locator('.s-sheet').waitFor({ state: 'detached', timeout: 5000 });
  const r = await api('GET', '/api/todos');
  check('Ctrl+Enter saves', (r.todos || r).some((x) => x.text === 'Write the spec v2'));
} catch (e) { check('no crash', false, String(e).slice(0, 300)); }
await finish();

// Notes v3: Date and Tag groups show as folder cards (default), open like a folder, and Settings switches the layout.
import { boot } from './lib.mjs';
const b = await boot({ noteLayout: 'cards' });
const { page } = b; const ok = (c, m) => b.check(m, !!c);
try {
  for (const [t, tags] of [['Alpha note', ['work']], ['Beta note', ['work']], ['Gamma note', ['home']]]) {
    await b.api('POST', '/api/notes', { title: t, content: '', tags });
  }
  await page.goto(`${b.base}/notes`); await page.waitForTimeout(1500);
  ok(await page.locator('.np-card.gcard').count() >= 1, 'date groups render as folder cards');
  ok(await page.locator('.s-notes-rows').count() === 0 && await page.locator('.np-recent .s-note-row').count() >= 1 && await page.locator('.np-recent .s-note-row').count() <= 3, 'only the Recent strip lists notes until a card is opened');
  await page.screenshot({ path: 'D:/Peblo/_shots/v3-date.png' });
  await page.locator('.np-card.gcard').first().click();
  ok(await page.locator('.np-fhead small', { hasText: 'Date' }).count() === 1, 'opened card shows slim header with Date label');
  ok(await page.locator('.s-note-row').count() >= 1, 'notes list for the opened card');
  await page.screenshot({ path: 'D:/Peblo/_shots/v3-open.png' });
  await page.getByRole('button', { name: /Back to dates/ }).click();
  ok(await page.locator('.np-card.gcard').count() >= 1, 'back returns to cards');
  await page.getByRole('button', { name: /View options/ }).click();
  await page.getByRole('radio', { name: 'Tag', exact: true }).click();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  ok(await page.locator('.np-card.gcard', { hasText: '#work' }).count() === 1, 'tag groups render as cards with counts');
  await page.screenshot({ path: 'D:/Peblo/_shots/v3-tag.png' });
  await page.goto(`${b.base}/settings/notes`); await page.waitForTimeout(1000);
  ok(await page.getByRole('button', { name: /Folder cards/ }).getAttribute('aria-pressed') === 'true', 'Folder cards is the default layout');
  await page.getByRole('button', { name: /Folded sections/ }).click();
  await page.screenshot({ path: 'D:/Peblo/_shots/v3-settings.png' });
  await page.goto(`${b.base}/notes`); await page.waitForTimeout(1200);
  ok(await page.locator('.np-card.gcard').count() === 0 && await page.locator('.s-grp-toggle').count() >= 1, 'Folded sections layout shows containers');
} catch (e) { b.check('no error: ' + e.message, false); }
await b.finish();

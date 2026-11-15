// Four fixes: the row colour menu opens again for another row, your own second window is not drawn as a cursor,
// "Open in new tab" in the table menu, and a profile picture is never drawn at full size.
import { boot } from './lib.mjs';
const { base, api, page, ctx, check, finish } = await boot();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 8000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await wait(150); } return false; };
const md = '# Tables\n\n| A | B | C |\n| --- | --- | --- |\n| 1 | 2 | 3 |\n| 4 | 5 | 6 |\n| 7 | 8 | 9 |\n\nAfter.\n';
try {
  const n = (await api('POST', '/api/notes', { title: 'Fix four', content: md, tags: [] })).note;
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(base + '/notes/' + n.id);
  await page.locator('.bn-editor table').first().waitFor({ timeout: 20000 });
  await wait(1200);
  const rows = page.locator('.bn-editor table tr');
  const grips = page.locator('.bn-table-handle');
  const menu = page.locator('[data-testid="table-menu"]');
  const open = async (r) => { await rows.nth(r).locator('td, th').nth(1).hover(); await until(async () => (await grips.count()) >= 1); await grips.first().click(); await menu.waitFor({ timeout: 6000 }).catch(() => {}); };

  // 1 colour a row, then open the menu for a different row
  await open(2);
  const title = await menu.locator('.pbt-h b').innerText().catch(() => '');
  if (/Row/.test(title)) {
    await menu.locator('[data-testid="pbc-bg-green"]').click(); await wait(500);
    await page.keyboard.press('Escape'); await wait(300);
    await page.mouse.click(5, 5); await wait(300);
    await open(3);
    check('1 the menu opens for another row after a fill', await menu.isVisible(), title);
    await menu.locator('[data-testid="pbc-bg-blue"]').click().catch(() => {});
    check('1b and that row takes its colour', await until(async () => (await rows.nth(3).locator('td[data-background-color="blue"]').count()) >= 1));
  } else check('1 expected the row grip first', false, title);
  await page.keyboard.press('Escape'); await page.mouse.click(5, 5); await wait(300);

  // 3 Open in new tab in the table menu
  await rows.nth(1).locator('td').nth(1).click({ button: 'right' }); await wait(300);
  const item = page.locator('[data-testid="cm-open-tab"]');
  check('3 the table menu has Open in new tab', await item.isVisible());
  const [popup] = await Promise.all([ctx.waitForEvent('page', { timeout: 8000 }).catch(() => null), item.click()]);
  check('3b it opens this note in a new tab', !!popup && popup.url().includes('/notes/' + n.id), popup ? popup.url() : 'no tab');
  if (popup) await popup.close();

  // 2 a second window of you is not drawn as a cursor
  const b = await ctx.newPage();
  await b.setViewportSize({ width: 1200, height: 800 });
  await b.goto(base + '/notes/' + n.id);
  await b.locator('.bn-editor').waitFor({ timeout: 20000 });
  await wait(1500);
  await page.locator('.bn-editor p', { hasText: 'After.' }).first().click(); await page.keyboard.press('End'); await page.keyboard.type(' typing'); await wait(1500);
  const seen = await b.evaluate(() => ({ carets: [...document.querySelectorAll('.bn-collaboration-cursor__caret')].filter((e) => e.offsetParent !== null && e.getBoundingClientRect().width > 0).length, labels: [...document.querySelectorAll('.bn-collaboration-cursor__label')].filter((e) => e.offsetParent !== null).length }));
  check('2 your own other window shows no cursor or label', seen.carets === 0 && seen.labels === 0, JSON.stringify(seen));
  await b.close();

  // 4 the picture rule is in the main styles, so a picture can never draw at full size
  const fit = await page.evaluate(() => { const i = document.createElement('img'); i.className = 'pb-avatar-img'; i.src = 'data:image/gif;base64,R0lGODlhAQABAAAAACw='; document.body.appendChild(i); const s = getComputedStyle(i); const r = { fit: s.objectFit, w: s.width }; i.remove(); return r; });
  check('4 the picture size rule is loaded with the app', fit.fit === 'cover', JSON.stringify(fit));
} catch (e) { check('crash: ' + e.message, false); }
await finish();

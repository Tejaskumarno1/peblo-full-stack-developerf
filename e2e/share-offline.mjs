// Offline notice with Retry (S43), and the owner's password and summary controls in the Share panel (S27, S01).
import { boot } from './lib.mjs';
const { base, api, page, ctx, check, finish } = await boot();
const until = async (fn, ms = 30000) => { const end = Date.now() + ms; while (Date.now() < end) { try { if (await fn()) return true; } catch { /* retry */ } await new Promise((r) => setTimeout(r, 300)); } return false; };
try {
  const note = (await api('POST', '/api/notes', { title: 'Offline note', content: '## One\n\nSome words here.', tags: [] })).note;
  const tok = (await api('POST', `/api/share/note/${note.id}`, { edit: true })).token;

  // owner opens their own link: Share panel has the password and summary rows
  await page.goto(`${base}/s/note/${tok}`);
  await page.locator('[data-testid="join-anon"]').click({ timeout: 4000 }).catch(() => {});
  await page.locator('[data-testid="share-btn"]').click({ timeout: 20000 });
  check('1 the owner sees the password and summary rows', await page.locator('[data-testid="sp-password-toggle"]').isVisible() && await page.locator('[data-testid="sp-summary-toggle"]').isVisible());
  await page.locator('[data-testid="sp-password-toggle"]').click();
  await page.locator('[data-testid="sp-password"]').fill('abcd1234');
  await page.locator('[data-testid="sp-password-save"]').click();
  check('2 saving a password turns it on', await until(async () => /On/.test(await page.locator('[data-testid="sp-password-toggle"]').innerText()), 8000));
  await page.locator('[data-testid="sp-password-toggle"]').click();
  await page.locator('[data-testid="sp-password-clear"]').click();
  check('3 removing it turns it off', await until(async () => /Off/.test(await page.locator('[data-testid="sp-password-toggle"]').innerText()), 8000));
  await page.locator('[data-testid="sp-summary-toggle"]').click();
  await page.locator('[data-testid="sp-summary"]').fill('A short note for readers.');
  await page.locator('[data-testid="sp-summary-save"]').click();
  check('4 the summary shows on the page', await page.locator('[data-testid="page-summary"]').waitFor({ timeout: 8000 }).then(() => true).catch(() => false));

  // a second person goes offline: notice and Retry in the people panel
  const g = await (await ctx.browser().newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  const gctx = g.context();
  await g.goto(`${base}/s/note/${tok}`);
  await g.locator('[data-testid="join-anon"]').click({ timeout: 4000 }).catch(() => {});
  await g.locator('article .doc, .bn-editor').first().waitFor({ timeout: 20000 });
  await g.waitForTimeout(2500);
  await gctx.setOffline(true);
  const got = await until(async () => (await g.locator('[data-testid="live-editors"]').count()) > 0 && /Reconnecting|Offline/i.test(await g.locator('[data-testid="live-editors"]').innerText()), 40000);
  check('5 going offline shows in the bar', got);
  if (got) {
    await g.locator('body').click({ position: { x: 4, y: 400 } }).catch(() => {}); await g.keyboard.press(']');
    await g.waitForTimeout(800);
    check('6 the panel says offline with Retry', await g.locator('[data-testid="offline-banner"]').isVisible() && await g.locator('[data-testid="offline-retry"]').isVisible());
    await gctx.setOffline(false);
    await g.locator('[data-testid="offline-retry"]').click();
    check('7 Retry brings the page back', await g.locator('article .doc, .bn-editor').first().waitFor({ timeout: 15000 }).then(() => true).catch(() => false));
  }
} catch (e) { check('run ' + e.message, false); }
await finish();

// Share links: named guests, where people are in the text, the link's activity list, and end-date reminders.
import { boot } from './lib.mjs';

const { base, api, page, ctx, check, finish } = await boot();
const SHOTS = 'C:/Users/tejas/peblo-e2e';
// does the coloured mark for `who` sit on the block that contains `text`?
const onBlock = (pg, who, text) => pg.evaluate(([m, tx]) => {
  const el = document.querySelector(`.pb-peer[data-peer-name="${m}"]`);
  const blk = [...document.querySelectorAll('.bn-editor .bn-block-group > .bn-block-outer')].find((b) => b.textContent.includes(tx));
  if (!el || !blk) return 'missing ' + (el ? 'block' : 'mark');
  return Math.abs(el.getBoundingClientRect().top - blk.getBoundingClientRect().top) < 4 ? 'ok' : 'wrong block';
}, [who, text]);

try {
  const note = (await api('POST', '/api/notes', { title: 'Extras note', content: 'First paragraph\n\nSecond paragraph\n\nThird paragraph', tags: [] })).note;
  const tok = (await api('POST', `/api/share/note/${note.id}`, { edit: true, expiresInDays: 1 })).token;

  await page.addInitScript(() => { try { localStorage.setItem('peblo-style', 'studio'); localStorage.setItem('peblo-debug', '1'); } catch { /* ignore */ } });
  await page.goto(`${base}/notes/${note.id}`);
  await page.locator('.bn-editor').waitFor({ timeout: 15000 });

  // 1. end-date reminder shows on the owner's note even before anyone opens the link
  const chip = page.getByTestId('live-editors');
  await chip.waitFor({ timeout: 8000 });
  const t1 = await chip.innerText();
  check('owner is reminded the link ends soon', /ends in/.test(t1), t1);
  await page.screenshot({ path: `${SHOTS}/extras-1-expiry-reminder.png` });

  // 2. a guest gives a name; the link's end date is visible to them
  const gctx = await ctx.browser().newContext({ viewport: { width: 1280, height: 800 } });
  await gctx.addInitScript(() => { try { localStorage.setItem('peblo-debug', '1'); } catch { /* ignore */ } });
  const g = await gctx.newPage();
  await g.goto(`${base}/s/note/${tok}`);
  await g.locator('.bn-editor').waitFor({ timeout: 15000 });
  check('guest sees when the link ends', (await g.getByTestId('link-expiry').count()) === 1);
  await g.getByLabel('Your name').fill('Priya');
  await g.getByLabel('Your name').press('Enter');

  // 3. the guest works in paragraph 2 and types
  const second = g.locator('.bn-editor .bn-block-outer', { hasText: 'Second paragraph' }).first();
  await second.click(); await g.keyboard.press('End');
  const end = Date.now() + 5500; let i = 0;
  const typing = (async () => { while (Date.now() < end) { await g.keyboard.type('xyz'[i++ % 3]); await g.waitForTimeout(170); } })();
  await page.getByText('Priya is typing').first().waitFor({ timeout: 9000 });
  check('owner sees the guest by name', true);
  await typing;
  await g.waitForTimeout(500);

  // 4. the guest's block is marked in the owner's text
  await page.waitForSelector('.pb-peer[data-peer-name="Priya"]', { timeout: 8000 });
  const r4 = await onBlock(page, 'Priya', 'Second paragraph');
  check("guest's paragraph is marked on the owner's page", r4 === 'ok', r4);
  await page.screenshot({ path: `${SHOTS}/extras-2-owner-sees-cursor.png` });

  // 5. the owner works in paragraph 1 -> the guest sees the owner's marker
  await page.locator('.bn-editor .bn-block-outer', { hasText: 'First paragraph' }).first().click();
  await g.waitForSelector('.pb-peer', { timeout: 9000 });
  const ownerName = await g.locator('.pb-peer').first().getAttribute('data-peer-name');
  const r5 = await onBlock(g, ownerName, 'First paragraph');
  check("owner's paragraph is marked on the guest's page", r5 === 'ok', `${ownerName}: ${r5}`);
  await g.screenshot({ path: `${SHOTS}/extras-3-guest-sees-owner-cursor.png` });

  // 6. the panel: who is here, where, and what happened
  await page.waitForTimeout(4000);
  await chip.click();
  const panel = page.getByTestId('live-panel');
  await panel.waitFor({ timeout: 5000 });
  const pt = await panel.innerText();
  check('panel names the guest and the paragraph', /Priya/.test(pt) && /paragraph 2/.test(pt), pt.slice(0, 300));
  await page.screenshot({ path: `${SHOTS}/extras-4-panel.png` });
  await panel.getByRole('tab', { name: 'Activity' }).click();
  await page.getByTestId('live-activity').locator('li').first().waitFor({ timeout: 8000 });
  const log = await page.getByTestId('live-activity').innerText();
  check('activity lists the guest opening and editing', /opened the note/.test(log) && /Priya\s+edited/.test(log), log);
  await panel.getByRole('tab', { name: 'Viewers' }).click();

  // 7. extend the link from the panel
  await panel.getByRole('button', { name: '+7 days' }).click();
  await page.waitForFunction(() => /in [67] days/.test(document.querySelector('[data-testid="live-expiry"]')?.textContent || ''), null, { timeout: 6000 });
  check('+7 days extends the link', true, await page.getByTestId('live-expiry').innerText());
  const ex = (await api('GET', `/api/share/note/${note.id}`)).expiresAt;
  check('the new end date is saved', ex && new Date(ex).getTime() - Date.now() > 6 * 86400000, String(ex));
  await gctx.close();
} catch (e) {
  check('share-extras ran', false, e && e.stack ? e.stack : String(e));
} finally {
  await finish();
}

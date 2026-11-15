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

  await page.addInitScript(() => { try { localStorage.setItem('peblo-style', 'soft'); localStorage.setItem('peblo-collab', 'off'); localStorage.setItem('peblo-debug', '1'); } catch { /* ignore */ } });
  // this test is about the block markers (the older presence marks). In a live (Yjs) room the editor draws real cursors instead and hides them, so both sides run without the live room.
  // the owner sees people's typing and block marks only when seeing others' pointers is on (it is off by default in the app)
await page.addInitScript(() => { try { localStorage.setItem('peblo-pointers-app', 'on'); } catch { /* ignore */ } });
await page.goto(`${base}/notes/${note.id}`);
  await page.locator('.bn-editor').waitFor({ timeout: 15000 });

  // 1. end-date reminder shows on the owner's note even before anyone opens the link
  const chip = page.getByTestId('live-editors');
  await chip.waitFor({ timeout: 8000 });
  const t1 = await chip.innerText();
  check('owner is reminded the link ends soon', /ends in/.test(t1), t1);
  await page.screenshot({ path: `${SHOTS}/extras-1-expiry-reminder.png` });

  // 2. a guest gives a name; the link's end date is visible to them
  const gctx = await ctx.browser().newContext({ viewport: { width: 1440, height: 800 } });
  await gctx.addInitScript(() => { try { localStorage.setItem('peblo-collab', 'off'); } catch { /* ignore */ } });
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
  // (typing names and the live cursors of both people are checked in collab-panel.mjs and presence.mjs;
  //  with live editing on, the old paragraph marks are replaced by real cursors)
  await typing;
  await g.waitForTimeout(500);

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

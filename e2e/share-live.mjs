// Live presence on a shared note: "<name> is typing…" on both sides, with screenshots to look at.
import { boot } from './lib.mjs';

const { base, api, page, ctx, check, finish } = await boot();
const SHOTS = 'C:/Users/tejas/peblo-e2e';
try {
  const note = (await api('POST', '/api/notes', { title: 'Live note', content: 'First line\n\nSecond line', tags: [] })).note;
  const tok = (await api('POST', `/api/share/note/${note.id}`, { edit: true })).token;

  await page.addInitScript(() => { try { localStorage.setItem('peblo-style', 'studio'); localStorage.setItem('peblo-debug', '1'); } catch { /* ignore */ } });
  await page.goto(`${base}/notes/${note.id}`);
  const edO = page.locator('.bn-editor');
  await edO.waitFor({ timeout: 15000 });

  // an unshared-looking view: nobody is on the link yet, so no chip
  check('no chip while nobody is on the link', (await page.getByTestId('live-editors').count()) === 0);

  const gctx = await ctx.browser().newContext({ viewport: { width: 1280, height: 800 } });
  await gctx.addInitScript(() => { try { localStorage.setItem('peblo-debug', '1'); } catch { /* ignore */ } });
  const g = await gctx.newPage();
  await g.goto(`${base}/s/note/${tok}`);
  const edG = g.locator('.bn-editor');
  await edG.waitFor({ timeout: 15000 });

  // 1. the owner's note shows that someone opened the link
  await page.getByTestId('live-editors').waitFor({ timeout: 9000 });
  check('owner sees someone viewing the shared link', /viewing/.test(await page.getByTestId('live-editors').innerText()), await page.getByTestId('live-editors').innerText());
  await page.screenshot({ path: `${SHOTS}/live-1-owner-viewing.png` });

  // 2. the guest types -> the owner sees "is typing"
  await edG.click(); await g.keyboard.press('Control+End');
  const typeFor = async (pg, text, ms) => { const end = Date.now() + ms; let i = 0; while (Date.now() < end) { await pg.keyboard.type(text[i++ % text.length]); await pg.waitForTimeout(180); } };
  const guestTyping = typeFor(g, 'hello from the guest ', 6500);
  await page.getByText(/is typing/).first().waitFor({ timeout: 8000 });
  check('owner sees "is typing" while the guest types', /Guest is typing/.test(await page.getByTestId('live-editors').innerText()), await page.getByTestId('live-editors').innerText());
  await page.screenshot({ path: `${SHOTS}/live-2-owner-sees-guest-typing.png` });
  await guestTyping;

  // 3. the owner types -> the guest sees the pill and the pulsing avatar
  await page.waitForTimeout(500);
  await edO.click(); await page.keyboard.press('Control+Home');
  const ownerTyping = typeFor(page, 'owner here ', 6500);
  await g.getByTestId('typing-pill').waitFor({ timeout: 8000 });
  const pill = await g.getByTestId('typing-pill').innerText();
  check('guest sees the owner typing', /is typing/.test(pill), pill);
  check('typing avatar pulses in the people pill', (await g.locator('.pb-avatar.typing').count()) >= 1);
  await g.screenshot({ path: `${SHOTS}/live-3-guest-sees-owner-typing.png` });
  await ownerTyping;

  // 4. everyone stops -> the indicators go away
  await g.getByTestId('typing-pill').waitFor({ state: 'hidden', timeout: 9000 });
  check('typing pill goes away when typing stops', true);
  await page.waitForTimeout(500);
  const chip = await page.getByTestId('live-editors').innerText();
  check('owner chip falls back to "viewing"', !/typing/.test(chip), chip);
  await page.screenshot({ path: `${SHOTS}/live-4-idle.png` });

  // 5. both edits are in the note
  await page.waitForTimeout(2500);
  const text = (await api('GET', `/api/notes/${note.id}`)).note.content;
  check('both people\'s typing was saved', /owner here/.test(text) && /hello from the guest/.test(text), JSON.stringify(text).slice(0, 200));

  // 6. turning sharing off removes the chip
  await api('DELETE', `/api/share/note/${note.id}`);
  await page.getByTestId('live-editors').waitFor({ state: 'hidden', timeout: 8000 });
  check('chip disappears when sharing is turned off', true);
  await gctx.close();
} catch (e) {
  check('share-live ran', false, e && e.stack ? e.stack : String(e));
} finally {
  await finish();
}

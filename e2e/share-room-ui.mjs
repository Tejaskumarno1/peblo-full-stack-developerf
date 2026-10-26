// Waiting room and roles through the real screens: owner panel and guest page.
import { boot } from './lib.mjs';

const { base, api, page, ctx, check, finish } = await boot();
const SHOTS = 'C:/Users/tejas/peblo-e2e';
const until = async (fn, ms = 12000) => { const end = Date.now() + ms; while (Date.now() < end) { try { if (await fn()) return true; } catch { /* retry */ } await new Promise((r) => setTimeout(r, 200)); } return false; };
try {
  const note = (await api('POST', '/api/notes', { title: 'Room note', content: '# Room\n\nFirst line\n\nSecond line', tags: [] })).note;
  const tok = (await api('POST', `/api/share/note/${note.id}`, { edit: true })).token;
  await page.addInitScript(() => { try { localStorage.setItem('peblo-style', 'soft'); localStorage.setItem('peblo-collab-tip', '1'); localStorage.setItem('peblo-guest-tour', '1'); } catch { /* ignore */ } });
  await page.setViewportSize({ width: 1440, height: 860 });
  await page.goto(`${base}/notes/${note.id}`);
  await page.locator('.bn-editor').waitFor({ timeout: 15000 });
  await page.getByTestId('share-chips').getByRole('button', { name: /live collaboration/i }).click();
  const panel = page.getByTestId('live-panel');
  await panel.waitFor({ timeout: 5000 });
  const toggle = page.getByTestId('approval-toggle');
  check('the panel offers to let people in one by one', await toggle.isVisible() && !(await toggle.isChecked()));
  await toggle.check();
  check('turning it on sticks', await until(async () => (await api('GET', `/api/share/note/${note.id}/live`)).approval === true));

  // a guest arrives and waits
  const gctx = await ctx.browser().newContext({ viewport: { width: 1280, height: 800 } });
  await gctx.addInitScript(() => { try { localStorage.setItem('peblo-guest-tour', '1'); } catch { /* ignore */ } });
  const g = await gctx.newPage();
  await g.goto(`${base}/s/note/${tok}`);
  await g.getByTestId('waiting-room').waitFor({ timeout: 10000 });
  check('the guest sees the waiting room, not the note', (await g.locator('article .doc').count()) === 0 && /Waiting to be let in/.test(await g.getByTestId('waiting-room').innerText()));
  await g.getByTestId('wait-name').fill('Meera');
  await g.screenshot({ path: `${SHOTS}/room-1-guest-waits.png` });

  // the owner sees them
  await page.getByTestId('waiting-list').waitFor({ timeout: 12000 });
  check('the owner sees the name at the door', await until(async () => /Meera/.test(await page.getByTestId('waiting-list').innerText())));
  check('the bar says someone is waiting', /waiting to join/.test(await page.getByTestId('live-editors').innerText()) || (await page.locator('.cp-toast', { hasText: 'asking to join' }).count()) > 0);
  await page.screenshot({ path: `${SHOTS}/room-2-owner-sees.png` });
  await page.getByTestId('admit').click();
  await g.locator('article .doc, .bn-editor').first().waitFor({ timeout: 15000 });
  check('the guest page opens by itself', await until(async () => /First line/.test(await g.locator('article').innerText())));
  check('the guest can edit (link default)', await g.locator('.bn-editor').count() === 1);
  check('the waiting list clears', await until(async () => (await page.getByTestId('waiting-row').count()) === 0));
  await g.screenshot({ path: `${SHOTS}/room-3-guest-in.png` });

  // roles
  const roleCalls = [];
  page.on('response', async (r) => { if (/\/role$/.test(r.url())) roleCalls.push(`${r.status()} ${r.request().postData()}`); });
  await page.getByRole('button', { name: /Options for Meera/ }).waitFor({ timeout: 12000 });
  await page.getByRole('button', { name: /Options for Meera/ }).click();
  await page.getByTestId('role-view').click();
  check('the owner sees a role badge', await until(async () => /Can view/.test(await page.getByTestId('role-badge').innerText())));
  check('the guest page turns view only', await until(async () => (await g.locator('.bn-editor').count()) === 0 && /Can view/.test(await g.locator('.pill').first().innerText()), 15000));
  await page.screenshot({ path: `${SHOTS}/room-4-role.png` });
  await page.getByRole('button', { name: /Options for Meera/ }).click();
  await page.getByTestId('role-default').click();
  const back = await until(async () => (await g.locator('.bn-editor').count()) === 1, 20000);
  if (!back) { await g.screenshot({ path: `${SHOTS}/room-x-debug.png` }); await page.screenshot({ path: `${SHOTS}/room-x-owner.png` }); }
  const dbg = back ? '' : `calls=${JSON.stringify(roleCalls)} art=${(await g.locator('article').innerText().catch(() => '?')).slice(0, 160).replace(/\n/g, '|')} editors=${await g.locator('.bn-editor, .bn-container, [data-testid="share-editor"]').count()} pill=${await g.locator('.pill').first().innerText().catch(() => '?')} badge=${await page.getByTestId('role-badge').count()} live=${JSON.stringify((await api('GET', `/api/share/note/${note.id}/live`)).viewers.map((v) => [v.name, v.canEdit, v.custom]))}`;
  check('using the link setting gives editing back', back, dbg);

  // a second guest is declined
  const g2 = await (await ctx.browser().newContext({ viewport: { width: 390, height: 780 } })).newPage();
  await g2.goto(`${base}/s/note/${tok}`);
  await g2.getByTestId('waiting-room').waitFor({ timeout: 10000 });
  await page.getByTestId('decline').waitFor({ timeout: 12000 });
  await page.getByTestId('decline').click();
  check('a declined guest is told so', await until(async () => /did not let you in/.test(await g2.getByTestId('waiting-room').innerText())));
  await g2.screenshot({ path: `${SHOTS}/room-5-declined-phone.png` });

  // turn it off: new people walk in
  await toggle.uncheck();
  const g3 = await (await ctx.browser().newContext()).newPage();
  await g3.goto(`${base}/s/note/${tok}`);
  await g3.locator('article').waitFor({ timeout: 15000 });
  check('with approval off, people walk in', (await g3.getByTestId('waiting-room').count()) === 0);
} catch (e) { check('room test ran without error', false, String(e)); }
await finish();

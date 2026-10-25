// Presence: avatars, typing and away states, selection highlight, follow mode, "edited by", and the live dot in the notes list.
import { boot } from './lib.mjs';

const { base, api, page, ctx, check, finish } = await boot();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await fn()) return true; } catch { /* retry */ } await wait(150); } return false; };
const focusEmu = async (p) => { const c = await p.context().newCDPSession(p); await c.send('Emulation.setFocusEmulationEnabled', { enabled: true }); };
const ready = async (p) => { await p.locator('.bn-editor').waitFor({ timeout: 20000 }); await p.locator('[data-testid="collab-status"]').waitFor({ state: 'detached', timeout: 20000 }); await wait(500); };
const paras = Array.from({ length: 40 }, (_, i) => `Paragraph number ${i + 1} of the long note`).join('\n\n');

try {
  const note = (await api('POST', '/api/notes', { title: 'Presence', content: paras, tags: [] })).note;
  const tok = (await api('POST', `/api/share/note/${note.id}`, { edit: true })).token;
  await page.addInitScript(() => { try { localStorage.setItem('peblo-idle-ms', '2500'); } catch { /* ignore */ } });
  await focusEmu(page);
  await page.goto(base + '/notes/' + note.id);
  await ready(page);
  const guestCtx = await ctx.browser().newContext({ viewport: { width: 1440, height: 900 } });
  await guestCtx.addInitScript(() => { try { localStorage.setItem('peblo-idle-ms', '2500'); } catch { /* ignore */ } });
  const g = await guestCtx.newPage();
  await focusEmu(g);
  const errors = [];
  g.on('pageerror', (e) => errors.push(e.message));
  page.on('pageerror', (e) => errors.push(e.message));
  await g.goto(`${base}/s/note/${tok}`);
  await ready(g);

  // 1. avatars
  const av = (p) => p.locator('[data-testid="presence-avatar"]');
  check('1 owner sees two avatars (you and the guest)', await until(async () => (await av(page).count()) === 2), String(await av(page).count()));
  check('1 guest sees two avatars', await until(async () => (await av(g).count()) === 2), String(await av(g).count()));
  const theirs = page.locator('[data-testid="presence-avatar"]:not([data-state="you"])');

  // 2. typing
  await g.locator('.bn-editor .bn-block-content').nth(2).click();
  await g.keyboard.press('End');
  await g.keyboard.type(' typed by guest', { delay: 90 });
  check('2 the owner sees the guest typing', await until(async () => (await theirs.first().getAttribute('data-state')) === 'typing', 4000), String(await theirs.first().getAttribute('data-state')));

  // 3. away: nobody touches anything for a few seconds (the page was told 2.5 s)
  check('3 the guest shows as away after a pause', await until(async () => (await theirs.first().getAttribute('data-state')) === 'away', 9000), String(await theirs.first().getAttribute('data-state')));

  // 4. selection highlight
  await g.locator('.bn-editor .bn-block-content').nth(4).click();
  await g.keyboard.press('Home');
  await g.keyboard.press('Shift+End');
  check('4 the owner sees what the guest selected', await until(async () => (await page.locator('.ProseMirror-yjs-selection, .bn-collaboration-selection, [class*="yjs-selection"]').count()) > 0, 5000));

  // 5. edited by
  await g.locator('.bn-editor .bn-block-content').nth(6).click();
  await g.keyboard.press('End');
  await g.keyboard.type(' EDITED-HERE', { delay: 50 });
  await wait(1500);
  const target = page.locator('.bn-editor .bn-block-content', { hasText: 'EDITED-HERE' }).first();
  await target.waitFor({ timeout: 6000 }).catch(() => {});
  await page.mouse.move(5, 5);
  await target.hover();
  check('5 hovering a block says who edited it', await until(async () => /Edited by .+ · /.test((await page.locator('[data-testid="edited-by"]').textContent().catch(() => '')) || ''), 4000), (await page.locator('[data-testid="edited-by"]').textContent().catch(() => 'none')));

  // 6. follow mode: the owner follows the guest, who jumps to the end of a long note
  await theirs.first().click();
  check('6 following shows a banner', await page.locator('[data-testid="follow-banner"]').isVisible());
  const scroller = () => page.evaluate(() => { for (let n = document.querySelector('.bn-editor'); n; n = n.parentElement) { if (/(auto|scroll)/.test(getComputedStyle(n).overflowY) && n.scrollHeight > n.clientHeight) return n.scrollTop; } return 0; });
  const before = await scroller();
  await g.locator('.bn-editor .bn-block-content').last().click();
  await g.keyboard.press('Control+End');
  await g.keyboard.type('!', { delay: 60 });
  check('6 the owner\'s view follows the guest down the note', await until(async () => (await scroller()) > before + 300, 6000), `${before} -> ${await scroller()}`);
  // typing yourself ends following
  await page.locator('.bn-editor .bn-block-content').nth(0).click();
  await page.keyboard.press('End');
  await page.keyboard.type('.', { delay: 60 });
  check('6 typing yourself stops following', await until(async () => (await page.locator('[data-testid="follow-banner"]').count()) === 0, 3000));

  // 7. the live dot in the notes list
  await page.goto(base + '/notes');
  check('7 the notes list marks a note someone is in', await until(async () => (await page.locator('[data-testid="live-dot"]').count()) > 0, 15000));
  await guestCtx.close();
  check('7 the dot goes away when they leave', await until(async () => (await page.locator('[data-testid="live-dot"]').count()) === 0, 25000));
  check('no script errors', errors.length === 0, errors.join(' | ').slice(0, 300));
} catch (e) { check('no crash', false, String(e).slice(0, 400)); }
await finish();

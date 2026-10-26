// Follow mode and presenting: the follower's view lands on the same words as the person they follow, smoothly,
// lets go when the follower scrolls, and a presenter is offered to everyone else. Owner and a share-link guest, different window sizes.
import { boot } from './lib.mjs';

const { base, api, page, ctx, check, finish } = await boot();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await fn()) return true; } catch { /* retry */ } await wait(150); } return false; };
const ready = async (p) => { await p.locator('.bn-editor').waitFor({ timeout: 20000 }); await p.locator('[data-testid="collab-status"]').waitFor({ state: 'detached', timeout: 20000 }).catch(() => {}); };
const paras = Array.from({ length: 60 }, (_, i) => `Paragraph number ${i + 1} ${'with some words to fill the line '.repeat(1 + (i % 3))}`).join('\n\n');
const blockOf = (p, text) => p.locator('.bn-editor .bn-block-content', { hasText: text }).first();
// how far below the top of the scrolling area a block starts
const offset = (p, text) => p.evaluate((t) => {
  const el = [...document.querySelectorAll('.bn-editor .bn-block-content')].find((e) => e.textContent.includes(t));
  if (!el) return null;
  let sc = el;
  while (sc && sc !== document.body) { const oy = getComputedStyle(sc).overflowY; if ((oy === 'auto' || oy === 'scroll') && sc.scrollHeight > sc.clientHeight + 2) break; sc = sc.parentElement; }
  const top = sc && sc !== document.body ? sc.getBoundingClientRect().top : 0;
  return Math.round(el.getBoundingClientRect().top - top);
}, text);
const guestScrollTo = (g, text) => blockOf(g, text).evaluate((el) => el.scrollIntoView({ block: 'start' }));

try {
  const note = (await api('POST', '/api/notes', { title: 'Follow', content: paras, tags: [] })).note;
  const tok = (await api('POST', `/api/share/note/${note.id}`, { edit: true })).token;
  await page.goto(base + '/notes/' + note.id);
  await ready(page);
  const gc = await ctx.browser().newContext({ viewport: { width: 900, height: 700 } });
  await gc.addInitScript(() => { try { localStorage.setItem('peblo-guest-name', 'Gia'); } catch { /* ignore */ } });
  const g = await gc.newPage();
  const errors = [];
  g.on('pageerror', (e) => errors.push(e.message));
  page.on('pageerror', (e) => errors.push(e.message));
  await g.goto(`${base}/s/note/${tok}`);
  await ready(g);
  await wait(1200);

  // owner follows the guest
  await page.locator('[data-testid="presence-avatar"]:not([disabled])').first().click();
  check('1 following shows a banner', await page.locator('[data-testid="follow-banner"]').isVisible());

  for (const [i, n] of [[1, 'Paragraph number 20 '], [2, 'Paragraph number 45 '], [3, 'Paragraph number 8 ']]) {
    await guestScrollTo(g, n);
    const ok = await until(async () => { const o = await offset(page, n); return o !== null && Math.abs(o - 8) <= 14; }, 7000);
    check(`2.${i} the owner's view lands on "${n.trim()}" like the guest's`, ok, `owner offset ${await offset(page, n)} (guest ${await offset(g, n)})`);
  }

  // scrolling myself lets go
  await page.mouse.move(600, 400);
  await page.mouse.wheel(0, 300);
  check('3 scrolling yourself stops following', await until(async () => (await page.locator('[data-testid="follow-banner"]').count()) === 0, 3000));
  check('3b and says so', await page.locator('[data-testid="follow-freed"]').count() === 1);
  const stay = await offset(page, 'Paragraph number 8 ');
  await guestScrollTo(g, 'Paragraph number 50 ');
  await wait(1200);
  const after = await offset(page, 'Paragraph number 8 ');
  check('3c the owner no longer moves', after === stay || Math.abs(after - stay) < 4, `${stay} -> ${after}`);

  // presenting: the owner is offered to follow, and can say "not now"
  await g.locator('[data-testid="present-btn"]').click(); await g.locator('[data-testid="present-go"]').click();
  check('4 the guest sees they are presenting', await g.locator('[data-testid="presenting-banner"]').isVisible());
  check('5 the owner is offered to follow the presenter', await until(async () => (await page.locator('[data-testid="present-offer"]').count()) === 1));
  await page.locator('[data-testid="present-follow"]').click();
  await guestScrollTo(g, 'Paragraph number 12 ');
  check('6 following the presenter lands on the same words', await until(async () => { const o = await offset(page, 'Paragraph number 12 '); return o !== null && Math.abs(o - 8) <= 14; }, 7000), String(await offset(page, 'Paragraph number 12 ')));
  await g.locator('[data-testid="present-btn"]').click();
  check('7 the offer goes when they stop presenting', await until(async () => (await page.locator('[data-testid="present-offer"]').count()) === 0));
  await g.locator('[data-testid="present-btn"]').click(); await g.locator('[data-testid="present-go"]').click();
  check('8 and comes back next time', await until(async () => (await page.locator('[data-testid="present-offer"]').count()) + (await page.locator('[data-testid="follow-banner"]').count()) >= 1));

  check('9 no crash', errors.length === 0, errors.join(' | '));
} catch (e) {
  check('no crash', false, String(e && e.stack || e).slice(0, 700));
}
await finish();

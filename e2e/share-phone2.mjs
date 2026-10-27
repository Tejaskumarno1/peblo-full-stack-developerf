// The phone in a live room: comments sheet and selection toolbar, following the presenter, reactions.
import { boot } from './lib.mjs';

const { base, api, ctx, check, finish } = await boot();
const SHOTS = 'C:/Users/tejas/peblo-e2e';
const until = async (fn, ms = 12000) => { const end = Date.now() + ms; while (Date.now() < end) { try { if (await fn()) return true; } catch { /* retry */ } await new Promise((r) => setTimeout(r, 200)); } return false; };
const inView = async (loc, W, H) => { const b = await loc.boundingBox(); return !!b && b.x >= -1 && b.y >= -1 && b.x + b.width <= W + 1 && b.y + b.height <= H + 1; };
const W = 390, H = 780;
try {
  const body = '## Intro\n\n' + Array.from({ length: 30 }, (_, i) => `Paragraph ${i + 1} about normal forms and keys in a relational design.`).join('\n\n');
  const note = (await api('POST', '/api/notes', { title: 'Phone room', content: body, tags: [] })).note;
  const tok = (await api('POST', `/api/share/note/${note.id}`, { edit: true, expiresInDays: 1 })).token;
  const mk = async (opts) => { const c = await ctx.browser().newContext(opts); await c.addInitScript(() => { try { localStorage.setItem('peblo-guest-tour', '1'); } catch { /* ignore */ } }); return c.newPage(); };
  const pres = await mk({ viewport: { width: 1280, height: 800 } });
  const ph = await mk({ viewport: { width: W, height: H }, isMobile: true, hasTouch: true });
  await pres.goto(`${base}/s/note/${tok}`); await pres.locator('.bn-editor').waitFor({ timeout: 20000 });
  await pres.getByLabel('Your name').fill('Tejas'); await pres.getByLabel('Your name').press('Enter');
  await ph.goto(`${base}/s/note/${tok}`); await ph.locator('.bn-editor').waitFor({ timeout: 20000 });
  await ph.getByLabel('Your name').fill('Asha').catch(() => {}); await ph.getByLabel('Your name').press('Enter').catch(() => {});

  // comments sheet on the phone
  await until(async () => (await ph.getByTestId('comments-button').count()) > 0, 15000);
  const cb = ph.getByTestId('comments-button').first();
  check('the comments button is reachable on a phone', await cb.isVisible());
  await cb.click();
  await ph.getByTestId('comments-panel').waitFor({ timeout: 6000 });
  check('the comments sheet fits the screen', await inView(ph.getByTestId('comments-panel'), W, H), JSON.stringify(await ph.getByTestId('comments-panel').boundingBox()));
  await ph.screenshot({ path: `${SHOTS}/phone2-comments.png` });
  await ph.keyboard.press('Escape');
  if (await ph.getByTestId('comments-panel').isVisible().catch(() => false)) await cb.click().catch(() => {});

  // selection toolbar
  await ph.evaluate(() => {
    const w = document.createTreeWalker(document.querySelector('.bn-editor'), NodeFilter.SHOW_TEXT);
    let n; let hit = null;
    while ((n = w.nextNode())) { if (/Paragraph 2 about/.test(n.textContent)) { hit = n; break; } }
    hit.parentElement.scrollIntoView({ block: 'center' });
    const r = document.createRange(); r.setStart(hit, 0); r.setEnd(hit, 9);
    const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); document.dispatchEvent(new Event('selectionchange'));
  });
  const tool = ph.locator('.bn-toolbar').first();
  const shown = await until(async () => (await tool.count()) > 0 && await tool.isVisible(), 6000);
  check('selecting text shows the text toolbar', shown);
  if (shown) check('and it fits the screen', await inView(tool, W, H), JSON.stringify(await tool.boundingBox()));
  await ph.screenshot({ path: `${SHOTS}/phone2-select.png` });

  // presenting from the desktop, following on the phone
  await until(async () => (await pres.getByTestId('present-btn').count()) === 1, 20000);
  await pres.getByTestId('present-btn').click(); await pres.getByTestId('present-options').click();
  await pres.getByTestId('present-go').click();
  await pres.getByTestId('presenting-banner').waitFor({ timeout: 8000 });
  check('the phone is offered to follow', await until(async () => (await ph.getByTestId('present-follow').count()) === 1, 15000));
  check('the offer fits the screen', await inView(ph.getByTestId('present-offer'), W, H), JSON.stringify(await ph.getByTestId('present-offer').boundingBox().catch(() => null)));
  await ph.getByTestId('present-follow').click();
  check('the phone shows the follow banner', await until(async () => (await ph.getByTestId('follow-banner').count()) === 1, 15000));
  check('the banner fits the screen', await inView(ph.getByTestId('follow-banner'), W, H), JSON.stringify(await ph.getByTestId('follow-banner').boundingBox()));
  const react = ph.getByTestId('react-up');
  check('reactions are on the phone', await until(async () => (await react.count()) === 1));
  const rb = await react.boundingBox();
  check('and big enough to tap', !!rb && rb.width >= 28 && rb.height >= 28, JSON.stringify(rb));
  const hit = await ph.evaluate(() => { const b = document.querySelector('[data-testid=react-up]'); const r = b.getBoundingClientRect(); const e = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return { r: [r.x, r.y, r.width, r.height].map(Math.round), top: e ? (e.closest('[data-testid]')?.getAttribute('data-testid') || e.tagName) : null, vis: getComputedStyle(b).visibility, vh: innerHeight }; });
  check('nothing covers the reaction button', hit.top === 'react-up', JSON.stringify(hit));
  await react.click({ timeout: 8000 });
  check('a tap counts', await until(async () => /1/.test(await pres.getByTestId('react-counts').innerText())));
  const ov = await ph.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  check('still no sideways scroll in a room', ov.sw <= ov.cw + 1, JSON.stringify(ov));
  await ph.screenshot({ path: `${SHOTS}/phone2-follow.png` });
  await ph.touchscreen.tap(200, 400).catch(() => {});
  await ph.mouse.wheel(0, 900);
  check('scrolling away offers a way back', await until(async () => (await ph.getByTestId('return-presenter').count()) === 1 || (await ph.getByTestId('follow-freed').count()) === 1, 8000));
  await ph.screenshot({ path: `${SHOTS}/phone2-freed.png` });
} catch (e) { check('phone2 ran without error', false, String(e)); }
await finish();

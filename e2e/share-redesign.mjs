// Share page redesign: no white bar, docked live panel, and the start-to-end selection range (guest -> owner and owner -> guest).
import { boot } from './lib.mjs';

const { base, api, page, ctx, check, finish } = await boot();
const SHOTS = 'C:/Users/tejas/Documents/peblo-full-stack-developerf/.shots';
try {
  const note = (await api('POST', '/api/notes', { title: 'Range note', content: '# Goal\n\nShip the redesign by Friday with no open blockers\n\nSecond paragraph stays plain', tags: [] })).note;
  const tok = (await api('POST', `/api/share/note/${note.id}`, { edit: true })).token;
  await page.addInitScript(() => { try { localStorage.setItem('peblo-style', 'soft'); localStorage.setItem('peblo-collab-tip', '1'); } catch { /* ignore */ } });
  await page.setViewportSize({ width: 1440, height: 860 });
  await page.goto(`${base}/notes/${note.id}`);
  await page.locator('.bn-editor').waitFor({ timeout: 15000 });

  const gctx = await ctx.browser().newContext({ viewport: { width: 1440, height: 900 } });
  const g = await gctx.newPage();
  await g.goto(`${base}/s/note/${tok}`);
  await g.locator('.bn-editor').waitFor({ timeout: 15000 });
  await g.getByLabel('Your name').fill('Aarav');
  await g.getByLabel('Your name').press('Enter');

  // layout: header is not a white bar; panel is docked at the right of the page card
  const top = await g.evaluate(() => { const t = document.querySelector('.pb-shared .top'); const s = getComputedStyle(t); return { bg: s.backgroundColor, border: s.borderBottomWidth, filter: s.backdropFilter }; });
  check('header has no white bar behind it', /rgba\(0, 0, 0, 0\)|transparent/.test(top.bg) && top.border === '0px', JSON.stringify(top));
  await g.getByTestId('live-panel').waitFor({ timeout: 8000 });
  const box = await g.evaluate(() => { const a = document.querySelector('.pb-shared article').getBoundingClientRect(); const p = document.querySelector('.pb-shared .cp-drawer').getBoundingClientRect(); return { aRight: a.right, pLeft: p.left, pRight: p.right, vw: innerWidth }; });
  check('the live panel is docked beside the page, not floating over it', box.pLeft >= box.aRight - 1 && box.pRight <= box.vw, JSON.stringify(box));
  const cardBg = await g.evaluate(() => getComputedStyle(document.querySelector('.pb-shared article')).backgroundColor);
  check('the page is a white card', /255, 255, 255/.test(cardBg), cardBg);

  // guest selects the first sentence; the owner sees where it starts and ends
  const para = g.locator('.bn-editor').getByText('Ship the redesign by Friday with no open blockers');
  await para.click();
  await g.keyboard.press('Home');
  await g.keyboard.press('Shift+End');
  await page.waitForFunction(() => document.querySelector('[data-peer-start]') && document.querySelector('[data-peer-end]'), null, { timeout: 15000 });
  const own = await page.evaluate(() => ({
    start: document.querySelector('[data-peer-start]').getAttribute('data-peer-start'),
    end: document.querySelector('[data-peer-end] span').textContent,
    rects: document.querySelectorAll('.pb-peer-sel').length,
    word: document.querySelector('[data-peer-end] span').textContent,
  }));
  check('owner sees Aarav\'s selection start and end with a word count', own.start === 'Aarav' && /Aarav · End · 9 words/.test(own.end) && own.rects >= 1, JSON.stringify(own));
  await page.screenshot({ path: `${SHOTS}/range-owner.png` });

  // collapsing the selection turns it into a thin caret with the name
  await g.keyboard.press('ArrowLeft');
  await page.waitForFunction(() => document.querySelector('[data-peer-caret]') && !document.querySelector('[data-peer-end]'), null, { timeout: 15000 });
  check('a collapsed selection shows as a caret, not a range', true);

  // owner selects text; the guest sees the range too
  const op = page.locator('.bn-editor').getByText('Second paragraph stays plain');
  await op.click();
  await page.keyboard.press('Home');
  await page.keyboard.press('Shift+End');
  await g.waitForFunction(() => document.querySelector('[data-peer-end]'), null, { timeout: 15000 });
  const guestSees = await g.evaluate(() => document.querySelector('[data-peer-end] span').textContent);
  check('guest sees the owner\'s selection end and its word count', /End · 4 words/.test(guestSees), guestSees);
  await g.screenshot({ path: `${SHOTS}/range-guest.png` });
  await gctx.close();
} catch (error) {
  check('ran', false, String(error));
}
await finish();

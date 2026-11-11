// Share page comments panel in the Soft Studio look (S22, S23): tabs Open / Resolved / Mine, pill actions,
// Enter sends and Shift+Enter adds a line, mention list restyled, panel lives inside the themed page, dark mode.
import { boot } from './lib.mjs';
import fs from 'node:fs';

const { base, api, page, ctx, check, finish } = await boot({ freshGuest: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await fn()) return true; } catch { /* retry */ } await wait(150); } return false; };
const ready = async (p) => { await p.locator('.bn-editor').waitFor({ timeout: 20000 }); await p.locator('[data-testid="collab-status"]').waitFor({ state: 'detached', timeout: 20000 }).catch(() => {}); };
const shots = 'D:/Peblo/_shots';
try { fs.mkdirSync(shots, { recursive: true }); } catch { /* exists */ }

try {
  const note = (await api('POST', '/api/notes', { title: 'Q4 client report', content: 'Clients praise the team but ask for fewer rounds.\n\nMost delays start with an unclear first brief.', tags: [] })).note;
  const tok = (await api('POST', `/api/share/note/${note.id}`, { edit: true })).token;
  const gc = await ctx.browser().newContext({ viewport: { width: 1440, height: 900 } });
  const g = await gc.newPage();
  const errors = [];
  g.on('pageerror', (e) => errors.push(e.message));
  await g.goto(`${base}/s/note/${tok}`);
  await ready(g);
  await g.locator('[data-testid="join-card"]').getByLabel('Your name').fill('Priya');
  await g.locator('[data-testid="join-submit"]').click();
  await until(async () => (await g.locator('[data-testid="join-card"]').count()) === 0);

  await g.locator('.bn-editor .bn-block-content', { hasText: 'unclear first brief' }).first().click({ clickCount: 3 });
  await g.locator('[data-testid="comments-button"]').click();
  const panel = g.locator('[data-testid="comments-panel"]');
  check('1 the panel opens inside the themed share page', await panel.count() === 1 && await panel.evaluate((el) => !!el.closest('.pb-shared')));
  check('2 it uses the Soft Studio panel', await panel.evaluate((el) => el.classList.contains('soft')));
  const tabs = (await panel.locator('.soft-tabs button').allInnerTexts()).map((t) => t.replace(/\s*\d+$/, ''));
  check('3 tabs are Open, Resolved and Mine', tabs.join('|') === 'Open|Resolved|Mine', tabs.join('|'));
  const r = await panel.evaluate((el) => { const b = el.getBoundingClientRect(); const cs = getComputedStyle(el); return { w: b.width, radius: cs.borderTopLeftRadius, right: innerWidth - b.right }; });
  check('4 panel is 284px wide with the 30px corner', Math.round(r.w) === 284 && r.radius === '30px', JSON.stringify(r));
  const pb = await panel.evaluate((el) => { const b = el.getBoundingClientRect(); const cs = getComputedStyle(el); const par = []; for (let p = el.parentElement; p; p = p.parentElement) { const c = getComputedStyle(p); if (c.transform !== 'none' || c.zoom !== '1' || c.contain !== 'none' || c.filter !== 'none' || c.willChange !== 'auto') par.push(`${p.className || p.tagName}:${c.transform}/${c.zoom}/${c.contain}`); } return { top: b.top, bottom: innerHeight - b.bottom, h: innerHeight, pos: cs.position, cb: cs.bottom, ch: cs.height, par }; });
  check('4b panel keeps a 24px gap at the bottom and 96px at the top', Math.abs(pb.bottom - 24) <= 1 && Math.abs(pb.top - 96) <= 1, JSON.stringify(pb));

  await panel.locator('[data-testid="comment-on-selection"]').click();
  const ta = panel.locator('[data-testid="comment-text"]');
  check('5 the composer says Enter sends', /Enter sends, Shift Enter adds a line/.test(await panel.innerText()));
  await ta.fill('Can we name the two that disagreed?');
  await ta.press('Shift+Enter');
  await ta.type('Second line');
  check('6 Shift+Enter keeps writing', (await panel.locator('[data-testid="comment-thread"]').count()) === 0 && /Second line/.test(await ta.inputValue()));
  await ta.press('Enter');
  check('7 Enter sends the comment', await until(async () => (await panel.locator('[data-testid="comment-thread"]').count()) === 1));
  check('8 Reply and Resolve are pill buttons with icons', await panel.locator('.acts button svg').count() >= 2);

  await panel.locator('.soft-tabs button').nth(2).click();
  check('9 Mine lists the thread I started', await panel.locator('[data-testid="comment-thread"]').count() === 1);
  await panel.locator('.soft-tabs button').nth(1).click();
  check('10 Resolved is empty before resolving', await panel.locator('[data-testid="comment-thread"]').count() === 0);
  await panel.locator('.soft-tabs button').nth(0).click();
  await g.screenshot({ path: `${shots}/s23-light.png` });

  await panel.locator('[data-testid="resolve"]').click();
  await panel.locator('.soft-tabs button').nth(1).click();
  check('11 Resolved shows it after Resolve', await until(async () => (await panel.locator('[data-testid="comment-thread"]').count()) === 1));

  await g.evaluate(() => document.querySelector('.pb-shared')?.setAttribute('data-theme', 'dark'));
  await panel.locator('.soft-tabs button').nth(0).click();
  await g.screenshot({ path: `${shots}/s23-dark.png` });
  const bg = await panel.evaluate((el) => getComputedStyle(el).backgroundColor);
  check('12 dark mode uses the dark surface', bg === 'rgb(31, 26, 39)', bg);
  check('13 no page errors', errors.length === 0, errors.join(' | '));
} catch (e) {
  check('no crash', false, String(e));
}
await finish();

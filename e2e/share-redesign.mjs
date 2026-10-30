// Share page redesign: no white bar, docked live panel, and the start-to-end selection range (guest -> owner and owner -> guest).
import { boot } from './lib.mjs';

const { base, api, page, ctx, check, finish } = await boot();
const SHOTS = 'C:/Users/tejas/Documents/peblo-full-stack-developerf/.shots';
try {
  const note = (await api('POST', '/api/notes', { title: 'Range note', content: '## Goal\n\nShip the redesign by Friday with no open blockers\n\n## Next\n\nSecond paragraph stays plain', tags: [] })).note;
  const tok = (await api('POST', `/api/share/note/${note.id}`, { edit: true })).token;
  await page.addInitScript(() => { try { localStorage.setItem('peblo-style', 'soft'); localStorage.setItem('peblo-collab-tip', '1'); localStorage.setItem('peblo-collab', 'off'); } catch { /* ignore */ } }); // the range flags are the non-live marks; a live (Yjs) room draws real cursors and hides them
  await page.setViewportSize({ width: 1440, height: 860 });
  await page.goto(`${base}/notes/${note.id}`);
  await page.locator('.bn-editor').waitFor({ timeout: 15000 });

  const gctx = await ctx.browser().newContext({ viewport: { width: 1440, height: 900 } });
  await gctx.addInitScript(() => { try { localStorage.setItem('peblo-collab', 'off'); } catch { /* ignore */ } });
  const g = await gctx.newPage();
  await g.goto(`${base}/s/note/${tok}`);
  await g.locator('.bn-editor').waitFor({ timeout: 15000 });
  await g.getByLabel('Your name').fill('Aarav');
  await g.getByLabel('Your name').press('Enter');

  // layout: header is not a white bar; panel is docked at the right of the page card
  const top = await g.evaluate(() => { const t = document.querySelector('.pb-shared .top'); const s = getComputedStyle(t); return { bg: s.backgroundColor, border: s.borderBottomWidth, filter: s.backdropFilter }; });
  check('header has no white bar behind it', /rgba\(0, 0, 0, 0\)|transparent/.test(top.bg) && top.border === '0px', JSON.stringify(top));
  await g.getByTestId('live-panel').waitFor({ timeout: 8000 });
  const box = await g.evaluate(() => { const a = document.querySelector('.pb-shared article').getBoundingClientRect(); const p = document.querySelector('.pb-shared .cp-drawer').getBoundingClientRect(); const r = document.querySelector('.pb-shared .srail').getBoundingClientRect(); return { aRight: a.right, rRight: r.right, pLeft: p.left, pRight: p.right, vw: innerWidth }; });
  check('the live panel opens as a flyout beside the left rail', box.pLeft >= box.rRight && box.pRight <= box.vw, JSON.stringify(box));
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

  // the owner's Outline card shows who is in which section
  await page.waitForFunction(() => document.querySelector('[data-testid="outline-pips"] i'), null, { timeout: 15000 });
  check('owner Outline card marks the section Aarav is in', /Aarav is here/.test(await page.evaluate(() => document.querySelector('[data-testid="outline-pips"] i').title)));

  // flags fade when nobody moves, and come back (with the exact words) when you point at the selection
  await page.waitForFunction(() => document.querySelector('.pb-peer-end.quiet'), null, { timeout: 12000 });
  check('flags fade after a few seconds without movement', true);
  const spot = await page.evaluate(() => { const r = document.querySelector('.pb-peer-sel').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  await page.mouse.move(spot.x, spot.y);
  await page.waitForFunction(() => document.querySelector('.pb-peer-tip'), null, { timeout: 5000 });
  const tipText = await page.evaluate(() => document.querySelector('.pb-peer-tip').textContent);
  check('pointing at a selection shows who selected which words', /Aarav selected .Ship the redesign by Friday with no open blockers./.test(tipText), tipText);
  check('and the flag comes back', await page.evaluate(() => !!document.querySelector('.pb-peer-end.hot')));

  // two people on the same words: their flags stack instead of overlapping
  const g2ctx = await ctx.browser().newContext({ viewport: { width: 1440, height: 860 } }); // wide enough that the docked People panel pushes the page instead of covering the text (at 1280 it overlays it)
  await g2ctx.addInitScript(() => { try { localStorage.setItem('peblo-collab', 'off'); } catch { /* ignore */ } });
  const g2 = await g2ctx.newPage();
  await g2.goto(`${base}/s/note/${tok}`);
  await g2.locator('.bn-editor').waitFor({ timeout: 15000 });
  await g2.getByLabel('Your name').fill('Bela');
  await g2.getByLabel('Your name').press('Enter');
  await g2.locator('.bn-editor').getByText('Ship the redesign by Friday with no open blockers').click();
  await g2.keyboard.press('Home');
  await g2.keyboard.press('Shift+End');
  await page.mouse.move(5, 5);
  await page.waitForFunction(() => document.querySelectorAll('.pb-peer-end').length >= 2, null, { timeout: 15000 });
  const lifts = await page.evaluate(() => [...document.querySelectorAll('.pb-peer-end span')].map((s) => parseInt(s.style.marginBottom || '1', 10)).sort((a, b) => a - b));
  check('two flags on the same words are stacked, not overlapping', lifts.length >= 2 && lifts[lifts.length - 1] >= 20, JSON.stringify(lifts));
  await g2ctx.close();


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

  // the outline shows who is in which section
  await g.waitForFunction(() => document.querySelector('[data-testid="toc-pips"] i'), null, { timeout: 15000 });
  const pip = await g.evaluate(() => ({ title: document.querySelector('[data-testid="toc-pips"] i').title, link: document.querySelector('[data-testid="toc-pips"]').closest('a').textContent }));
  check('the outline marks the section the owner is in', /is here/.test(pip.title) && /Next/.test(pip.link), JSON.stringify(pip));

  // Follow: click it to follow the owner, Escape to stop
  const follow = g.locator('.cp-follow').first();
  await follow.waitFor({ timeout: 10000 });
  await follow.click();
  check('Follow turns into Following', /Following/.test(await follow.innerText()));
  await g.keyboard.press('Escape');
  await g.waitForFunction(() => /^Follow$/.test(document.querySelector('.cp-follow')?.textContent || ''), null, { timeout: 5000 });
  check('Escape stops following', true);
  await gctx.close();

  // phone: bottom bar, page card, no horizontal scroll
  const mctx = await ctx.browser().newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  await mctx.addInitScript(() => { try { localStorage.setItem('peblo-collab', 'off'); } catch { /* ignore */ } });
  const m = await mctx.newPage();
  await m.goto(`${base}/s/note/${tok}`);
  await m.locator('.bn-editor').waitFor({ timeout: 15000 });
  await m.waitForTimeout(1500);
  const overflow = await m.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  check('phone: no sideways scroll', overflow <= 1, String(overflow));
  const peopleBtn = m.getByTestId('mbar').getByRole('button', { name: 'People' }); // the phone page action bar replaced the old live-editors pill
  check('phone: the bottom bar shows who is here', await peopleBtn.isVisible() && /People\s*[1-9]/.test(await peopleBtn.innerText()), await peopleBtn.innerText().catch(() => 'missing'));
  const gutter = await m.evaluate(() => { const a = document.querySelector('.pb-shared article').getBoundingClientRect(); const p = document.querySelector('.bn-editor p, .bn-editor [data-content-type]').getBoundingClientRect(); return { left: Math.round(p.left - a.left), width: Math.round(p.width), card: Math.round(a.width) }; });
  check('phone: the text has at least 85% of the screen width', gutter.width >= 390 * 0.85 - 16, JSON.stringify(gutter));
  await m.screenshot({ path: `${SHOTS}/range-phone.png` });
  await mctx.close();

  // a shared task uses the same page
  const todo = (await api('POST', '/api/todos', { text: 'Write the release announcement', priority: 'high' }));
  const todoId = (todo.todo || todo).id;
  const ttok = (await api('POST', `/api/share/todo/${todoId}`, { edit: true })).token;
  const tctx = await ctx.browser().newContext({ viewport: { width: 1440, height: 860 } });
  await tctx.addInitScript(() => { try { localStorage.setItem('peblo-collab', 'off'); } catch { /* ignore */ } });
  const t = await tctx.newPage();
  await t.goto(`${base}/s/todo/${ttok}`);
  await t.getByLabel('Task').waitFor({ timeout: 15000 });
  // the People panel opens by itself only when someone else is on the page; open it from the rail like a person would
  if (!(await t.getByTestId('live-panel').isVisible())) await t.getByTestId('rail-people').click();
  await t.getByTestId('live-panel').waitFor({ timeout: 5000 }).catch(() => {});
  check('task page: docked panel and white card', await t.getByTestId('live-panel').isVisible() && /255, 255, 255/.test(await t.evaluate(() => getComputedStyle(document.querySelector('.pb-shared article')).backgroundColor)));
  await t.screenshot({ path: `${SHOTS}/range-task.png` });
  await tctx.close();
} catch (error) {
  check('ran', false, String(error));
}
await finish();

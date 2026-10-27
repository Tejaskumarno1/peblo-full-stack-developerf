// Presenting a PowerPoint from a note: the Present menu lists the deck, the slide number travels to people following,
// they can look around on their own and come back with one tap; speaker notes and the next slide stay with the presenter.
import fs from 'node:fs';
import { boot } from './lib.mjs';
import { makeFixtures } from './fixtures/make.mjs';
const { base, api, token, page, ctx, check, finish } = await boot();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 15000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await fn()) return true; } catch { /* retry */ } await wait(150); } return false; };
const fx = await makeFixtures();
try {
  const up = await (await fetch(base + '/api/files', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'X-File-Name': encodeURIComponent('Launch-plan.pptx'), 'X-File-Type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation' }, body: fs.readFileSync(fx.pptx) })).json();
  const md = `# Launch\n\nBefore the deck.\n\n![Launch-plan.pptx](${up.url}#nm=Launch-plan.pptx&sz=${up.size}&mt=5+slides)\n\nAfter the deck.`;
  const note = (await api('POST', '/api/notes', { title: 'Launch', content: md, tags: [] })).note;
  const tok = (await api('POST', `/api/share/note/${note.id}`, { edit: true })).token;
  await page.goto(base + '/notes/' + note.id);
  await page.locator('[data-testid="docfile"]').waitFor({ timeout: 25000 });
  const c = await ctx.browser().newContext({ viewport: { width: 1200, height: 800 } });
  await c.addInitScript(() => { try { localStorage.setItem('peblo-guest-name', 'Pia'); localStorage.setItem('peblo-guest-tour', '1'); } catch { /* ignore */ } });
  const g = await c.newPage(); await g.goto(`${base}/s/note/${tok}`);
  await g.locator('.bn-editor').waitFor({ timeout: 25000 });
  await page.locator('[data-testid="present-btn"]').waitFor({ timeout: 25000 });

  // ---- the menu
  await page.locator('[data-testid="present-btn"]').click();
  const ppt = page.getByTestId('pm-ppt');
  check('1 PowerPoint row is on when the note has a deck', !(await ppt.isDisabled()));
  check('2 it names the deck', /Launch-plan\.pptx/.test(await ppt.innerText()));
  await ppt.click();
  const deck = page.locator('[data-testid="deck"][data-role="presenter"]');
  await deck.waitFor({ timeout: 20000 });
  check('3 the deck opens full screen for the presenter', await deck.isVisible());
  await deck.locator('.df-slide-box .pptx-preview-slide-wrapper').first().waitFor({ state: 'attached', timeout: 25000 });
  check('4 starts at 1 / 5', /1 \/ 5/.test(await deck.getByTestId('deck-count').innerText()));
  check('5 the next slide is shown', (await deck.getByTestId('deck-next-thumb').locator('.df-thumb-i').count()) === 1);
  await page.keyboard.press('ArrowRight');
  check('6 Right arrow moves to 2 / 5', await until(async () => /2 \/ 5/.test(await deck.getByTestId('deck-count').innerText())));
  check('7 speaker notes of that slide show', await until(async () => /Friday review/.test(await deck.getByTestId('deck-notes').innerText())));
  check('8 a slide with no notes says so', await (async () => { await page.keyboard.press('ArrowRight'); return until(async () => /No notes/.test(await deck.getByTestId('deck-notes').innerText())); })());
  await page.keyboard.press('ArrowLeft');
  await until(async () => /2 \/ 5/.test(await deck.getByTestId('deck-count').innerText()));

  // ---- someone following
  const offer = g.getByTestId('present-offer');
  check('9 the guest is offered the presentation', await until(async () => (await offer.count()) === 1));
  await g.getByTestId('present-follow').click();
  const gd = g.locator('[data-testid="deck"][data-role="follower"]');
  check('10 the guest sees the deck', await until(async () => (await gd.count()) === 1, 20000));
  check('11 on the same slide (2 / 5)', await until(async () => /2 \/ 5/.test(await gd.getByTestId('deck-count').innerText())));
  check('12 followers do not get the presenter notes', (await gd.getByTestId('deck-notes').count()) === 0);
  await page.keyboard.press('ArrowRight');
  check('13 the guest moves with the presenter (3 / 5)', await until(async () => /3 \/ 5/.test(await gd.getByTestId('deck-count').innerText())));

  // ---- looking around, and coming back
  await g.keyboard.press('ArrowLeft');
  check('14 the guest can look back on their own (2 / 5)', await until(async () => /2 \/ 5/.test(await gd.getByTestId('deck-count').innerText())));
  check('15 a Back to presenter button appears', await until(async () => (await gd.getByTestId('deck-back').count()) === 1));
  await page.keyboard.press('ArrowRight');
  check('16 the presenter moves on and the guest stays where they are', await until(async () => /4 \/ 5|slide 4/.test(await gd.getByTestId('deck-back').innerText())) && /2 \/ 5/.test(await gd.getByTestId('deck-count').innerText()));
  await gd.getByTestId('deck-back').click();
  check('17 one tap returns to the presenter (4 / 5)', await until(async () => /4 \/ 5/.test(await gd.getByTestId('deck-count').innerText())) && (await gd.getByTestId('deck-back').count()) === 0);
  check('18 following was never dropped by using the arrows', (await g.getByTestId('follow-freed').count()) === 0);

  // ---- laser pointer on the slide
  await page.getByTestId('tool-laser').click();
  const sb = await deck.locator('.df-slide-box').boundingBox();
  await page.mouse.move(sb.x + sb.width * 0.5, sb.y + sb.height * 0.5); await wait(100); await page.mouse.move(sb.x + sb.width * 0.5 + 4, sb.y + sb.height * 0.5 + 2);
  check('18b the guest sees the presenter pointer on the slide', await until(async () => (await gd.getByTestId('deck-dot').count()) === 1));
  await page.getByTestId('tool-laser').click();
  check('18c and it goes when the laser is off', await until(async () => (await gd.getByTestId('deck-dot').count()) === 0));

  // ---- all slides
  await deck.getByTestId('deck-strip').click();
  check('19 the strip shows every slide', await until(async () => (await deck.locator('.df-strip .df-t').count()) === 5));
  await deck.locator('.df-strip .df-t').first().click();
  check('20 a thumbnail jumps there (1 / 5)', await until(async () => /1 \/ 5/.test(await deck.getByTestId('deck-count').innerText())));
  check('21 and the guest follows', await until(async () => /1 \/ 5/.test(await gd.getByTestId('deck-count').innerText())));

  // ---- stop following, stop presenting
  await gd.getByTestId('deck-leave').click();
  check('22 the guest can leave the deck', await until(async () => (await gd.count()) === 0));
  check('23 the presenter is still on', (await deck.count()) === 1);
  await page.getByTestId('present-end').click();
  check('24 stopping closes the deck', await until(async () => (await page.locator('[data-testid="deck"]').count()) === 0));
} catch (e) { check('crash: ' + e.message, false, e.stack); }
await finish();

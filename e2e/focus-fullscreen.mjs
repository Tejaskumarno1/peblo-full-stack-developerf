// Owner full-screen writing mode (docs/mockups/Focus.dc.html): bar, outline rail, serif column, today's words, hint, fade on typing, prefs kept.
// Run in Soft, River and Orbit. Set SHOT_DIR to keep screenshots at 1280x800.
import fs from 'fs';
import { boot } from './lib.mjs';
const { base, api, page, check, finish } = await boot();
const SHOT = process.env.SHOT_DIR || '';
if (SHOT) fs.mkdirSync(SHOT, { recursive: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const content = [
  '## Session setup', '', 'Session setup covers the PI and sprints, teams and roles, agenda and vision, scope, and the publish and edit rules. None of it can be created from the mobile app yet.', '',
  '## Team boards', '', 'Team boards are the next gap. Today the app only says the words Team boards, and there is no board behind them. The draft plan review has the same problem, because the note is web only.', '',
  '## Draft plan review', '', 'Post-PI needs nothing new. A search for matrix in the PI code finds nothing, so the dependency matrix and propose drawer are open work.', '',
  '## Post-PI', '', 'Capacity panel and measure cards come after that, with the distributed bar and working agreements.', '',
  '## Management review', '', ...Array.from({ length: 14 }, (_, i) => `Closing paragraph ${i + 1} gives the page some length so that the note scrolls and the reading progress line can move along the top of the screen.\n`),
].join('\n');
try {
  const n = (await api('POST', '/api/notes', { title: 'Pi planning', content, tags: ['work'] })).note;
  await page.setViewportSize({ width: 1280, height: 800 });
  const open = {
    soft: async () => { await page.locator('button[aria-label="Full screen"]').first().click(); },
    river: async () => { await page.locator('[data-testid="fs-open"]').first().click(); },
    orbit: async () => { await page.locator('button[aria-label="Focus mode"]').first().click(); },
  };
  for (const style of ['soft', 'river', 'orbit']) {
    await page.goto(base + '/tasks');
    await page.evaluate((v) => { localStorage.setItem('peblo-style', v); ['peblo-fs-width', 'peblo-fs-size', 'peblo-fs-theme', 'peblo-fs-outline', 'peblo-fs-day'].forEach((k) => localStorage.removeItem(k)); }, style);
    await page.goto(base + '/notes/' + n.id);
    await page.locator('.bn-editor').waitFor({ timeout: 20000 });
    await wait(1500);
    await open[style]();
    await page.locator('[data-testid="fs-bar"]').waitFor({ timeout: 5000 });
    await wait(600);
    const T = `${style}:`;
    const vis = async (id) => page.locator(`[data-testid="${id}"]`).isVisible().catch(() => false);
    check(`${T} full screen shows the bar, progress line, outline, counter and hint`, (await vis('fs-bar')) && (await vis('fs-progress')) && (await vis('fs-outline')) && (await vis('fs-counter')) && (await vis('fs-hint')));
    const labels = await page.locator('[data-testid="fs-bar"] button').evaluateAll((els) => els.map((e) => (e.getAttribute('aria-label') || e.textContent || '').trim()));
    const want = ['Outline', 'Typewriter mode', 'Focus on one paragraph', 'Find in note', 'Narrow', 'Wide', 'Full', 'Smaller text', 'Larger text', 'Dark theme', 'Exit full screen'];
    check(`${T} the bar has every button from the mockup`, want.every((w) => labels.includes(w)), labels.join(' | '));
    const bar = await page.locator('[data-testid="fs-bar"]').boundingBox();
    check(`${T} bar sits at the top, 56px tall, inside the screen`, !!bar && Math.abs(bar.y - 16) < 3 && Math.abs(bar.height - 56) < 3 && bar.x >= 20 && bar.x + bar.width <= 1262, JSON.stringify(bar));
    const status = await page.locator('[data-testid="fs-status"]').innerText();
    check(`${T} save state, word count and reading time are shown`, /Saved|Saving|Editing/.test(status) && /\d+ words?/.test(status) && /min read/.test(status), status);
    // the column
    const col = async () => page.evaluate(() => { const e = document.querySelector('.bn-editor'); const r = e.getBoundingClientRect(); const p = e.querySelector('[data-content-type="paragraph"] .bn-inline-content, [data-content-type="paragraph"]'); const cs = getComputedStyle(p); return { x: r.x, w: r.width, font: cs.fontFamily, size: parseFloat(cs.fontSize), lh: parseFloat(cs.lineHeight) }; });
    let c = await col();
    check(`${T} wide column is about 680px and centred`, Math.abs(c.w - 680) < 30 && Math.abs(c.x + c.w / 2 - 640) < 30, JSON.stringify(c));
    check(`${T} writing column is the Newsreader serif at 21px`, /Newsreader|Georgia|serif/i.test(c.font) && Math.abs(c.size - 21) < 0.6, JSON.stringify(c));
    const title = await page.evaluate(() => { const t = document.querySelector('#s-note-title, #r-note-title, #o-note-title'); const cs = t && getComputedStyle(t); const r = t && t.getBoundingClientRect(); return t ? { size: parseFloat(cs.fontSize), weight: cs.fontWeight, w: r.width, x: r.x } : null; });
    check(`${T} the title is the big sans heading in the column`, !!title && title.size >= 40 && Number(title.weight) >= 700 && title.w > 400, JSON.stringify(title));
    if (SHOT) await page.screenshot({ path: `${SHOT}/focus-${style}-wide.png` });
    // width
    await page.locator('[data-testid="fs-w-narrow"]').click(); await wait(250);
    c = await col(); check(`${T} Narrow makes the column about 560px`, Math.abs(c.w - 560) < 30, JSON.stringify(c));
    await page.locator('[data-testid="fs-w-full"]').click(); await wait(250);
    c = await col(); check(`${T} Full makes the column wider than Wide`, c.w > 720, JSON.stringify(c));
    await page.locator('[data-testid="fs-w-wide"]').click(); await wait(250);
    // text size
    await page.locator('[data-testid="fs-larger"]').click(); await wait(200);
    c = await col(); check(`${T} A+ makes the text larger`, c.size > 22, JSON.stringify(c));
    await page.locator('[data-testid="fs-smaller"]').click(); await page.locator('[data-testid="fs-smaller"]').click(); await wait(200);
    c = await col(); check(`${T} A- makes the text smaller`, c.size < 20, JSON.stringify(c));
    // theme
    const bg0 = await page.evaluate(() => getComputedStyle(document.querySelector('.s-notes.focus, .o-sheet.zen, .r-sheet.fs')).backgroundColor);
    await page.locator('[data-testid="fs-theme"]').click(); await wait(250);
    const bg1 = await page.evaluate(() => getComputedStyle(document.querySelector('.s-notes.focus, .o-sheet.zen, .r-sheet.fs')).backgroundColor);
    check(`${T} the theme button switches to a dark page`, bg0 !== bg1 && (await page.evaluate(() => document.documentElement.getAttribute('data-fs-theme'))) === 'dark', `${bg0} -> ${bg1}`);
    if (SHOT) await page.screenshot({ path: `${SHOT}/focus-${style}-dark.png` });
    await page.locator('[data-testid="fs-theme"]').click(); await wait(200);
    // outline
    const items = await page.locator('[data-testid="fs-outline"] button').allInnerTexts();
    check(`${T} the outline lists the headings`, items.length === 5 && /Session setup/.test(items[0]) && /Management review/.test(items[4]), items.join(' | '));
    await page.locator('[data-testid="fs-outline"] button').nth(4).click(); await wait(900);
    const prog = await page.locator('[data-testid="fs-progress"]').getAttribute('aria-valuenow');
    check(`${T} the outline jumps and the progress line moves`, Number(prog) > 20, prog);
    check(`${T} the heading being read is marked in the outline`, (await page.locator('[data-testid="fs-outline"] button.on').innerText()).includes('Management review'));
    await page.locator('[data-testid="fs-outline-btn"]').click(); await wait(200);
    check(`${T} the Outline button hides the rail`, !(await vis('fs-outline')));
    await page.locator('[data-testid="fs-outline-btn"]').click(); await wait(200);
    // today's words
    const w0 = Number(await page.locator('[data-testid="fs-today"]').innerText());
    await page.locator('.bn-editor [data-content-type="paragraph"]').last().click();
    await page.keyboard.press('End');
    await page.keyboard.type(' one two three four five six seven eight nine ten', { delay: 15 });
    await wait(1200);
    const w1 = Number(await page.locator('[data-testid="fs-today"]').innerText());
    check(`${T} today's counter counts new words (${w0} -> ${w1})`, w1 - w0 >= 8 && w1 - w0 <= 12);
    check(`${T} the goal is shown`, /goal 500/.test(await page.locator('[data-testid="fs-goal"]').innerText()));
    // the bar fades after typing and comes back on mouse move
    await wait(2300);
    const op = async () => Number(await page.locator('[data-testid="fs-bar"]').evaluate((e) => getComputedStyle(e).opacity));
    check(`${T} the bar fades about 2 seconds after typing`, (await op()) < 0.1);
    await page.mouse.move(400, 300); await page.mouse.move(520, 340); await wait(700);
    check(`${T} the bar comes back when the mouse moves`, (await op()) > 0.9);
    // typewriter + paragraph toggles
    await page.locator('[data-testid="fs-para"]').click(); await wait(300);
    check(`${T} Focus paragraph is on`, (await page.locator('[data-testid="fs-para"]').getAttribute('aria-pressed')) === 'true');
    await page.locator('[data-testid="fs-para"]').click();
    await page.locator('[data-testid="fs-type"]').click(); await wait(200);
    check(`${T} Typewriter mode is on`, (await page.locator('[data-testid="fs-type"]').getAttribute('aria-pressed')) === 'true');
    await page.locator('[data-testid="fs-type"]').click();
    // find
    await page.locator('[data-testid="fs-find"]').click(); await wait(500);
    const finder = page.locator('.pb-find');
    check(`${T} the Find button opens the find box above the page`, await finder.isVisible().catch(() => false));
    const fb = await finder.boundingBox().catch(() => null);
    const top = fb ? await page.evaluate(([x, y]) => { const e = document.elementFromPoint(x, y); return !!e?.closest('.pb-find'); }, [fb.x + fb.width / 2, fb.y + fb.height / 2]) : false;
    check(`${T} the find box is not hidden behind the full-screen page`, top);
    await page.keyboard.press('Escape'); await wait(300);
    check(`${T} Esc in the find box closes only the find box`, (await vis('fs-bar')) && !(await finder.isVisible().catch(() => false)));
    // options
    await page.locator('[data-testid="fs-opts"]').click(); await wait(400);
    const optsSeen = await page.evaluate(() => !!document.querySelector('.s-notes.fs-opts .s-note-head .s-menu-wrap, .o-sheet.fs-opts .o-sheet-head, .r-sheet.fs-opts > .r-eyebrow'));
    check(`${T} Note options bring the usual controls back (share, more menu)`, optsSeen);
    await page.locator('[data-testid="fs-opts"]').click();
    // keep the choices
    await page.reload();
    await page.locator('.bn-editor').waitFor({ timeout: 20000 }); await wait(1200);
    await page.keyboard.press('Control+Shift+F'); await wait(500);
    check(`${T} Ctrl+Shift+F opens full screen`, await vis('fs-bar'));
    const st = await page.evaluate(() => ({ s: getComputedStyle(document.documentElement).getPropertyValue('--fs-size').trim(), w: document.documentElement.getAttribute('data-fs-width'), t: document.documentElement.getAttribute('data-fs-theme') }));
    check(`${T} width, size and theme are remembered after a reload`, st.w === 'wide' && st.s === '19px' && st.t === 'light', JSON.stringify(st));
    await page.keyboard.press('Control+Shift+F'); await wait(400);
    check(`${T} Ctrl+Shift+F closes it again`, !(await vis('fs-bar')));
    await page.keyboard.press('Control+Shift+F'); await wait(400);
    await page.keyboard.press('Escape'); await wait(400);
    check(`${T} Esc leaves full screen`, !(await vis('fs-bar')));
    check(`${T} leaving full screen puts the page back`, await page.evaluate(() => !document.documentElement.hasAttribute('data-fs') && !document.querySelector('.s-notes.focus, .o-sheet.zen, .r-sheet.fs')));
  }
} catch (e) { check('no crash', false, String(e).slice(0, 400)); if (SHOT) await page.screenshot({ path: `${SHOT}/focus-fail.png` }).catch(() => {}); }
await finish();

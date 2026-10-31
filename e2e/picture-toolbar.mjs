// The picture bar: short, anchored to the picture, always inside the note panel (picture at the top, in the middle, partly scrolled off) in Soft, River and Orbit.
import fs from 'fs';
import { boot } from './lib.mjs';
const { base, api, page, check, finish, token } = await boot();
const SHOT = process.env.SHOT_DIR || '';
if (SHOT) fs.mkdirSync(SHOT, { recursive: true });
const WEBP = Buffer.from('UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==', 'base64');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const text = (i) => `Paragraph ${i} sits under the picture and goes on for a good while so that it wraps across a few lines of the note and gives the picture bar something to cover if it is put in the wrong place.`;
const paras = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => text(from + i)).join('\n\n');
try {
  const up = await (await fetch(base + '/api/media', { method: 'POST', headers: { 'Content-Type': 'image/webp', Authorization: `Bearer ${token}` }, body: WEBP })).json();
  const topNote = (await api('POST', '/api/notes', { title: 'Picture at the top', content: `![Top picture](${up.url}#pw=380&ar=1.6)\n\n${paras(1, 14)}\n` })).note;
  const midNote = (await api('POST', '/api/notes', { title: 'Picture in the middle', content: `${paras(1, 7)}\n\n![Middle picture](${up.url}#pw=420&ar=1.4)\n\n${paras(8, 20)}\n` })).note;
  const tallNote = (await api('POST', '/api/notes', { title: 'Tall picture', content: `${paras(1, 3)}\n\n![Tall picture](${up.url}#pw=520&ar=0.62)\n\n${paras(4, 16)}\n` })).note;
  const smallNote = (await api('POST', '/api/notes', { title: 'Small picture', content: `![Small picture](${up.url}#pw=200&ar=1.5)\n\nThe line under the small picture.\n\n${paras(1, 3)}\n` })).note;
  const fnNote = (await api('POST', '/api/notes', { title: 'Picture tools', content: `Intro line.\n\n![Pic](${up.url}#pw=300&ar=1.5)\n\nOutro line.\n` })).note;

  const geo = () => page.evaluate(() => {
    const walk = (el) => { for (let p = el; p && p !== document.body && p !== document.documentElement; p = p.parentElement) { const o = getComputedStyle(p).overflowY; if ((o === 'auto' || o === 'scroll') && p.clientHeight > 0) return p; } return null; };
    const ed = document.querySelector('.bn-editor').closest('.block-editor-container').parentElement;
    const sc = walk(ed); const sr = sc ? sc.getBoundingClientRect() : { top: 0, left: 0, right: innerWidth, bottom: innerHeight };
    const bar = document.querySelector('.bn-toolbar');
    const b = bar ? bar.getBoundingClientRect() : null;
    const wrap = document.querySelector('.bn-visual-media-wrapper img, img.bn-visual-media');
    const ir = wrap ? wrap.getBoundingClientRect() : null;
    const blocks = [...document.querySelectorAll('.bn-block-content[data-content-type="paragraph"]')].map((e) => e.getBoundingClientRect());
    const cs = bar ? getComputedStyle(bar.parentElement) : null;
    return { sc: { top: sr.top, left: sr.left, right: sr.right, bottom: sr.bottom }, bar: b && { x: b.x, y: b.y, w: b.width, h: b.height, r: b.right, b: b.bottom }, vis: cs ? cs.visibility : null, img: ir && { top: ir.top, bottom: ir.bottom, left: ir.left, right: ir.right, w: ir.width }, paras: blocks.map((r) => ({ top: r.top, bottom: r.bottom })), buttons: bar ? bar.querySelectorAll('button').length : 0 };
  });
  const inside = (g) => g.bar && g.bar.x >= g.sc.left - 1 && g.bar.r <= g.sc.right + 1 && g.bar.y >= g.sc.top - 1 && g.bar.b <= g.sc.bottom + 1;
  const open = async (style, id) => {
    await page.goto(base + '/tasks');
    await page.evaluate((v) => localStorage.setItem('peblo-style', v), style);
    await page.goto(base + '/notes/' + id);
    await page.locator('.bn-editor').waitFor({ timeout: 20000 });
    await page.locator('.bn-visual-media-wrapper img, img.bn-visual-media').first().waitFor({ timeout: 10000 }).catch(() => {});
    await wait(1500);
  };
  const clickPic = async () => {
    const l = page.locator('.bn-visual-media-wrapper img').first();
    await l.scrollIntoViewIfNeeded();
    const b = await l.boundingBox();
    await page.mouse.click(b.x + Math.min(40, b.width / 2), b.y + Math.min(40, b.height / 2));
    await page.locator('.bn-toolbar button[data-test="mediumpicture"]').first().waitFor({ timeout: 5000 }).catch(() => {});
    await wait(500);
  };
  const scrollerTo = (fn) => page.evaluate((src) => {
    const walk = (el) => { for (let p = el; p && p !== document.body && p !== document.documentElement; p = p.parentElement) { const o = getComputedStyle(p).overflowY; if ((o === 'auto' || o === 'scroll') && p.clientHeight > 0) return p; } return null; };
    const sc = walk(document.querySelector('.bn-editor').closest('.block-editor-container').parentElement); const img = document.querySelector('.bn-visual-media-wrapper img');
    const r = img.getBoundingClientRect(); const s = sc.getBoundingClientRect();
    sc.scrollTop += new Function('r', 's', `return (${src})(r, s)`)(r, s);
  }, fn.toString());

  for (const style of ['soft', 'river', 'orbit']) {
    const T = `${style}:`;
    await page.setViewportSize({ width: 1440, height: 900 });
    // ---- picture at the top of the note
    await open(style, topNote.id);
    await clickPic();
    let g = await geo();
    check(`${T} top picture: the bar appears`, !!g.bar, JSON.stringify(g).slice(0, 200));
    check(`${T} top picture: the bar is fully inside the note panel`, inside(g), JSON.stringify({ bar: g.bar, sc: g.sc }));
    const firstP = g.paras[0];
    check(`${T} top picture: the bar does not cover the lines under the picture`, !!g.bar && !!firstP && (g.bar.b <= firstP.top + 1 || g.bar.y >= firstP.bottom), JSON.stringify({ bar: g.bar, firstP }));
    check(`${T} the picture bar is short (at most 12 buttons, at most 560px wide)`, g.buttons > 6 && g.buttons <= 12 && g.bar.w <= 560, `${g.buttons} buttons, ${g.bar && Math.round(g.bar.w)}px`);
    if (SHOT) await page.screenshot({ path: `${SHOT}/pic-${style}-top.png` });
    // ---- picture in the middle
    await open(style, midNote.id);
    await clickPic();
    g = await geo();
    check(`${T} middle picture: the bar is inside the panel and above the picture`, inside(g) && g.bar.b <= g.img.top + 1, JSON.stringify({ bar: g.bar, img: g.img, sc: g.sc }));
    const cx = g.bar.x + g.bar.w / 2; const ix = (g.img.left + g.img.right) / 2;
    check(`${T} middle picture: the bar is centred on the picture`, Math.abs(cx - ix) < 40, `${Math.round(cx)} vs ${Math.round(ix)}`);
    if (SHOT) await page.screenshot({ path: `${SHOT}/pic-${style}-middle.png` });
    // ---- picture partly scrolled off the top
    await open(style, tallNote.id);
    await clickPic();
    await scrollerTo((r, s) => r.top - s.top + 140); // the picture top is now 140px above the panel
    await wait(500);
    g = await geo();
    check(`${T} scrolled picture: the picture really is partly above the panel`, g.img.top < g.sc.top - 60 && g.img.bottom > g.sc.top + 100, JSON.stringify({ img: g.img, sc: g.sc }));
    check(`${T} scrolled picture: the bar stays inside the note panel`, inside(g) && g.vis !== 'hidden', JSON.stringify({ bar: g.bar, sc: g.sc, vis: g.vis }));
    if (SHOT) await page.screenshot({ path: `${SHOT}/pic-${style}-scrolled.png` });
    await scrollerTo((r, s) => r.bottom - s.top + 80); // the picture is now fully above the panel
    await wait(500);
    g = await geo();
    check(`${T} scrolled away picture: the bar is hidden, not left over other panels`, !g.bar || g.vis === 'hidden' || g.bar.b < g.sc.top || g.bar.y > g.sc.bottom || inside(g), JSON.stringify({ bar: g.bar, vis: g.vis }));
  }

  // ---- what the bar does (Soft)
  await page.evaluate(() => localStorage.setItem('peblo-style', 'soft'));
  await open('soft', fnNote.id);
  await clickPic();
  const btn = (name) => page.locator(`.bn-toolbar button[data-test="${name}"]`).first();
  const widthOf = () => page.evaluate(() => document.querySelector('.bn-visual-media-wrapper img').getBoundingClientRect().width);
  const w0 = await widthOf();
  check('hooks kept: smallpicture, mediumpicture, largepicture, alignTextLeft, alignTextCenter, alignTextRight', (await Promise.all(['smallpicture', 'mediumpicture', 'largepicture', 'alignTextLeft', 'alignTextCenter', 'alignTextRight'].map((n) => btn(n).isVisible()))).every(Boolean));
  await btn('largepicture').click(); await wait(500);
  const wL = await widthOf();
  await clickPic(); await btn('smallpicture').click(); await wait(500);
  const wS = await widthOf();
  check('size presets change the picture width (S < original < L)', wS < w0 && w0 < wL, `${Math.round(wS)} < ${Math.round(w0)} < ${Math.round(wL)}`);
  await clickPic(); await btn('alignTextRight').click(); await wait(500);
  const side = await page.evaluate(() => { const r = document.querySelector('.bn-visual-media-wrapper img').getBoundingClientRect(); const c = document.querySelector('.bn-editor').getBoundingClientRect(); return { gapR: c.right - r.right, gapL: r.left - c.left }; });
  check('align right puts the picture at the right of the column', side.gapR < 12 && side.gapL > 60, JSON.stringify(side));
  await clickPic(); await btn('alignTextCenter').click(); await wait(500);
  const mid = await page.evaluate(() => { const r = document.querySelector('.bn-visual-media-wrapper img').getBoundingClientRect(); const c = document.querySelector('.bn-editor').getBoundingClientRect(); return Math.abs((r.left + r.right) / 2 - (c.left + c.right) / 2); });
  check('align centre centres the picture', mid < 12, String(mid));
  // caption and alt text
  await clickPic(); await btn('captionandalttext').click();
  await page.locator('[data-testid="pic-caption"]').fill('A caption for the picture');
  await page.keyboard.press('Enter'); await wait(2500);
  let saved = (await api('GET', `/api/notes/${fnNote.id}`)).note.content;
  check('caption and alt text are saved with the picture', /A caption for the picture/.test(saved), saved.slice(0, 200));
  // shape
  await clickPic(); await btn('cropandshape').click(); await btn('cropto16:9').click(); await wait(2500);
  saved = (await api('GET', `/api/notes/${fnNote.id}`)).note.content;
  check('Crop and shape: 16:9 is saved in the note', /ar=1\.778/.test(saved), saved.slice(0, 200));
  // download
  await clickPic();
  const dl = await Promise.all([page.waitForEvent('download', { timeout: 5000 }).catch(() => null), btn('downloadpicture').click()]);
  check('Download picture starts a download', !!dl[0]);
  // replace
  await clickPic();
  const before = await page.locator('.bn-visual-media-wrapper img').first().getAttribute('src');
  await page.locator('[data-testid="pic-replace-input"]').setInputFiles({ name: 'new.webp', mimeType: 'image/webp', buffer: WEBP });
  await wait(2500);
  const after = await page.locator('.bn-visual-media-wrapper img').first().getAttribute('src').catch(() => null);
  check('Replace picture swaps the picture and keeps it in the note', !!after && after !== before, `${before} -> ${after}`);
  // delete
  await clickPic(); await btn('deletepicture').click(); await wait(800);
  check('Delete picture removes it', (await page.locator('.bn-visual-media-wrapper img').count()) === 0);

  // ---- a smaller picture never leaves a strip that swallows typing
  await open('soft', smallNote.id);
  const info = await page.evaluate(() => { const o = document.querySelector('.bn-block-content[data-content-type="image"]').closest('.bn-block-outer'); const i = document.querySelector('.bn-visual-media-wrapper img').getBoundingClientRect(); const r = o.getBoundingClientRect(); return { float: getComputedStyle(o).float, imgRight: i.right, rowRight: r.right, y: i.top + 20 }; });
  check('a smaller picture never floats', info.float === 'none');
  await page.mouse.click(info.imgRight + 120, info.y);
  await wait(300);
  await page.keyboard.type('TYPEDBESIDE');
  await wait(2500);
  saved = (await api('GET', `/api/notes/${smallNote.id}`)).note.content;
  check('clicking the empty strip beside a small picture lets you type on the line below it', /TYPEDBESIDE/.test(saved), saved.slice(0, 260));
  check('the picture is still there after typing beside it', /<img |!\[Small picture\]\(/.test(saved));
} catch (e) { check('no crash', false, String(e).slice(0, 500)); if (SHOT) await page.screenshot({ path: `${SHOT}/pic-fail.png` }).catch(() => {}); }
await finish();

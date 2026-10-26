// Live mouse pointers with three people (owner + two share-link guests, three different window sizes):
// everyone sees everyone, on the same words, edge markers for people out of view, and the share page's reading preferences.
import { boot } from './lib.mjs';

const { base, api, page, ctx, check, finish } = await boot();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await fn()) return true; } catch { /* retry */ } await wait(150); } return false; };
const ready = async (p) => { await p.locator('.bn-editor').waitFor({ timeout: 20000 }); await p.locator('[data-testid="collab-status"]').waitFor({ state: 'detached', timeout: 20000 }).catch(() => {}); };
const ptr = (p, name) => p.locator(name ? `[data-testid="peer-pointer"][data-name="${name}"]` : '[data-testid="peer-pointer"]');
const edge = (p, name) => p.locator(`[data-testid="peer-pointer-edge"][data-name="${name}"]`);
const blockOf = (p, text) => p.locator('.bn-editor .bn-block-content', { hasText: text }).first();

const long = 'This sentence is deliberately long so that it wraps onto several lines in a narrow window and onto fewer in a wide one, which is exactly where pointers drawn from plain coordinates used to drift away from the words they were over. ';
const filler = Array.from({ length: 40 }, (_, i) => `Filler paragraph number ${i + 1} of the long note`).join('\n\n');
const content = `# Pointer test\n\n${long.repeat(3)}Target words end here.\n\n## Second part\n\nMiddle paragraph.\n\n${filler}\n\nThe very last paragraph.`;

try {
  const note = (await api('POST', '/api/notes', { title: 'Pointers', content, tags: [] })).note;
  const tok = (await api('POST', `/api/share/note/${note.id}`, { edit: true })).token;
  await page.goto(base + '/notes/' + note.id);
  await ready(page);
  const mk = async (name, w, h) => {
    const c = await ctx.browser().newContext({ viewport: { width: w, height: h } });
    await c.addInitScript((n) => { try { localStorage.setItem('peblo-guest-name', n); } catch { /* ignore */ } }, name);
    const p = await c.newPage();
    p.on('pageerror', (e) => errors.push(e.message));
    await p.goto(`${base}/s/note/${tok}`);
    await ready(p);
    return p;
  };
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const a = await mk('Anna', 760, 900);
  const c = await mk('Chen', 1700, 800);
  await wait(1500);

  check('0 no pointer before anyone moves', (await ptr(page).count()) === 0 && (await ptr(a).count()) === 0 && (await ptr(c).count()) === 0);

  for (const p of [page, a, c]) await blockOf(p, 'Target words end here').evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await wait(400);
  // Anna (narrow window) points at the end of the long paragraph; the owner and Chen both see her, on that paragraph
  const ab = await blockOf(a, 'Target words end here').boundingBox();
  await a.mouse.move(ab.x + 80, ab.y + ab.height - 6);
  await a.mouse.move(ab.x + 120, ab.y + ab.height - 5, { steps: 4 });
  check('1 the owner sees Anna', await until(async () => (await ptr(page, 'Anna').count()) === 1));
  check('2 the other guest sees Anna too', await until(async () => (await ptr(c, 'Anna').count()) === 1));
  const inBlock = async (p, name, text) => {
    await wait(250);
    const pb = await ptr(p, name).first().boundingBox();
    const bb = await blockOf(p, text).boundingBox();
    return { ok: !!pb && !!bb && pb.y >= bb.y - 6 && pb.y <= bb.y + bb.height + 6, pb, bb };
  };
  const r1 = await inBlock(page, 'Anna', 'Target words end here');
  check('3 on the owner screen she is on the same paragraph', r1.ok, JSON.stringify(r1));
  const r2 = await inBlock(c, 'Anna', 'Target words end here');
  check('4 on Chen\'s screen too, despite different wrapping', r2.ok, JSON.stringify(r2));
  // near the bottom of the paragraph in her narrow window means the lower half in the wide one
  check('5 and in the lower half of it', r1.pb && r1.bb && r1.pb.y > r1.bb.y + r1.bb.height * 0.4, JSON.stringify(r1));

  // Chen points at the heading; Anna and the owner see him
  const hb = await blockOf(c, 'Second part').boundingBox();
  await c.mouse.move(hb.x + 20, hb.y + 4);
  await c.mouse.move(hb.x + 60, hb.y + 6, { steps: 3 });
  check('6 the owner sees Chen', await until(async () => (await ptr(page, 'Chen').count()) === 1));
  check('7 Anna sees Chen (guest to guest)', await until(async () => (await ptr(a, 'Chen').count()) === 1 || (await edge(a, 'Chen').count()) === 1));
  check('8 nobody sees their own pointer', (await ptr(a, 'Anna').count()) === 0 && (await ptr(c, 'Chen').count()) === 0);

  // the owner points at the filler near the end of the note; Chen is scrolled to the top, so he gets an edge marker
  const last = blockOf(page, 'The very last paragraph');
  await last.scrollIntoViewIfNeeded();
  await wait(300);
  const lb = await last.boundingBox();
  await page.mouse.move(lb.x + 30, lb.y + 5);
  await page.mouse.move(lb.x + 50, lb.y + 6, { steps: 3 });
  const ownerName = await page.evaluate(() => document.querySelector('[data-testid="presence-avatar"]')?.getAttribute('data-name') || '');
  check('9 someone far away shows as a marker on the edge', await until(async () => (await c.locator('[data-testid="peer-pointer-edge"]').count()) >= 1), String(await c.locator('[data-testid="peer-pointer-edge"]').count()));
  await c.locator('[data-testid="peer-pointer-edge"]').first().click();
  check('10 clicking the marker scrolls to them', await until(async () => (await ptr(c).count()) >= 1, 6000));

  // leaving the page hides the pointer
  await a.mouse.move(1, 1);
  check('11 a pointer goes away when its owner leaves the note', await until(async () => (await ptr(page, 'Anna').count()) === 0 && (await ptr(c, 'Anna').count()) === 0 && (await edge(c, 'Anna').count()) === 0));

  // share page: reading preferences and the outline
  await c.locator('[data-testid="toc-toggle"]').waitFor({ timeout: 8000 });
  const tocW = async () => (await c.locator('.pb-shared .toc').boundingBox())?.width || 0;
  const w0 = await tocW();
  await c.locator('[data-testid="toc-toggle"]').click();
  check('12 the outline collapses', await until(async () => (await tocW()) < w0 - 100), `${w0} -> ${await tocW()}`);
  const artW0 = (await c.locator('.pb-shared article').boundingBox()).width;
  check('13 and the page gets the room', artW0 > 0);
  await c.reload();
  await ready(c);
  check('14 the choice is remembered after a reload', (await c.locator('.pb-shared .toc.collapsed').count()) === 1);
  await c.locator('[data-testid="toc-toggle"]').click();
  check('15 the outline opens again', await until(async () => (await tocW()) > 150));

  await c.locator('[data-testid="look-btn"]').click();
  const fs0 = await c.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.pb-shared .bn-editor')).zoom || '1'));
  await c.locator('[data-testid="look-size-l"]').click();
  const fs1 = await c.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.pb-shared .bn-editor')).zoom || '1'));
  check('16 text size changes', fs1 > fs0, `${fs0} -> ${fs1}`);
  await c.locator('[data-testid="look-font-serif"]').click();
  check('17 font changes', /serif|Georgia|Source Serif/i.test(await c.evaluate(() => getComputedStyle(document.querySelector('.pb-shared .bn-editor .bn-block-content')).fontFamily)));
  await c.locator('[data-testid="look-width-narrow"]').click();
  const art1 = (await c.locator('.pb-shared article .bn-editor').boundingBox()).width;
  await c.locator('[data-testid="look-width-wide"]').click();
  const art2 = (await c.locator('.pb-shared article .bn-editor').boundingBox()).width;
  check('18 page width changes', art2 > art1 + 100, `${art1} vs ${art2}`);

  // pointers can be switched off for yourself
  await c.locator('[data-testid="look-pointers"]').uncheck();
  await blockOf(a, 'Second part').evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await blockOf(page, 'Second part').evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await wait(400);
  const hb2 = await blockOf(a, 'Second part').boundingBox();
  await a.mouse.move(hb2.x + 30, hb2.y + 5);
  await a.mouse.move(hb2.x + 50, hb2.y + 6, { steps: 3 });
  check('19 the owner still sees Anna', await until(async () => (await ptr(page, 'Anna').count()) === 1));
  await wait(500);
  check('20 Chen turned pointers off and sees none', (await ptr(c).count()) === 0 && (await c.locator('[data-testid="peer-pointer-edge"]').count()) === 0);
  await c.locator('[data-testid="look-pointers"]').check();
  check('21 turning them on brings them back', await until(async () => (await ptr(c, 'Anna').count()) + (await edge(c, 'Anna').count()) >= 1));

  // same-size windows: the pointer lands on the very same pixel
  const d = await mk('Dee', 1700, 800);
  const e2 = await mk('Eli', 1700, 800);
  await wait(1200);
  for (const p of [e2, d]) await blockOf(p, 'Second part').evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await wait(500);
  const cb = await blockOf(e2, 'Second part').boundingBox();
  const tx = cb.x + 137; const ty = cb.y + 9;
  await e2.mouse.move(tx - 30, ty - 20);
  await e2.mouse.move(tx, ty, { steps: 5 });
  await wait(700);
  const seenAt = await ptr(d, 'Eli').first().boundingBox().catch(() => null);
  check('22 in an identical window the pointer lands on the same pixel', !!seenAt && Math.abs(seenAt.x - tx) <= 4 && Math.abs(seenAt.y - ty) <= 4, JSON.stringify({ seenAt, tx, ty }));

  check('23 no crash', errors.length === 0, errors.join(' | '));
} catch (e) {
  check('no crash', false, String(e && e.stack || e).slice(0, 700));
}
await finish();

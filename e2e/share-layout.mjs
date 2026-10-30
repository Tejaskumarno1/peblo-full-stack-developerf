// The owner's picture layout must be kept on the share page: a wide picture is full width with the text below it, never a float that squeezes the text.
import { boot } from './lib.mjs';
const { base, api, page, ctx, check, finish, token } = await boot();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const WEBP = Buffer.from('UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==', 'base64');
try {
  const up = await (await fetch(base + '/api/media', { method: 'POST', headers: { 'Content-Type': 'image/webp', Authorization: `Bearer ${token}` }, body: WEBP })).json();
  const body = 'Words that need room to read properly and should never be squeezed into a thin column beside a picture.';
  const content = `![wide](${up.url}#pw=540)\n\n${body} WIDE\n\n![small](${up.url}#pw=200&ta=left)\n\n${body} SMALL\n`;
  const n = (await api('POST', '/api/notes', { title: 'Layout', content })).note;
  const widths = async (pg) => pg.evaluate(() => {
    const out = {};
    for (const tag of ['WIDE', 'SMALL']) {
      const p = [...document.querySelectorAll('.bn-block-content[data-content-type="paragraph"]')].find((e) => e.textContent.includes(tag));
      out[tag] = p ? p.getBoundingClientRect().width : -1;
    }
    out.col = document.querySelector('.bn-editor')?.clientWidth || 0;
    const w = document.querySelector('[data-preview-width="540"]')?.closest('.bn-block-outer');
    out.cls = w ? w.className : ''; out.pwattr = document.querySelector('[data-preview-width]')?.getAttribute('data-preview-width'); out.wideFloat = w ? getComputedStyle(w).float : 'none?';
    return out;
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(base + '/notes/' + n.id);
  await page.locator('.bn-editor').waitFor({ timeout: 20000 });
  await wait(2000);
  const o = await widths(page);
  console.log('owner', JSON.stringify(o));
  check('owner: text beside pictures keeps a readable width', o.WIDE > 240 && o.SMALL > 240);
  const tok = (await api('POST', `/api/share/note/${n.id}`, { edit: true })).token;
  for (const vw of [1440, 1100, 900]) {
    const g = await ctx.browser().newContext({ viewport: { width: vw, height: 900 } });
    await g.addInitScript(() => { try { localStorage.setItem('peblo-guest-name', 'Pia'); localStorage.setItem('peblo-guest-tour', '1'); } catch {} });
    const gp = await g.newPage();
    await gp.goto(`${base}/s/note/${tok}`);
    await gp.locator('.bn-editor').waitFor({ timeout: 25000 });
    await wait(2500);
    const w = await widths(gp);
    console.log('share', vw, JSON.stringify(w));
    check(`share ${vw}px: text next to pictures is not squeezed`, w.WIDE > 240 && w.SMALL > 240);
    if (w.col && w.col < 540 / 0.66) check(`share ${vw}px: a picture too wide for the column is not floated`, w.wideFloat === 'none');
    await g.close();
  }

  // two pictures side by side (one left, one right) with text below, as on a wide owner screen
  const pair = (await api('POST', '/api/notes', { title: 'Pair', content: `![a](${up.url}#pw=500)\n\n![b](${up.url}#pw=500)\n\nTEXTAFTER ${body}\n` })).note;
  const rects = async (pg) => pg.evaluate(() => {
    const im = [...document.querySelectorAll('.bn-block-content[data-content-type="image"]')].map((e) => e.closest('.bn-block-outer').getBoundingClientRect());
    const t = [...document.querySelectorAll('.bn-block-content')].find((e) => e.textContent.includes('TEXTAFTER'));
    const tr = t ? t.getBoundingClientRect() : null;
    return { a: im[0] && [Math.round(im[0].left), Math.round(im[0].top), Math.round(im[0].width)], b: im[1] && [Math.round(im[1].left), Math.round(im[1].top), Math.round(im[1].width)], text: tr && [Math.round(tr.left), Math.round(tr.top), Math.round(tr.width)], col: document.querySelector('.bn-editor').clientWidth };
  });
  await page.setViewportSize({ width: 1920, height: 1000 });
  await page.goto(base + '/notes/' + pair.id);
  await page.locator('.bn-editor').waitFor({ timeout: 20000 });
  await wait(2500);
  const po = await rects(page); console.log('pair owner', JSON.stringify(po));
  check('pair owner: two pictures each on their own row', po.a && po.b && po.b[1] > po.a[1]);
  const ptok = (await api('POST', `/api/share/note/${pair.id}`, { edit: true })).token;
  for (const vw of [1920, 1100]) {
    const g = await ctx.browser().newContext({ viewport: { width: vw, height: 1000 } });
    await g.addInitScript(() => { try { localStorage.setItem('peblo-guest-name', 'Pia'); localStorage.setItem('peblo-guest-tour', '1'); } catch {} });
    const gp = await g.newPage();
    await gp.goto(`${base}/s/note/${ptok}`);
    await gp.locator('.bn-editor').waitFor({ timeout: 25000 });
    await wait(2500);
    const r = await rects(gp); console.log('pair share', vw, JSON.stringify(r));
    if (vw >= 1500) check(`pair share ${vw}px: pictures each on their own row like the owner's page`, r.a && r.b && r.b[1] > r.a[1]);
    else check(`pair share ${vw}px: in a narrow column the pictures stack, each fully visible`, r.a && r.b && r.a[2] <= r.col && r.b[2] <= r.col);
    check(`pair share ${vw}px: the text below them is full width, not a sliver`, r.text && r.text[2] > 240);
    await g.close();
  }
} catch (e) { console.log('FAIL', e); process.exitCode = 1; }
await finish();

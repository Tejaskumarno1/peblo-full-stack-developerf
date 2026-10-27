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
} catch (e) { console.log('FAIL', e); process.exitCode = 1; }
await finish();

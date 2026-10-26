// Share page fixes: long titles wrap, a repeated first heading stays out of the way, presenting tools do not cover the text.
import { boot } from './lib.mjs';

const { base, api, page, ctx, check, finish } = await boot();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await fn()) return true; } catch { /* retry */ } await wait(150); } return false; };
const ready = async (p) => { await p.locator('.bn-editor').waitFor({ timeout: 20000 }); await p.locator('[data-testid="collab-status"]').waitFor({ state: 'detached', timeout: 20000 }).catch(() => {}); await wait(1200); };

try {
  const title = 'Database normalization and the relational model: a long worked example for the exam';
  const md = `## ${title}\n\nNormalization removes redundancy.\n\n## Why it matters\n\n- Fewer anomalies\n\n## Practice\n\nSplit the relation.`;
  const note = (await api('POST', '/api/notes', { title, content: md, tags: [] })).note;
  const edit = (await api('POST', `/api/share/note/${note.id}`, { edit: true })).token;
  await page.goto(base + '/notes/' + note.id);
  await ready(page);
  const errors = [];
  for (const [vw, vh, tag] of [[1280, 800, 'desktop'], [390, 844, 'phone']]) {
    const c = await ctx.browser().newContext({ viewport: { width: vw, height: vh } });
    await c.addInitScript(() => { try { localStorage.setItem('peblo-guest-name', 'Aarav'); } catch {} });
    const g = await c.newPage();
    g.on('pageerror', (e) => errors.push(e.message));
    await g.goto(`${base}/s/note/${edit}`);
    await ready(g);
    const t = await g.getByLabel('Title').evaluate((el) => { const a = el.closest('article').getBoundingClientRect(); const r = el.getBoundingClientRect(); return { h: r.height, lines: Math.round(r.height / parseFloat(getComputedStyle(el).lineHeight)), clipped: el.scrollHeight > el.clientHeight + 2, inside: r.right <= a.right + 1, full: el.value }; });
    check(`1 ${tag}: a long title wraps to several lines`, t.lines >= 2, JSON.stringify(t));
    check(`1b ${tag}: nothing is cut off`, !t.clipped && t.inside && t.full === title, JSON.stringify(t));
    const dup = await g.evaluate(() => { const f = document.querySelector('.pb-shared .bn-editor .bn-block-outer'); return f ? { cls: f.className, h: f.getBoundingClientRect().height } : null; });
    check(`2 ${tag}: the repeated first heading is hidden`, !!dup && dup.h < 2, JSON.stringify(dup));
    const outline = await g.locator('.pb-shared .toc a').allTextContents();
    check(`2b ${tag}: the outline does not list the title`, !outline.some((x) => x.trim() === title), outline.join(' | '));
    await g.getByLabel('Title').fill('Short title');
    check(`1c ${tag}: editing the title still works`, (await g.getByLabel('Title').inputValue()) === 'Short title');
    await g.getByLabel('Title').fill(title);
    await g.locator('.bn-editor .bn-block-content', { hasText: 'Normalization removes' }).first().click({ timeout: 6000 });
    await g.locator('[data-testid="present-btn"]').click(); await g.locator('[data-testid="present-go"]').click();
    await g.locator('[data-testid="presenting-banner"]').waitFor({ timeout: 6000 });
    const o = await g.evaluate(() => {
      const bar = document.querySelector('[data-testid="presenting-banner"]').getBoundingClientRect();
      const blocks = [...document.querySelectorAll('.bn-editor .bn-block-outer')].filter((b) => b.getBoundingClientRect().height > 2);
      const top = Math.min(...blocks.map((b) => b.getBoundingClientRect().top));
      return { barTop: Math.round(bar.top), barBottom: Math.round(bar.bottom), textTop: Math.round(top), vh: innerHeight };
    });
    check(`3 ${tag}: the presenting dock floats at the bottom, and the first line of text starts above it`, o.barTop >= o.vh - 160 && o.barBottom <= o.vh && o.textTop < o.barTop, JSON.stringify(o));
    await c.close();
  }
  // a view-only link
  const view = (await api('POST', `/api/share/note/${note.id}`, { edit: false })).token;
  const v = await (await ctx.browser().newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  await v.goto(`${base}/s/note/${view}`);
  await v.locator('.doc').waitFor({ timeout: 15000 });
  const heads = await v.locator('.doc h1, .doc h2').allTextContents();
  check('4 a view-only page does not repeat the title as a heading', !heads.some((x) => x.trim() === title), heads.join(' | '));
  check('5 no crash', errors.length === 0, errors.join(' | '));
} catch (e) {
  check('crash: ' + e.message.slice(0, 1800), false);
}
await finish();

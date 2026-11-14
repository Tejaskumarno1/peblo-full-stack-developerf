import { boot } from './lib.mjs';
const { base, api, ctx, check, finish } = await boot({ freshGuest: true });
try {
  const n = await api('POST', '/api/notes', { title: 'Probe', content: '<p>hello</p>' });
  const note = n.note || n;
  const tok = (await api('POST', `/api/share/note/${note.id}`, { edit: true })).token;
  for (const w of [1000, 900, 820, 760, 701, 640]) {
    const c = await ctx.browser().newContext({ viewport: { width: w, height: 900 } });
    await c.addInitScript(() => { try { localStorage.setItem('peblo-guest-joined', '1'); localStorage.setItem('peblo-spaces-tip', '1'); } catch {} });
    const p = await c.newPage();
    await p.goto(`${base}/s/note/${tok}`);
    await p.locator('[data-testid="join-anon"]').click({ timeout: 2500 }).catch(() => {});
    await p.waitForTimeout(1500);
    const r = await p.evaluate(() => {
      const o = [];
      document.querySelectorAll('.pb-shared .top, .pb-shared .top *').forEach((e) => { const b = e.getBoundingClientRect(); if (b.width && (b.right > innerWidth - 2)) o.push(`${e.tagName}.${(e.getAttribute('class') || '').toString().slice(0, 30)} r=${Math.round(b.right)} w=${Math.round(b.width)}`); });
      const top = document.querySelector('.pb-shared .top'); const tb = top && top.getBoundingClientRect();
      return { iw: innerWidth, top: tb && [Math.round(tb.left), Math.round(tb.right)], o: o.slice(0, 8) };
    });
    console.log(w, JSON.stringify(r));
    await c.close();
  }
} catch (e) { check('run ' + e.message, false); }
await finish();

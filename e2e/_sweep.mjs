// Visual sweep of the public share pages: screenshots + overflow checks at several widths in light and dark.
import fs from 'fs';
import { boot } from './lib.mjs';
const { base, api, ctx, check, finish } = await boot({ freshGuest: true });
const out = 'D:\\Peblo\\_shots\\sweep'; fs.mkdirSync(out, { recursive: true });
try {
  const n = await api('POST', '/api/notes', { title: 'Sweep note', content: '<h2>Heading</h2><p>Some body text with a <a href="https://example.com">link</a>.</p><ul><li>one</li><li>two</li></ul><pre><code>const a = 1;</code></pre>' });
  const note = n.note || n;
  const t = await api('POST', '/api/todos', { text: 'Sweep to-do', priority: 'high' });
  const todo = t.todo || t;
  const nt = (await api('POST', `/api/share/note/${note.id}`, { edit: true })).token;
  const tt = (await api('POST', `/api/share/todo/${todo.id}`, { edit: true })).token;
  check('tokens', !!nt && !!tt, JSON.stringify({ nt, tt, n: Object.keys(n) }));
  const sizes = [[1366, 800], [1700, 900], [820, 1100], [390, 800]];
  for (const kind of ['note', 'todo']) for (const dark of [false, true]) for (const [w, h] of sizes) {
    const c = await ctx.browser().newContext({ viewport: { width: w, height: h }, colorScheme: dark ? 'dark' : 'light' });
    await c.addInitScript((d) => { try { localStorage.setItem('peblo-guest-joined', '1'); localStorage.setItem('peblo-spaces-tip', '1'); if (d) { localStorage.setItem('peblo-theme', 'dark'); } } catch {} }, dark);
    const p = await c.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await p.goto(`${base}/s/${kind}/${kind === 'note' ? nt : tt}`);
    await p.locator('[data-testid="join-anon"]').click({ timeout: 4000 }).catch(() => {});
    await p.waitForTimeout(1800);
    const r = await p.evaluate(() => {
      const de = document.documentElement; const bad = [];
      document.querySelectorAll('.pb-shared *').forEach((e) => { const b = e.getBoundingClientRect(); if (b.width > 0 && b.right > innerWidth + 1 && getComputedStyle(e).position !== 'fixed' && !e.closest('[hidden]') && !e.closest('.blobs')) bad.push((e.className || e.tagName).toString().slice(0, 40)); });
      return { hscroll: de.scrollWidth > innerWidth + 1, bad: [...new Set(bad)].slice(0, 6), theme: document.querySelector('.pb-shared')?.getAttribute('data-theme') };
    });
    const tag = `${kind}-${dark ? 'dark' : 'light'}-${w}`;
    await p.screenshot({ path: `${out}\\${tag}.png` });
    check(`${tag} no hscroll/overflow (theme=${r.theme})`, !r.hscroll && r.bad.length === 0, JSON.stringify(r));
    check(`${tag} no page errors`, errs.length === 0, errs.join('|'));
    await c.close();
  }
} catch (e) { check('run ' + e.message, false); }
await finish();


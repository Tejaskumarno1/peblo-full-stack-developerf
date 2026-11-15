// Walk the public share pages (note + todo) in light/dark at several widths; screenshot + collect layout problems.
import { boot } from './lib.mjs';
import fs from 'fs';
const OUT = 'D:\\Peblo\\_shots\\sharewalk'; fs.mkdirSync(OUT, { recursive: true });
const { base, api, ctx, finish } = await boot();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  const content = '# Walkthrough\n\nIntro paragraph with **bold**, a [link](https://example.com) and `code`.\n\n## Section one\n\n- item a\n- item b\n\n> A quote\n\n## Section two\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n### Deep\n\nMore text '.concat('lorem ipsum '.repeat(60));
  const n = (await api('POST', '/api/notes', { title: 'Share walk', content })).note;
  const ntok = (await api('POST', `/api/share/note/${n.id}`, {})).token;
  const tr = await api('POST', '/api/todos', { text: 'Share walk task', priority: 'high' });
  const t = tr.todo || tr;
  let ttok = null;
  for (const u of [`/api/share/todo/${t.id}`]) { const r = await api('POST', u, {}); if (r.token) { ttok = r.token; break; } }
  console.log('tokens', ntok, ttok, JSON.stringify(tr).slice(0, 120));
  const sizes = [[1366, 768], [1720, 960], [820, 1100], [390, 844]];
  for (const dark of [false, true]) for (const [w, h] of sizes) for (const [kind, tok] of [['note', ntok], ['todo', ttok]]) {
    if (!tok) continue;
    const c = await ctx.browser().newContext({ viewport: { width: w, height: h }, colorScheme: dark ? 'dark' : 'light' });
    await c.addInitScript((d) => { try { localStorage.setItem('peblo-guest-name', 'Pia'); localStorage.setItem('peblo-guest-tour', '1'); if (d) localStorage.setItem('peblo-theme', 'dark'); } catch {} }, dark);
    const p = await c.newPage(); const errs = [];
    p.on('pageerror', (e) => errs.push(e.message));
    await p.goto(`${base}/s/${kind}/${tok}`); await wait(3000);
    const m = await p.evaluate(() => {
      const o = { hscroll: document.documentElement.scrollWidth > innerWidth + 1, small: [], lowc: [] };
      const lum = (s) => { const m = s.match(/[\d.]+/g)?.map(Number); if (!m) return null; const f = (v) => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }; return .2126 * f(m[0]) + .7152 * f(m[1]) + .0722 * f(m[2]); };
      const bgOf = (e) => { for (let x = e; x; x = x.parentElement) { const b = getComputedStyle(x).backgroundColor; if (b && !/rgba\(.*, 0\)|transparent/.test(b)) return b; } return 'rgb(255,255,255)'; };
      for (const e of document.querySelectorAll('button,a,[role=button],input')) { const r = e.getBoundingClientRect(); if (r.width && r.height && (r.width < 24 || r.height < 24) && r.bottom > 0 && r.top < innerHeight) o.small.push((e.className || e.tagName).toString().slice(0, 40) + ` ${Math.round(r.width)}x${Math.round(r.height)}`); if (r.right > innerWidth + 1 && r.width) o.small.push('OVERFLOW ' + (e.className || e.tagName).toString().slice(0, 40)); }
      for (const e of document.querySelectorAll('p,li,h1,h2,h3,span,a,button,label,td')) { if (![...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue; const r = e.getBoundingClientRect(); if (!r.width || r.bottom < 0 || r.top > innerHeight) continue; const cs = getComputedStyle(e); const a = lum(cs.color), b = lum(bgOf(e)); if (a == null || b == null) continue; const cr = (Math.max(a, b) + .05) / (Math.min(a, b) + .05); if (cr < 3.5 && parseFloat(cs.opacity) > .5) o.lowc.push(`${cr.toFixed(1)} ${e.className?.toString().slice(0, 30)} "${e.textContent.trim().slice(0, 20)}"`); }
      return o;
    });
    const tag = `${kind}-${dark ? 'dark' : 'light'}-${w}`;
    await p.screenshot({ path: `${OUT}\\${tag}.png` });
    console.log(tag, JSON.stringify({ ...m, small: m.small.slice(0, 8), lowc: [...new Set(m.lowc)].slice(0, 8), errs }));
    await c.close();
  }
} catch (e) { console.log('ERR', e); }
await finish();


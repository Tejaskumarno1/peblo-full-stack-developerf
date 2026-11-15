// QA sweep (not a suite): screenshots both share pages across themes and widths, and reports overflow / tiny text / low contrast.
import fs from 'fs';
import { boot } from './lib.mjs';
const { base, api, ctx, check, finish } = await boot();
const OUT = 'D:/Peblo/_shots/sweep'; fs.mkdirSync(OUT, { recursive: true });
const sizes = [['1366', 1366, 768], ['1720', 1720, 960], ['tablet', 820, 1100], ['phone', 390, 800]];
const findings = [];
try {
  const body = '# Launch plan\n\nIntro paragraph with a [link](https://example.com) and **bold** text.\n\n## Goals\n\n- First goal\n- Second goal\n- [ ] A check item\n\n> A quoted line to check contrast.\n\n## Code\n\n```js\nconst a = 1;\n```\n\n## Table\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n' + 'Filler line for scrolling.\n\n'.repeat(25) + '## End\n\nDone.';
  const note = (await api('POST', '/api/notes', { title: 'QA note', content: body, tags: ['qa'] })).note;
  const ntok = (await api('POST', `/api/share/note/${note.id}`, { edit: false, expiresInDays: 1 })).token;
  const todo = (await api('POST', '/api/todos', { text: 'Send the Q4 report', priority: 'high' }));
  const t = todo.todo || todo.task || todo;
  const ttok = (await api('POST', `/api/share/todo/${t.id}`, { edit: false })).token;
  console.log('tokens', !!ntok, !!ttok);
  for (const [kind, tok] of [['note', ntok], ['todo', ttok]]) {
    if (!tok) { findings.push(`${kind}: no token`); continue; }
    for (const dark of [false, true]) for (const [label, w, h] of sizes) {
      const c = await ctx.browser().newContext({ viewport: { width: w, height: h } });
      await c.addInitScript((d) => { try { localStorage.setItem('peblo-guest-joined', '1'); if (d) document.documentElement.classList.add('theme-dark'); } catch {} }, dark);
      const p = await c.newPage(); const errs = [];
      p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
      await p.goto(`${base}/s/${kind}/${tok}`); await p.waitForTimeout(1800); if (dark) { await p.keyboard.press('Control+j'); await p.waitForTimeout(500); }
      const m = await p.evaluate(() => {
        const de = document.documentElement; const out = { hscroll: de.scrollWidth > innerWidth + 1, small: [], clipped: [], lowc: [] };
        const lum = (rgb) => { const [r, g, b] = rgb.map((v) => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }); return .2126 * r + .7152 * g + .0722 * b; };
        const parse = (s) => (s.match(/[\d.]+/g) || []).map(Number);
        const bgOf = (el) => { for (let e = el; e; e = e.parentElement) { const v = parse(getComputedStyle(e).backgroundColor); if (v.length >= 3 && (v[3] === undefined || v[3] > .9)) return v; } return [255, 255, 255]; };
        for (const el of document.querySelectorAll('body *')) {
          if (!el.childNodes.length || ![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
          const r = el.getBoundingClientRect(); if (!r.width || !r.height) continue; const cs = getComputedStyle(el); if (cs.visibility === 'hidden' || cs.opacity === '0') continue;
          const fs = parseFloat(cs.fontSize); const txt = el.textContent.trim().slice(0, 30);
          if (fs < 11) out.small.push(`${el.tagName}.${el.className} ${fs}px "${txt}"`);
          if (r.right > innerWidth + 1 || r.left < -1) out.clipped.push(`${el.tagName}.${String(el.className).slice(0, 30)} "${txt}"`);
          const fg = parse(cs.color), bg = bgOf(el); const L1 = lum(fg), L2 = lum(bg); const cr = (Math.max(L1, L2) + .05) / (Math.min(L1, L2) + .05);
          if (cr < 3.5 && (fg[3] === undefined || fg[3] > .5)) out.lowc.push(`${cr.toFixed(1)} ${el.tagName}.${String(el.className).slice(0, 25)} "${txt}"`);
        }
        out.dark = getComputedStyle(document.querySelector('.pb-shared')).backgroundColor + '|' + getComputedStyle(document.body).backgroundColor;
        return out;
      });
      const name = `${kind}-${label}-${dark ? 'dark' : 'light'}`;
      await p.screenshot({ path: `${OUT}/${name}.png` });
      const f = [m.hscroll && 'HSCROLL', ...m.small.slice(0, 5).map((s) => 'small ' + s), ...m.clipped.slice(0, 5).map((s) => 'clipped ' + s), ...m.lowc.slice(0, 8).map((s) => 'lowc ' + s), ...errs.slice(0, 3).map((e) => 'err ' + e)].filter(Boolean);
      console.log(name, 'dark=' + m.dark, f.length ? '\n   ' + f.join('\n   ') : 'ok');
      await c.close();
    }
  }
  console.log('FINDINGS', findings);
} catch (e) { console.log('SWEEP ERROR', e.message); }
await finish();


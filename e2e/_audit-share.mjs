// Scratch audit (not committed): walk the public share pages across widths and themes, screenshot, and flag layout / contrast problems.
import fs from 'fs';
import { boot } from './lib.mjs';
const { base, api, ctx, check, finish, token } = await boot({ freshGuest: true });
const OUT = 'D:/Peblo/_shots/audit'; fs.mkdirSync(OUT, { recursive: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const WEBP = Buffer.from('UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==', 'base64');
const findings = [];
const AUDIT = () => {
  const out = { overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth, tiny: [], lowContrast: [], clipped: [], emoji: [] };
  const parse = (c) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const [r, g, b, a = 1] = m[1].split(/[ ,\/]+/).map(Number); return { r, g, b, a }; };
  const lum = ({ r, g, b }) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const bgOf = (el) => { let e = el; while (e) { const c = parse(getComputedStyle(e).backgroundColor); if (c && c.a > 0.9) return c; e = e.parentElement; } return { r: 255, g: 255, b: 255 }; };
  const label = (e) => (e.getAttribute('aria-label') || e.getAttribute('data-testid') || e.textContent.trim().slice(0, 24) || e.className.toString().slice(0, 24));
  for (const b of document.querySelectorAll('.pb-shared button, .pb-shared a, .pb-shared [role=button]')) {
    const r = b.getBoundingClientRect(); if (r.width === 0 || r.height === 0) continue;
    if (r.width < 24 || r.height < 24) out.tiny.push(label(b) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
  }
  const seen = new Set();
  for (const e of document.querySelectorAll('.pb-shared *')) {
    if (![...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
    const r = e.getBoundingClientRect(); if (r.width === 0 || r.height === 0) continue;
    const cs = getComputedStyle(e); if (cs.visibility === 'hidden' || cs.opacity === '0') continue;
    const fg = parse(cs.color); const bg = bgOf(e); if (!fg) continue;
    const fgl = lum(fg), bgl = lum(bg); const ratio = (Math.max(fgl, bgl) + 0.05) / (Math.min(fgl, bgl) + 0.05);
    const size = parseFloat(cs.fontSize);
    if (ratio < (size >= 18 ? 3 : 4.5) && !seen.has(label(e))) { seen.add(label(e)); out.lowContrast.push(`${label(e)} ${ratio.toFixed(2)} (${cs.color} on rgb(${bg.r},${bg.g},${bg.b}))`); }
    if (r.right > innerWidth + 1 || r.left < -1) out.clipped.push(label(e) + ' ' + Math.round(r.left) + '..' + Math.round(r.right));
    if (/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(e.textContent) && e.children.length === 0) out.emoji.push(label(e));
  }
  for (const k of ['tiny', 'lowContrast', 'clipped', 'emoji']) out[k] = out[k].slice(0, 12);
  return out;
};
try {
  const up = await (await fetch(base + '/api/media', { method: 'POST', headers: { 'Content-Type': 'image/webp', Authorization: `Bearer ${token}` }, body: WEBP })).json();
  const content = '## Intro\n\nA real note with **bold**, _italic_, a [link](https://example.com) and a list:\n\n- first\n- second\n\n## Table\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n![pic](' + up.url + '#pw=300)\n\n' + Array.from({ length: 16 }, (_, i) => `Paragraph ${i + 1} about normal forms, keys and joins that is long enough to wrap onto a second line on a phone screen.`).join('\n\n') + '\n\n## End\n\n> A quote\n\n```js\nconst x = 1;\n```\n';
  const note = (await api('POST', '/api/notes', { title: 'Audit note', content })).note;
  const ntok = (await api('POST', `/api/share/note/${note.id}`, { edit: true })).token;
  const todo = await api('POST', '/api/todos', { text: 'Send the Q4 report', priority: 'high' });
  const t = todo.todo || todo;
  const ttok = (await api('POST', `/api/share/todo/${t.id}`, { edit: true })).token;
  const sizes = { d1366: [1366, 768], d1720: [1720, 940], tab: [820, 1100], phone: [390, 780] };
  for (const [kind, tok] of [['note', ntok], ['todo', ttok]]) for (const [sn, [w, h]] of Object.entries(sizes)) for (const dark of [false, true]) {
    const mobile = sn === 'phone';
    const c = await ctx.browser().newContext({ viewport: { width: w, height: h }, isMobile: mobile, hasTouch: mobile || sn === 'tab' });
    await c.addInitScript(() => { try { localStorage.setItem('peblo-guest-name', 'Pia'); localStorage.setItem('peblo-guest-tour', '1'); localStorage.setItem('peblo-guest-joined', '1'); } catch {} });
    const p = await c.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
    await p.goto(`${base}/s/${kind}/${tok}`);
    await p.locator('[data-testid="join-anon"]').click({ timeout: 3000 }).catch(() => {});
    await p.locator(kind === 'note' ? '.bn-editor, article .doc' : '[data-testid="todo-about"], .taskcard').first().waitFor({ timeout: 25000 });
    await wait(2200);
    if (dark) { const m = p.locator('[data-testid="moon-btn"]'); if (await m.isVisible().catch(() => false)) await m.click(); else await p.evaluate(() => document.querySelector('.pb-shared')?.setAttribute('data-theme', 'dark')); await wait(500); }
    const tag = `${kind}-${sn}-${dark ? 'dark' : 'light'}`;
    await p.screenshot({ path: `${OUT}/${tag}.png` });
    const a = await p.evaluate(AUDIT);
    a.errs = errs.slice(0, 3); findings.push({ tag, ...a });
    await c.close();
  }
  fs.writeFileSync(`${OUT}/findings.json`, JSON.stringify(findings, null, 1));
  for (const f of findings) console.log(f.tag, 'overflowX=' + f.overflowX, 'tiny=' + f.tiny.length, 'contrast=' + f.lowContrast.length, 'clipped=' + f.clipped.length, 'emoji=' + f.emoji.length, 'errs=' + f.errs.length);
} catch (e) { check('run ' + e.message, false); console.log(e.stack); }
await finish();

// Responsive smoke: phone/tablet/desktop viewports x UI styles x main screens.
// Asserts no horizontal page scroll, no fixed element hanging out of the viewport, no console/React errors,
// reachable >=32px-tall controls on phones, and header text that is cut off without an ellipsis.
//
// IMPORTANT design fact: the signed-in app is a fixed >=1440x900 "design canvas" (styles/canvas.css) that the desktop
// shell scales to fit the window. In a browser smaller than that the canvas is simply clipped, so signed-in screens
// below 1440 wide are reported as CANVAS (known, by design) and counted as pass unless STRICT_CANVAS=1.
// The pages that really are responsive web pages (shared page, sign in / create account, verify e-mail) are fully checked.
//
// Env: STYLES=soft,river,orbit  VIEWPORTS=360x740,...  ONLY=home,notes  STRICT_CANVAS=1
//      CHROME_PATH=<msedge.exe>  to run the same matrix in another Chromium browser
//      EXTRA_CSS=a.css,b.css  (paths relative to the repo) injected after load, to try a CSS fix without rebuilding
// Failure screenshots are written to e2e/resp-*.png (git-ignored).
import path from 'path';
import fs from 'fs';
import zlib from 'zlib';
import { boot, REPO } from './lib.mjs';

const { base, api, ctx: bootCtx, check, finish, token } = await boot();
const browser = bootCtx.browser();
const VIEWPORTS = (process.env.VIEWPORTS || '360x740,390x844,768x1024,1280x800,1440x900').split(',').map((s) => s.split('x').map(Number));
const STYLES = (process.env.STYLES || 'soft,river,orbit,console').split(',');
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null;
const EXTRA_CSS = (process.env.EXTRA_CSS || '').split(',').filter(Boolean).map((f) => fs.readFileSync(path.join(REPO, f), 'utf8')).join('\n');
const results = [];
const detail = [];

// a wide solid-colour PNG so a picture bigger than any phone is on the page
function png(w, h) {
  const crc = (buf) => { let c, v = 0xffffffff; for (let n = 0; n < buf.length; n++) { c = (v ^ buf[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; v = (v >>> 8) ^ c; } return (v ^ 0xffffffff) >>> 0; };
  const chunk = (t, d) => { const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const row = Buffer.alloc(1 + w * 3); for (let x = 0; x < w; x++) { row[1 + x * 3] = 90; row[2 + x * 3] = 140; row[3 + x * 3] = 220; }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.concat(Array.from({ length: h }, () => row)))), chunk('IEND', Buffer.alloc(0))]);
}

// ---- seed
const up = await fetch(base + '/api/media', { method: 'POST', headers: { 'Content-Type': 'image/png', Authorization: `Bearer ${token}` }, body: png(1600, 500) });
const pic = (await up.json().catch(() => ({}))).url || '';
if (!pic) console.log('note: picture upload failed', up.status);
const longWord = 'Supercalifragilisticexpialidocious_unbroken_token_' + 'x'.repeat(60);
const table = '| Board | Feature | Owner | Status | Estimate | Notes |\n| --- | --- | --- | --- | --- | --- |\n' +
  Array.from({ length: 4 }, (_, i) => `| ${20 + i} | Session setup and long feature name number ${i} | Somebody Long-Name | In progress | 3 weeks | A longer note cell that wraps a lot on a phone screen |`).join('\n') + '\n';
const note = (await api('POST', '/api/notes', { title: 'Responsive check note with a rather long title to test header wrapping', tags: ['resp'], content: `# Heading\n\nIntro ${longWord}\n\n${pic ? `![wide](${pic})\n\n` : ''}${table}\n- [ ] a task\n\n\`\`\`\nconst aVeryLongLineOfCode = "${'y'.repeat(120)}";\n\`\`\`\n` })).note;
for (let i = 0; i < 4; i++) await api('POST', '/api/notes', { title: `Filler note ${i} with a long enough title to need truncating on narrow screens`, content: 'body '.repeat(30), tags: ['resp'] });
for (const t of ['Buy zebra food with a really long task title that needs to wrap on phones nicely', 'Short task']) await api('POST', '/api/todos', { text: t, priority: 'high', deadline: new Date().toISOString() });
const shareTok = (await api('POST', `/api/share/note/${note.id}`, { edit: false })).token;

const SCREENS = [
  { id: 'home', url: '/' },
  { id: 'notes', url: '/notes' },
  { id: 'note', url: `/notes/${note.id}`, wait: '.bn-editor, .ProseMirror, [contenteditable]' },
  { id: 'tasks', url: '/tasks' },
  { id: 'calendar', url: '/calendar' },
  { id: 'ai', url: '/ai' },
  { id: 'settings', url: '/settings/profile' },
  { id: 'shared', url: `/s/note/${shareTok}`, guest: true, web: true },
  { id: 'login', url: '/', guest: true, web: true },
  { id: 'signup', url: '/', guest: true, web: true, signup: true },
  { id: 'verify', url: '/verify-email', guest: true, web: true },
].filter((s) => !ONLY || ONLY.includes(s.id));

// runs inside the page
const audit = (phone) => {
  const out = { canvas: null, hscroll: null, fixed: [], tiny: [], clipped: [], offscreen: [] };
  const de = document.documentElement, W = window.innerWidth, H = window.innerHeight;
  const rootEl = document.getElementById('root');
  if (rootEl && rootEl.clientWidth > W + 1 && !document.querySelector('.pb-shared, .pb-auth, .ve-page')) out.canvas = `canvas ${rootEl.clientWidth}px wide in a ${W}px window`;
  if (de.scrollWidth > W + 1) {
    const culprits = [];
    for (const el of document.body.querySelectorAll('*')) { const r = el.getBoundingClientRect(); if (r.width && r.right > W + 1 && getComputedStyle(el).position !== 'fixed') culprits.push(`${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]} right=${Math.round(r.right)}`); if (culprits.length > 6) break; }
    out.hscroll = `scrollWidth ${de.scrollWidth} > ${W}; ${culprits.slice(0, 4).join(', ')}`;
  }
  const desc = (el) => `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}.${String(el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className).trim().split(/\s+/).slice(0, 2).join('.')}`;
  const visible = (r, cs) => r.width > 1 && r.height > 1 && cs.visibility !== 'hidden' && cs.display !== 'none' && parseFloat(cs.opacity) > 0.05;
  for (const el of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(el);
    if (cs.position !== 'fixed') continue;
    const r = el.getBoundingClientRect();
    if (!visible(r, cs)) continue;
    const inter = r.right > 0 && r.left < W && r.bottom > 0 && r.top < H;
    const over = r.right > W + 1 || r.left < -1 || r.bottom > H + 1 || r.top < -1;
    if (inter && over && !el.closest('[aria-hidden="true"]')) out.fixed.push(`${desc(el)} [${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)}] vp ${W}x${H}`);
  }
  if (phone) {
    const seen = new Set();
    for (const el of document.querySelectorAll('button, a[href], [role=button], [role=tab], [role=menuitem], input:not([type=hidden]), select, textarea')) {
      if (el.closest('.bn-editor, .ProseMirror')) continue;
      const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
      if (!visible(r, cs) || el.disabled || el.closest('[inert]')) continue;
      if (r.bottom < 0 || r.top > H) continue; // below the fold is reachable by scrolling
      if (r.right > W + 1 || r.left < -1) { out.offscreen.push(`${desc(el)} ${Math.round(r.left)}..${Math.round(r.right)} "${(el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 20)}"`); continue; }
      if (r.height < 31.5) { const k = desc(el); if (!seen.has(k)) { seen.add(k); out.tiny.push(`${k} ${Math.round(r.width)}x${Math.round(r.height)} "${(el.getAttribute('aria-label') || el.textContent || el.placeholder || '').trim().slice(0, 24)}"`); } }
    }
  }
  const seenC = new Set();
  for (const el of document.querySelectorAll('h1, h2, h3, header *, [class*="title"], [class*="Title"], [role=heading]')) {
    if (el.closest('.bn-editor, .ProseMirror') || /(^|\s|-)sr(-only)?(\s|$)/.test(String(el.className))) continue;
    const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
    if (!visible(r, cs) || !el.textContent.trim()) continue;
    const clipX = el.scrollWidth > el.clientWidth + 2 && ['hidden', 'clip'].includes(cs.overflowX) && cs.textOverflow !== 'ellipsis' && el.clientWidth > 0;
    const clipY = el.scrollHeight > el.clientHeight + 3 && ['hidden', 'clip'].includes(cs.overflowY) && cs.display !== 'inline' && el.clientHeight > 0 && !el.querySelector('*');
    const outside = r.right > W + 1 || r.left < -1;
    if ((clipX || clipY || outside) && r.top < H) { const k = desc(el); if (!seenC.has(k)) { seenC.add(k); out.clipped.push(`${k} ${clipX ? 'clipX ' : ''}${clipY ? 'clipY ' : ''}${outside ? 'outside ' : ''}"${el.textContent.trim().slice(0, 30)}"`); } }
  }
  return out;
};

async function runScreen(vp, style, s) {
  const [w, h] = vp; const phone = w <= 430;
  const c = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: w <= 820, isMobile: w <= 430, deviceScaleFactor: w <= 430 ? 2 : 1 });
  if (!s.guest) await c.addInitScript((t) => { try { localStorage.setItem('peblo-token', t); } catch {} }, token);
  await c.addInitScript((st) => { try { localStorage.setItem('peblo-style', st); } catch {} }, style);
  const p = await c.newPage();
  p.on('dialog', (d) => d.accept());
  const errs = [];
  p.on('pageerror', (e) => errs.push('pageerror: ' + e.message.slice(0, 160)));
  p.on('console', (m) => { if (m.type() === 'error') { const t = m.text(); if (s.guest && /Failed to load resource.*(401|403|404)/.test(t)) return; errs.push('console: ' + t.slice(0, 160)); } });
  const issues = []; let canvas = false;
  try {
    await p.goto(base + s.url, { waitUntil: 'load' });
    if (EXTRA_CSS) await p.addStyleTag({ content: EXTRA_CSS });
    if (s.wait) await p.locator(s.wait).first().waitFor({ timeout: 12000 }).catch(() => issues.push('content never appeared'));
    if (s.signup) await p.getByRole('button', { name: /create an account/i }).first().click({ timeout: 4000 }).catch(() => issues.push('no signup switch'));
    await p.waitForTimeout(1200);
    const a = await p.evaluate(audit, phone);
    if (a.canvas) { canvas = true; issues.push('CANVAS ' + a.canvas); }
    else {
      if (a.hscroll) issues.push('hscroll: ' + a.hscroll);
      for (const f of a.fixed) issues.push('fixed overflow: ' + f);
      if (phone) { for (const t of a.tiny) issues.push('tiny(<32px): ' + t); for (const o of a.offscreen) issues.push('unreachable: ' + o); }
      for (const x of a.clipped) issues.push('clipped: ' + x);
    }
    for (const e of errs) issues.push(e);
    if (/Something went wrong|Application error|Minified React error/i.test(await p.locator('body').innerText().catch(() => ''))) issues.push('error boundary text on page');
    if (issues.some((i) => !i.startsWith('CANVAS'))) await p.screenshot({ path: path.join(REPO, 'e2e', `resp-${style}-${w}x${h}-${s.id}.png`) }).catch(() => {});
    else if (canvas && process.env.STRICT_CANVAS) await p.screenshot({ path: path.join(REPO, 'e2e', `resp-${style}-${w}x${h}-${s.id}.png`) }).catch(() => {});
  } catch (e) { issues.push('exception: ' + e.message.slice(0, 160)); }
  await c.close();
  return { issues, canvas };
}

for (const style of STYLES) for (const vp of VIEWPORTS) for (const s of SCREENS) {
  const { issues, canvas } = await runScreen(vp, style, s);
  const real = issues.filter((i) => !i.startsWith('CANVAS'));
  const ok = real.length === 0 && (!canvas || !process.env.STRICT_CANVAS);
  const label = `${style} ${vp.join('x')} ${s.id}`;
  results.push({ style, vp: vp.join('x'), screen: s.id, ok, canvas: canvas && real.length === 0 });
  if (!ok) { check(label, false, real.slice(0, 4).join(' || ') || issues[0]); detail.push(label + '\n    ' + issues.join('\n    ')); }
  else console.log(`${canvas ? 'CANVAS' : 'PASS  '}  ${label}`);
}
console.log('\n===== MATRIX (ok / CV = canvas clipped by design / X = fail) =====');
for (const style of STYLES) for (const vp of VIEWPORTS) console.log(style.padEnd(7), vp.join('x').padEnd(9), SCREENS.map((s) => { const r = results.find((q) => q.style === style && q.vp === vp.join('x') && q.screen === s.id); return `${s.id}:${r?.ok ? (r.canvas ? 'CV' : 'ok') : 'X'}`; }).join(' '));
if (detail.length) console.log('\n===== DETAIL =====\n' + detail.join('\n'));
await finish();

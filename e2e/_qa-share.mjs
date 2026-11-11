// Visual QA sweep of the public share pages: screenshots + overflow/contrast/console checks at every width, light and dark.
import { boot } from './lib.mjs';
import fs from 'fs';
const { base, api, ctx, check, finish, token } = await boot({ freshGuest: true });
const OUT = new URL('../.shots/qa-share/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
fs.mkdirSync(OUT, { recursive: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  const WEBP = Buffer.from('UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==', 'base64');
  const up = await (await fetch(base + '/api/media', { method: 'POST', headers: { 'Content-Type': 'image/webp', Authorization: `Bearer ${token}` }, body: WEBP })).json();
  const n = (await api('POST', '/api/notes', { title: 'QA walkthrough note', content: `# Heading one\n\nA paragraph with **bold**, *italic* and a [link](https://example.com). ${'Long words to wrap and fill the column. '.repeat(6)}\n\n- one\n- two\n\n## Heading two\n\n![pic](${up.url}#pw=400)\n\n> quote text\n\n\`\`\`\ncode block here\n\`\`\`\n` })).note;
  const made = await api('POST', '/api/todos', { text: 'QA walkthrough to-do', priority: 'high' });
  const t = made.todo || made;
  const ntok = (await api('POST', `/api/share/note/${n.id}`, { edit: true })).token;
  const ttok = (await api('POST', `/api/share/todo/${t.id}`, { edit: true })).token;
  const sizes = [[1700, 950], [1366, 768], [1024, 768], [768, 1024], [390, 844]];
  for (const kind of ['note', 'todo']) for (const theme of ['light', 'dark']) for (const [w, h] of sizes) {
    const c = await ctx.browser().newContext({ viewport: { width: w, height: h } });
    await c.addInitScript((th) => { try { localStorage.setItem('peblo-theme', th); localStorage.setItem('peblo-guest-name', 'Pia'); localStorage.setItem('peblo-guest-tour', '1'); localStorage.setItem('peblo-guest-joined', '1'); } catch {} }, theme);
    const p = await c.newPage(); const errs = [];
    p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
    await p.goto(`${base}/s/${kind}/${kind === 'note' ? ntok : ttok}`);
    await p.locator(kind === 'note' ? '.bn-editor' : 'body').waitFor({ timeout: 25000 });
    await wait(2500);
    const r = await p.evaluate(() => {
      const de = document.documentElement; const bad = [];
      for (const e of document.querySelectorAll('body *')) { const b = e.getBoundingClientRect(); if (b.width && b.right > innerWidth + 1 && getComputedStyle(e).position !== 'fixed' && !e.closest('[hidden]')) { bad.push((e.className && e.className.toString().slice(0, 40)) || e.tagName); if (bad.length > 4) break; } }
      const lum = (c) => { const m = c.match(/[\d.]+/g).map(Number); const f = (v) => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }; return .2126 * f(m[0]) + .7152 * f(m[1]) + .0722 * f(m[2]); };
      const bg = (e) => { for (; e; e = e.parentElement) { const c = getComputedStyle(e).backgroundColor; const m = c.match(/[\d.]+/g); if (m && (m[3] === undefined || +m[3] > .9)) return c; } return 'rgb(255,255,255)'; };
      const low = [];
      for (const e of document.querySelectorAll('button,a,span,p,h1,h2,h3,label,div')) { if (![...e.childNodes].some((x) => x.nodeType === 3 && x.textContent.trim())) continue; const b = e.getBoundingClientRect(); if (!b.width || !b.height) continue; const s = getComputedStyle(e); if (s.visibility === 'hidden' || +s.opacity === 0) continue; const L1 = lum(s.color), L2 = lum(bg(e)); const cr = (Math.max(L1, L2) + .05) / (Math.min(L1, L2) + .05); if (cr < 3.5) low.push(`${(e.textContent || '').trim().slice(0, 24)}|${cr.toFixed(1)}`); if (low.length > 5) break; }
      return { sx: de.scrollWidth - innerWidth, bad, low, theme: de.dataset.theme || de.className };
    });
    await p.screenshot({ path: `${OUT}${kind}-${theme}-${w}.png`, fullPage: false });
    console.log(kind, theme, w, JSON.stringify(r), errs.slice(0, 2).join(' ; '));
    check(`${kind} ${theme} ${w}: no horizontal scroll`, r.sx <= 1, JSON.stringify(r.bad));
    check(`${kind} ${theme} ${w}: text contrast >= 3.5`, r.low.length === 0, r.low.join(', '));
    check(`${kind} ${theme} ${w}: no page errors`, errs.length === 0, errs[0]);
    await c.close();
  }
} catch (e) { check('qa sweep ran: ' + e.message, false); }
await finish();

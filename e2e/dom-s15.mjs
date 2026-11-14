import { boot } from './lib.mjs';
const { base, api, ctx, finish } = await boot({ freshGuest: true });
const note = (await api('POST', '/api/notes', { title: 'T', content: 'Intro.\n\n## H\n\nPara.', tags: [] })).note;
const tok = (await api('POST', `/api/share/note/${note.id}`, { edit: true })).token;
const c = await ctx.browser().newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
await c.addInitScript(() => { try { localStorage.setItem('peblo-guest-tour', '1'); } catch {} });
const g = await c.newPage(); await g.goto(`${base}/s/note/${tok}`); await g.locator('article').waitFor(); await g.locator('[data-testid="join-anon"]').click({ timeout: 4000 }).catch(() => {}); await g.waitForTimeout(1500);
console.log('DOM::' + await g.evaluate(() => [...document.querySelectorAll('.top button, .top a, .top [class]')].filter((e) => e.children.length < 4).map((e) => { const r = e.getBoundingClientRect(); return e.tagName + '.' + String(e.className).slice(0, 30) + '|' + (e.getAttribute('data-testid') || e.getAttribute('aria-label') || '') + '|' + Math.round(r.x) + ',' + Math.round(r.y) + ',' + Math.round(r.width) + 'x' + Math.round(r.height); }).join('\n')));
await finish();

import { boot } from './lib.mjs';
const { base, api, ctx, finish } = await boot({ freshGuest: true });
const md = 'Three themes came up across the six client interviews.\n\n## 1. What we heard\n\nClients praise the team but ask for fewer rounds.\n\n| Theme | Evidence | Action |\n| --- | --- | --- |\n| Speed of delivery | Four of six interviews | Move reviews to Tuesday |\n';
const note = (await api('POST', '/api/notes', { title: 'Q4 client report', content: md, tags: [] })).note;
const tok = (await api('POST', `/api/share/note/${note.id}`, { edit: true })).token;
const mk = async (w, h, phone) => { const c = await ctx.browser().newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, isMobile: phone, hasTouch: phone }); await c.addInitScript(() => { try { localStorage.setItem('peblo-guest-tour', '1'); localStorage.setItem('peblo-guest-joined', '1'); } catch {} }); return c.newPage(); };
for (const [name, w, h, ph] of [['phone', 390, 844, true], ['wide', 1280, 800, false]]) {
  const g = await mk(w, h, ph);
  await g.goto(`${base}/s/note/${tok}`); await g.locator('article').waitFor({ timeout: 20000 }); await g.waitForTimeout(1500);
  await g.locator('[data-testid="look-btn"]').click(); await g.waitForTimeout(600);
  await g.screenshot({ path: `D:/Peblo/_shots/real-S42-look-${name}.png` });
  await g.locator('[data-testid="look-btn"]').click(); await g.waitForTimeout(400);
  if (!ph) { await g.mouse.move(600, 300); await g.waitForTimeout(3500); await g.screenshot({ path: `D:/Peblo/_shots/real-S42-pill-${name}.png` }); }
}
await finish();

import { boot } from './lib.mjs';
const { base, api, ctx, finish } = await boot({ freshGuest: true });
const md = 'Three themes came up across the six client interviews: speed of delivery, clarity of briefs, and how corrections are handled.\n\n## 1. What we heard\n\nClients praise the team but ask for fewer rounds. Most delays start with an unclear first brief.\n\n| Theme | Evidence | Action |\n| --- | --- | --- |\n| Speed | 4 of 6 | Tuesday |\n| Briefs | 2 rewrites | Template |\n';
const note = (await api('POST', '/api/notes', { title: 'Q4 client report', content: md, tags: [] })).note;
const note2 = (await api('POST', '/api/notes', { title: 'Q4 client report', content: md, tags: [] })).note;
const tok = (await api('POST', `/api/share/note/${note2.id}`, { edit: false })).token;
const etok = (await api('POST', `/api/share/note/${note.id}`, { edit: true })).token;
for (const st of ['soft', 'river', 'orbit']) {
  const c = await ctx.browser().newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  await c.addInitScript((s) => { try { localStorage.setItem('peblo-guest-tour', '1'); localStorage.setItem('peblo-guest-joined', '1'); localStorage.setItem('peblo-share-look', JSON.stringify({ style: s })); } catch {} }, st);
  const g = await c.newPage();
  await g.goto(`${base}/s/note/${tok}`); await g.locator('article').waitFor({ timeout: 20000 }); await g.waitForTimeout(1800);
  await g.screenshot({ path: `D:/Peblo/_shots/real-S46-${st}.png` });
}
const c = await ctx.browser().newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
await c.addInitScript(() => { try { localStorage.setItem('peblo-guest-tour', '1'); localStorage.setItem('peblo-guest-joined', '1'); } catch {} });
const g = await c.newPage();
await g.goto(`${base}/s/note/${etok}`); await g.locator('article').waitFor({ timeout: 20000 }); await g.waitForTimeout(1800);
await g.screenshot({ path: 'D:/Peblo/_shots/real-S47-strip.png' });
await finish();

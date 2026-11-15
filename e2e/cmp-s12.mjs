import { boot } from './lib.mjs';
const { base, api, ctx, finish } = await boot({ freshGuest: true });
const md = 'Three themes came up across the six client interviews.\n\n## 1. What we heard\n\nClients praise the team but ask for fewer rounds.\n\n## 2. Next steps\n\nWho signs off the final numbers?';
const note = (await api('POST', '/api/notes', { title: 'Q4 client report', content: md, tags: [] })).note;
const tok = (await api('POST', `/api/share/note/${note.id}`, { edit: true })).token;
const mk = async (name) => { const c = await ctx.browser().newContext({ viewport: { width: 1440, height: 900 } }); await c.addInitScript(() => { try { localStorage.setItem('peblo-guest-tour', '1'); } catch {} }); const g = await c.newPage(); await g.goto(`${base}/s/note/${tok}`); await g.locator('.bn-editor').waitFor({ timeout: 20000 }); await g.locator('[data-testid="join-card"]').getByLabel('Your name').fill(name); await g.locator('[data-testid="join-submit"]').click(); await g.waitForTimeout(1200); return g; };
const a = await mk('Priya');
const b = await mk('Ravi');
await a.waitForTimeout(2500);
await a.locator('body').click({ position: { x: 700, y: 500 } }).catch(() => {});

await a.waitForTimeout(1200);
console.log(JSON.stringify(await a.evaluate(()=>{const f=document.querySelector('[data-testid=fly-people]');const h=document.querySelector('.hd-stack');return {fly:!!f,tag:h&&h.tagName,r:f&&JSON.stringify(f.getBoundingClientRect()),d:f&&getComputedStyle(f).display}})));
await a.screenshot({ path: 'D:/Peblo/_shots/real-S12.png' });
await finish();

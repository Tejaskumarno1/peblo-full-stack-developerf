import { boot } from './lib.mjs';
const { base, api, ctx, finish } = await boot({ freshGuest: true });
const md = 'Three themes came up across the six client interviews: speed of delivery, clarity of briefs, and how corrections are handled.\n\n## 1. What we heard\n\nClients praise the team but ask for fewer rounds. Most delays start with an unclear first brief.\n\n## 2. Next steps\n\nWho signs off?';
const note = (await api('POST', '/api/notes', { title: 'Q4 client report', content: md, tags: [] })).note;
const tok = (await api('POST', `/api/share/note/${note.id}`, { edit: true })).token;
const mk = async (w, h, phone) => { const c = await ctx.browser().newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, isMobile: phone, hasTouch: phone }); await c.addInitScript(() => { try { localStorage.setItem('peblo-guest-tour', '1'); } catch {} }); return c.newPage(); };
const join = async (g, name) => { await g.goto(`${base}/s/note/${tok}`); await g.locator('article').waitFor({ timeout: 20000 }); const jc = g.locator('[data-testid="join-card"]'); await jc.waitFor({ timeout: 8000 }).catch(() => {}); if (await jc.count()) { await jc.getByLabel('Your name').fill(name); await g.locator('[data-testid="join-submit"]').click(); } await g.waitForTimeout(1500); };
const other = await mk(1280, 800, false); await join(other, 'Priya Nair');
const other2 = await mk(1280, 800, false); await join(other2, 'Ravi Kumar');
const g = await mk(390, 844, true); await join(g, 'Meera');
await g.waitForTimeout(1500);
const S = (n) => g.screenshot({ path: `D:/Peblo/_shots/real-S29-${n}.png` });
// palette
await g.locator('[data-testid="palette-btn"]').click({ force: true }).catch(() => {});
await g.waitForTimeout(700); await S('palette'); await g.keyboard.press('Escape'); await g.waitForTimeout(300);
// people
await g.locator('.mchips .c-people').click().catch(() => {});
await g.waitForTimeout(900); await S('people');
await g.keyboard.press('Escape'); await g.waitForTimeout(300);
// listen
await g.locator('body').click({position:{x:5,y:5}}).catch(() => {}); await g.keyboard.press('l'); await g.waitForTimeout(800); await S('listen'); await g.keyboard.press('l'); await g.waitForTimeout(300);
await g.locator('.more-btn, [aria-label="More options"]').first().click().catch(() => {});
await g.waitForTimeout(500); await S('menu');
await finish();

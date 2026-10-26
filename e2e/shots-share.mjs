// Real screenshots of the main app note view and the share page (desktop, presenting, comments, phone) for the redesign mockups.
import { boot, REPO } from './lib.mjs';
const { base, api, page, ctx, finish } = await boot();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = REPO + '/.shots/';
const md = '## Database normalization\n\nNormalization removes redundancy. Every determinant must be a candidate key in BCNF.\n\n### Why it matters\n\n- Fewer update anomalies\n- Smaller tables\n- Clear dependencies\n\n### Worked example\n\nStudent, course and instructor in one table forces the instructor to repeat on every row.\n\n> Remember: 3NF allows a non-key dependency on a prime attribute, BCNF does not.\n\n### Practice\n\nSplit the relation and check each dependency again.';
const note = (await api('POST', '/api/notes', { title: 'Database normalization', content: md, tags: ['databases'] })).note;
const tok = (await api('POST', `/api/share/note/${note.id}`, { edit: true })).token;
const ready = async (p) => { await p.locator('.bn-editor').waitFor({ timeout: 20000 }); await wait(1500); };
for (const style of ['soft', 'river', 'orbit']) {
  await page.addInitScript((s) => { try { localStorage.setItem('peblo-style', s); localStorage.setItem('peblo-orbit-help-seen', '1'); localStorage.setItem('peblo-collab-tip', '1'); } catch {} }, style);
  await page.setViewportSize({ width: 1366, height: 800 });
  await page.evaluate((s) => localStorage.setItem('peblo-style', s), style).catch(() => {});
  await page.goto(base + '/notes/' + note.id); await ready(page);
  await page.screenshot({ path: OUT + `orig-main-${style}.png` });
}
await page.evaluate(() => localStorage.setItem('peblo-style', 'soft'));
await page.goto(base + '/notes/' + note.id); await ready(page);
const g = await (await ctx.browser().newContext({ viewport: { width: 1366, height: 800 } })).newPage();
await g.goto(`${base}/s/note/${tok}`); await ready(g);
await g.screenshot({ path: OUT + 'orig-share-welcome.png' });
await g.getByLabel('Your name').fill('Aarav'); await g.getByLabel('Your name').press('Enter');
await g.locator('[data-testid="guest-color"]').nth(5).click();
const b = await g.locator('.bn-editor .bn-block-content', { hasText: 'Normalization removes' }).first().boundingBox();
await g.mouse.move(b.x + 120, b.y + 12); await g.mouse.move(b.x + 200, b.y + 14);
await page.mouse.move(500, 300); await wait(1500);
await g.screenshot({ path: OUT + 'orig-share-guest.png' });
await page.screenshot({ path: OUT + 'orig-main-owner-with-guest.png' });
await g.locator('[data-testid="present-btn"]').click(); await g.locator('[data-testid="tool-laser"]').click();
await g.mouse.move(b.x + 150, b.y + 14); await wait(1200);
await g.screenshot({ path: OUT + 'orig-share-presenting.png' });
await page.screenshot({ path: OUT + 'orig-main-sees-presenter.png' });
const p = await (await ctx.browser().newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })).newPage();
await p.goto(`${base}/s/note/${tok}`); await ready(p);
await p.screenshot({ path: OUT + 'orig-share-phone.png' });
await finish();

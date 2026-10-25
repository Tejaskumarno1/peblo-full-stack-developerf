import { boot } from './lib.mjs';
const { base, api, ctx, check, finish } = await boot();
try {
  const note = (await api('POST', '/api/notes', { title: 'Layout note', content: '# Heading\n\nSome text here that is long enough to wrap onto a second line when the column is narrow, more words more words more words.', tags: [] })).note;
  const tok = (await api('POST', `/api/share/note/${note.id}`, { edit: true })).token;
  for (const [w, h] of [[1280, 800], [1440, 900]]) {
    const c = await ctx.browser().newContext({ viewport: { width: w, height: h } });
    const g = await c.newPage();
    await g.goto(`${base}/s/note/${tok}`);
    await g.locator('.bn-editor').waitFor({ timeout: 15000 });
    await g.waitForTimeout(800);
    const box = await g.locator('article').boundingBox();
    const ed = await g.locator('.bn-editor').boundingBox();
    console.log(`viewport ${w}: article ${Math.round(box.width)}px, editor ${Math.round(ed.width)}px`);
    await g.screenshot({ path: `C:/Users/tejas/Documents/peblo-full-stack-developerf/.shots/layout-${w}.png` });
    check(`article is wide enough at ${w}`, box.width > 600, String(box.width));
    await c.close();
  }
} catch (e) { check('ran', false, String(e)); } finally { await finish(); }

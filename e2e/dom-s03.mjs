import { boot } from './lib.mjs';
const { base, api, ctx, finish } = await boot({ freshGuest: true });
const note = (await api('POST', '/api/notes', { title: 'T', content: 'Intro text.\n\n## H\n\nPara.\n\n| A | B |\n| --- | --- |\n| 1 | 2 |', tags: [] })).note;
const tok = (await api('POST', `/api/share/note/${note.id}`, { edit: false })).token;
const g = await (await ctx.browser().newContext({ viewport: { width: 1440, height: 900 } })).newPage();
await g.goto(`${base}/s/note/${tok}`); await g.locator('article').waitFor(); await g.waitForTimeout(1500);
console.log('DOM::' + await g.evaluate(() => { const a = document.querySelector('article'); const d = a.querySelector('.doc, .md, .reader') || a; return [...d.querySelectorAll('h2, p, table, th, td')].slice(0, 7).map((e) => e.tagName + '.' + e.className + '|' + e.parentElement.className + '|' + (() => { const c = getComputedStyle(e); return [c.fontSize, c.margin, c.padding, c.textTransform, c.fontWeight].join('/'); })()).join('\n'); }));
await finish();

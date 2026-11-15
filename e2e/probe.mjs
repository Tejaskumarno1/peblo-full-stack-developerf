import { boot } from './lib.mjs';
const { base, api, ctx, finish } = await boot({ freshGuest: true });
const md = 'Three themes came up across the six client interviews.\n\n## 1. What we heard\n\nClients praise the team.\n\n### Evidence table\n\n| Theme | Evidence | Action |\n| --- | --- | --- |\n| Speed of delivery | Four of six interviews | Move reviews to Tuesday |\n| Clarity of briefs | Two repeat rewrites | One-page brief template |\n\n## 2. Next steps\n\nWho signs off.';
const note = (await api('POST', '/api/notes', { title: 'Q4 client report', content: md, tags: [] })).note;
const tok = (await api('POST', `/api/share/note/${note.id}`, { edit: true, expiresInDays: 5 })).token;
const c = await ctx.browser().newContext({ viewport: { width: 1440, height: 900 } });
const p = await c.newPage();
await p.goto(`${base}/s/note/${tok}`);
await p.locator('[data-testid="join-anon"]').click({ timeout: 5000 }).catch(() => {});
await p.waitForTimeout(3000);
const out = await p.evaluate(() => {
  const rows = [];
  const first = document.querySelector('article .bn-editor p, article .bn-editor [data-content-type="paragraph"]');
  let el = first;
  while (el && el.tagName !== 'ARTICLE') { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); rows.push(`${el.tagName.toLowerCase()}.${String(el.className).split(' ').slice(0,2).join('.')} x=${Math.round(r.x)} w=${Math.round(r.width)} pad=${cs.paddingLeft}/${cs.paddingRight} mar=${cs.marginLeft}`); el = el.parentElement; }
  const t = document.querySelector('article table'); if (t) { let e = t; for (let i = 0; i < 4 && e; i++, e = e.parentElement) rows.push('T ' + e.tagName + '.' + String(e.className) + ' w=' + Math.round(e.getBoundingClientRect().width) + ' x=' + Math.round(e.getBoundingClientRect().x)); const td = t.querySelector('td'); rows.push('td ' + getComputedStyle(td).padding + ' ' + td.outerHTML.slice(0, 160)); rows.push('colgroup ' + (t.querySelector('colgroup')?.outerHTML || 'none')); }
  return rows;
});
console.log(out.join('\n'));
await finish();

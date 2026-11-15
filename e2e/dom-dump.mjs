import { boot } from './lib.mjs';
const { base, api, ctx, finish } = await boot({ freshGuest: true });
const note = (await api('POST', '/api/notes', { title: 'Q4 client report', content: '## 1. What we heard\n\nHello world words here.\n\n## 2. Next steps\n\nMore.', tags: [] })).note;
const tok = (await api('POST', `/api/share/note/${note.id}`, { edit: true, expiresInDays: 5 })).token;
const c = await ctx.browser().newContext({ viewport: { width: 1440, height: 900 } });
const p = await c.newPage();
await p.goto(`${base}/s/note/${tok}`);
await p.locator('[data-testid="join-anon"]').click({ timeout: 5000 }).catch(() => {});
await p.waitForTimeout(3000);
const out = await p.evaluate(() => {
  const rows = []; const root = document.querySelector('.pb-shared');
  const walk = (el, d) => {
    if (d > 5) return; const r = el.getBoundingClientRect(); if (r.width < 4 || r.height < 4) return;
    const cs = getComputedStyle(el);
    rows.push(`${'.'.repeat(d)}${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).slice(0, 3).join('.') : ''}${el.dataset?.testid ? '#' + el.dataset.testid : ''} [${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)}] ${cs.position === 'fixed' || cs.position === 'sticky' ? cs.position : ''}`);
    [...el.children].forEach((c) => walk(c, d + 1));
  };
  walk(root, 0); return rows;
});
console.log(out.join('\n'));
await finish();

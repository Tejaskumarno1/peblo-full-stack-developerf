import { boot } from './lib.mjs';
const { base, api, page, finish } = await boot({ freshPresence: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const n = (await api('POST', '/api/notes', { title: 'mistakes 3', content: '## Overview\n\nhey in the fullscreen mode the editorial text down bar isnt working needed to fix it\n\nSome more text here.\n\n## 1. What we heard\n\nText.\n\n## 2. Next steps\n\nMore.' })).note;
await api('POST', `/api/share/note/${n.id}`, { edit: true });
for (const [w, h] of [[1536, 864], [1920, 913]]) {
  await page.setViewportSize({ width: w, height: h });
  await page.goto(base + '/notes/' + n.id);
  await page.locator('.bn-editor').waitFor({ timeout: 20000 }); await wait(1200);
  await page.locator('button[aria-label="Full screen"]').click(); await wait(1500);
  await page.mouse.move(700, 30); await wait(400);
  const ov = await page.evaluate(() => {
    const bar = document.querySelector('.fsx-bar'); const kids = [...bar.children].map((e) => { const r = e.getBoundingClientRect(); return { c: e.className, l: Math.round(r.left), r: Math.round(r.right), w: Math.round(r.width) }; }).filter((k) => k.w > 0);
    const over = []; for (let i = 1; i < kids.length; i++) if (kids[i].l < kids[i - 1].r - 1) over.push([kids[i - 1].c, kids[i].c]);
    return { barW: Math.round(bar.getBoundingClientRect().width), scrollW: bar.scrollWidth, clientW: bar.clientWidth, over };
  });
  console.log(w, JSON.stringify(ov));
  await page.screenshot({ path: `D:/Peblo/_shots/focus-${w}.png` });
  await page.keyboard.press('Escape'); await wait(600);
}
await finish();

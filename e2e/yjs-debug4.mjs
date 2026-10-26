import { boot } from './lib.mjs';
const { base, api, page, finish } = await boot();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  const doc = (await api('POST', '/api/notes', { title: 'Editor bits', content: '> 💡 A handy tip\n\n> ⚠️ Careful now\n\n```js\nconst x = 1;\n```\n\nThe end.\n', tags: ['b3'] })).note;
  await page.addInitScript(() => localStorage.setItem('peblo-debug','1'));
  const t0 = Date.now();
  await page.goto(base + `/notes/${doc.id}`);
  await page.locator('.bn-editor').waitFor({ timeout: 12000 });
  for (const ms of [200, 1200, 3000, 6000]) {
    await wait(ms - (Date.now() - t0 > ms ? 0 : 0));
    const co = await page.locator('[data-callout]').evaluateAll((els) => els.map((e) => e.getAttribute('data-callout')));
    console.log(ms, 'callouts', co.join(','), 'chip', await page.locator('[data-testid="collab-status"]').count(), 'text', JSON.stringify((await page.locator('.bn-editor').innerText()).slice(0, 80)), 'quotes', await page.locator('.bn-editor [data-content-type="quote"]').count());
  }
  console.log(await page.evaluate(() => { const e = window.__pebloEditor; const st = e.prosemirrorState; return JSON.stringify({ plugins: st.plugins.map((p) => p.key).filter((k) => /callout|sync|cursor|y-/i.test(k)), types: [...new Set((function w(n, a = []) { n.descendants((x) => { a.push(x.type.name); }); return a; })(st.doc))] }); }));
} catch (e) { console.log(e.stack); } finally { await finish(); }

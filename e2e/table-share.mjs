// Tables on a share link: a view-only page shows the saved widths and colours, a guest on an edit link gets the same table controls,
// resizing a column in a live room does not flicker, and what the guest sets reaches the owner's note.
import { boot } from './lib.mjs';

const { base, api, ctx, check, finish } = await boot();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const md = '# Plan\n\n| Board | Feature | Owner |\n| --- | --- | --- |\n| 24-27 | Session setup | Eshwar |\n| 28 | Team boards | Tejas |\n\n<!--pb-table {"i":0,"cw":[180,300,140],"z":1,"c":[[1,0,{"bg":"red"}],[2,2,{"ta":"right"}]]}-->\n\nAfter the table.\n';
try {
  const note = (await api('POST', '/api/notes', { title: 'Shared table', content: md, tags: [] })).note;
  const view = await api('POST', `/api/share/note/${note.id}`, { edit: false });
  const guestCtx = await ctx.browser().newContext({ viewport: { width: 1440, height: 900 } });
  const v = await guestCtx.newPage();
  await v.goto(`${base}/s/note/${view.token}`);
  await v.locator('.doc table, .bn-editor table').first().waitFor({ timeout: 20000 });
  await wait(800);
  const cw = await v.evaluate(() => [...document.querySelector('table').querySelectorAll(':scope > colgroup > col')].map((c) => Math.round(c.getBoundingClientRect().width)));
  check('the shared page shows the saved column widths', cw.length === 3 && Math.abs(cw[0] - 180) <= 3 && Math.abs(cw[1] - 300) <= 3 && Math.abs(cw[2] - 140) <= 3, JSON.stringify(cw));
  const bg = await v.evaluate(() => getComputedStyle(document.querySelectorAll('table tr')[1].cells[0]).backgroundColor);
  check('and the cell colour', bg !== 'rgba(0, 0, 0, 0)' && /251, 207, 202|rgb\(251/.test(bg), bg);
  check('the hidden marker is not shown on the page', !/pb-table/.test(await v.locator('body').innerText()));
  await v.close();

  // an edit link: the guest has the same controls
  const edit = await api('POST', `/api/share/note/${note.id}`, { edit: true });
  const g = await guestCtx.newPage();
  const errs = []; g.on('pageerror', (e) => errs.push(e.message));
  await g.goto(`${base}/s/note/${edit.token}`);
  const T = g.locator('.bn-editor table').first();
  await T.waitFor({ timeout: 20000 }); await wait(2500);
  const cols = () => g.evaluate(() => [...document.querySelector('.bn-editor table').querySelectorAll(':scope > colgroup > col')].map((c) => Math.round(c.getBoundingClientRect().width)));
  const c0 = await cols();
  check('the guest editor opens the table with the saved widths', Math.abs(c0[0] - 180) <= 3 && Math.abs(c0[1] - 300) <= 3, JSON.stringify(c0));
  await T.locator('tr').nth(1).locator('td, th').first().click(); await wait(400);
  check('the guest sees the table toolbar', await g.locator('[data-testid="table-toolbar"]').isVisible());
  const r = await g.evaluate(() => { const t = document.querySelector('.bn-editor table').getBoundingClientRect(); return { x: t.x, y: t.y }; });
  await g.mouse.move(r.x + c0[0], r.y + 30); await wait(300);
  check('and the "+" and the column grip', (await g.locator('[data-testid="tt-add-col"]').isVisible()) && (await g.locator('[data-testid="tt-col-grip"]').isVisible()));
  // drag with the live room on, sampling the width on every frame
  await g.evaluate(() => { window.__w = []; const loop = () => { const col = document.querySelector('.bn-editor table col'); window.__w.push(col ? Math.round(col.getBoundingClientRect().width) : -1); window.__raf = requestAnimationFrame(loop); }; loop(); });
  check('the room is live while the guest drags', (await g.locator('[data-live="1"]').count()) === 1);
  console.log('hit', await g.evaluate(([x, y]) => { const e = document.elementFromPoint(x, y); return e ? e.tagName + '.' + String(e.className).slice(0, 40) : null; }, [r.x + c0[0], r.y + 30]));
  await g.mouse.down(); await g.mouse.move(r.x + c0[0] + 80, r.y + 30, { steps: 24 }); await wait(250); await g.mouse.up(); await wait(600);
  const samples = await g.evaluate(() => { cancelAnimationFrame(window.__raf); return window.__w; });
  let back = 0; let jumps = 0; for (let i = 1; i < samples.length; i++) { back = Math.max(back, samples[i - 1] - samples[i]); if (Math.abs(samples[i] - samples[i - 1]) > 30) jumps++; }
  check('no flicker: the width never steps back while dragging', back <= 1 && jumps === 0, `back ${back}px, ${jumps} jumps, ${samples.length} samples`);
  console.log('trace', JSON.stringify(samples.filter((x, i) => i === 0 || x !== samples[i - 1])));
  const c1 = await cols();
  check('the column ends 80px wider', Math.abs(c1[0] - (c0[0] + 80)) <= 3, `${c0[0]} -> ${c1[0]}`);
  let saved = ''; for (let i = 0; i < 40; i++) { saved = (await api('GET', `/api/notes/${note.id}`)).note.content; if (new RegExp(`"cw":\\[${c1[0]},`).test(saved)) break; await wait(300); }
  check('the guest resize reached the owner note', new RegExp(`"cw":\\[${c1[0]},`).test(saved), saved);
  check('the stripes, colours and alignment kept', /"z":1/.test(saved) && /"bg":"red"/.test(saved) && /"ta":"right"/.test(saved), saved);
  check('no errors on the guest page', errs.length === 0, errs.join(' | '));
  await guestCtx.close();
} catch (e) {
  console.log(String(e && e.message).slice(0, 1200));
  check('table-share ran', false, 'see above');
} finally {
  await finish();
}

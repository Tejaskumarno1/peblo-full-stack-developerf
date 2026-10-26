import { boot } from './lib.mjs';
const { base, api, page, ctx, check, finish } = await boot();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ready = async (p) => { await p.locator('.bn-editor').waitFor({ timeout: 20000 }); await p.locator('[data-testid="collab-status"]').waitFor({ state: 'detached', timeout: 20000 }); await wait(500); };
const typeAt = async (p, i, where, s) => { await p.locator('.bn-editor .bn-block-content').nth(i).click(); await p.keyboard.press(where === 'start' ? 'Home' : 'End'); await p.keyboard.type(s, { delay: 30 }); };
try {
  const note = (await api('POST', '/api/notes', { title: 'Y', content: 'P1 alpha line\n\nP2 bravo line\n\nP3 charlie line', tags: [] })).note;
  const tok = (await api('POST', `/api/share/note/${note.id}`, { edit: true })).token;
  await page.addInitScript(() => { try { localStorage.setItem('peblo-style', 'studio'); } catch {} });
  page.on('console', (m) => console.log('  [owner console]', m.text().slice(0, 200)));
  page.on('request', (r) => { if (r.method() !== 'GET' && /notes|public/.test(r.url())) console.log('  [owner req]', r.method(), r.url().slice(-40), (r.postData() || '').slice(0, 150)); });
  page.on('websocket', (w) => { console.log('  [owner ws]', w.url().replace(/token=[^&]+/, 'token=…')); w.on('close', () => console.log('  [owner ws closed]')); });
  page.on('pageerror', (e) => console.log('  [owner pageerror]', e.message));
  await page.goto(base + '/notes/' + note.id); await ready(page);
  console.log('owner chip count', await page.locator('[data-testid="collab-status"]').count(), 'editors', await page.locator('.bn-editor').count());
  const gc = await ctx.browser().newContext(); const g = await gc.newPage();
  g.on('request', (r) => { if (r.method() !== 'GET' && /public/.test(r.url())) console.log('  [guest req]', r.method(), (r.postData() || '').slice(0, 200)); });
  g.on('websocket', (w) => { console.log('  [guest ws]', w.url().replace(/token=[^&]+/, 'token=…')); w.on('close', () => console.log('  [guest ws closed]')); });
  g.on('pageerror', (e) => console.log('  [guest pageerror]', e.message));
  await g.goto(`${base}/s/note/${tok}`); await ready(g);
  await Promise.all([typeAt(page, 0, 'start', 'OWNER-TOP '), typeAt(g, 2, 'end', ' GUEST-BOTTOM')]);
  await wait(3000);
  await Promise.all([typeAt(page, 1, 'start', 'LEFT-'), typeAt(g, 1, 'end', '-RIGHT')]);
  await wait(12000);
  console.log('OWNER', JSON.stringify(await page.locator('.bn-editor').innerText()));
  console.log('GUEST', JSON.stringify(await g.locator('.bn-editor').innerText()));
  console.log('DB', JSON.stringify((await api('GET', `/api/notes/${note.id}`)).note.content));
  console.log('CURSORS', await page.evaluate(() => [...document.querySelectorAll('*')].map((e) => e.className).filter((c) => typeof c === 'string' && /cursor|caret|collab/i.test(c)).slice(0, 10)));
} catch (e) { console.log(e.stack); } finally { await finish(); }

import { boot } from './lib.mjs';
const { base, api, page, ctx, finish } = await boot();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ready = async (p) => { await p.locator('.bn-editor').waitFor({ timeout: 20000 }); await p.locator('[data-testid="collab-status"]').waitFor({ state: 'detached', timeout: 20000 }); await wait(700); };
const sel = (p) => p.evaluate(() => { const s = getSelection(); return (s.anchorNode?.textContent || '').slice(0, 25) + '@' + s.anchorOffset; });
const focusEmu = async (p) => { const c = await p.context().newCDPSession(p); await c.send('Emulation.setFocusEmulationEnabled', { enabled: true }); };
try {
  const note = (await api('POST', '/api/notes', { title: 'Y', content: 'P1 alpha line\n\nP2 bravo line\n\nP3 charlie line', tags: [] })).note;
  const tok = (await api('POST', `/api/share/note/${note.id}`, { edit: true })).token;
  if (process.env.OFF) await page.addInitScript(() => localStorage.setItem('peblo-collab','off'));
  await focusEmu(page);
  await page.goto(base + '/notes/' + note.id); await ready(page);
  const gc = await ctx.browser().newContext(); const g = await gc.newPage(); await focusEmu(g);
  if (process.env.OFF) await g.addInitScript(() => localStorage.setItem('peblo-collab','off'));
  await g.goto(`${base}/s/note/${tok}`); await ready(g);
  const P = (p, i) => p.locator('.bn-editor .bn-block-content').nth(i);
  await Promise.all([P(page, 0).click(), P(g, 2).click()]);
  console.log('after clicks  owner', await sel(page), '| guest', await sel(g));
  await Promise.all([page.keyboard.press('Home'), g.keyboard.press('End')]);
  console.log('after Home/End owner', await sel(page), '| guest', await sel(g));
  await wait(800);
  console.log('after 800ms   owner', await sel(page), '| guest', await sel(g));
  await Promise.all([page.keyboard.type('OWNER-TOP ', { delay: 30 }), g.keyboard.type(' GUEST-BOTTOM', { delay: 30 })]);
  await wait(800);
  console.log('OWNER', JSON.stringify((await page.locator('.bn-editor').innerText()).replace(/⁠/g, '')));
  console.log('GUEST', JSON.stringify((await g.locator('.bn-editor').innerText()).replace(/⁠/g, '')));
} catch (e) { console.log(e.stack); } finally { await finish(); }

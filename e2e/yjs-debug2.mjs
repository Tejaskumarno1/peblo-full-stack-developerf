import { boot } from './lib.mjs';
const { base, api, page, ctx, finish } = await boot();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ready = async (p) => { await p.locator('.bn-editor').waitFor({ timeout: 20000 }); await p.locator('[data-testid="collab-status"]').waitFor({ state: 'detached', timeout: 20000 }); await wait(700); };
const typeAt = async (p, i, where, s) => { await p.locator('.bn-editor .bn-block-content').nth(i).click(); await p.keyboard.press(where === 'start' ? 'Home' : 'End'); await p.keyboard.type(s, { delay: 30 }); };
const dump = async (label, p) => console.log(label, JSON.stringify((await p.locator('.bn-editor').innerText()).replace(/⁠/g, '')));
try {
  const note = (await api('POST', '/api/notes', { title: 'Y', content: 'P1 alpha line\n\nP2 bravo line\n\nP3 charlie line', tags: [] })).note;
  const tok = (await api('POST', `/api/share/note/${note.id}`, { edit: true })).token;
  await page.addInitScript(() => { try { localStorage.setItem('peblo-style', 'studio'); } catch {} });
  await page.goto(base + '/notes/' + note.id); await ready(page);
  await dump('owner alone start', page);
  await typeAt(page, 0, 'start', 'A1 ');
  await dump('after owner types at P1 start (alone)', page);
  const gc = await ctx.browser().newContext(); const g = await gc.newPage();
  await g.goto(`${base}/s/note/${tok}`); await ready(g);
  await dump('guest sees', g);
  await typeAt(page, 0, 'start', 'B2 ');
  await dump('owner after typing again (guest idle)', page); await dump('guest', g);
  await typeAt(g, 2, 'end', ' G3');
  await dump('owner after guest typed', page);
  await typeAt(page, 1, 'start', 'C4 ');
  await dump('owner types P2 start after guest typed', page); await dump('guest', g);
  await Promise.all([typeAt(page, 0, 'start', 'D5 '), typeAt(g, 2, 'end', ' E6')]);
  await wait(1500);
  await dump('simultaneous owner', page); await dump('simultaneous guest', g);
} catch (e) { console.log(e.stack); } finally { await finish(); }

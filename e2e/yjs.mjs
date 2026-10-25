// Live co-editing (Yjs): two real browsers on one note, typing at the same time. Nothing may be lost, no conflict prompt,
// cursors are shared, changes made some other way reach everyone, access ends when the link ends.
import { boot, REPO } from './lib.mjs';
import path from 'path';
import { pathToFileURL } from 'url';

const { base, api, page, ctx, check, finish, token } = await boot();
const BASE_TEXT = 'P1 alpha line\n\nP2 bravo line\n\nP3 charlie line';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const text = async (id) => (await api('GET', `/api/notes/${id}`)).note.content;
const until = async (fn, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await fn()) return true; } catch { /* retry */ } await wait(150); } return false; };
// Two pages typed at once: make both report "focused" like a real window would (a real user's editor has focus).
const focusEmu = async (p) => { const c = await p.context().newCDPSession(p); await c.send('Emulation.setFocusEmulationEnabled', { enabled: true }); };
const ready = async (p) => { await p.locator('.bn-editor').waitFor({ timeout: 20000 }); await p.locator('[data-testid="collab-status"]').waitFor({ state: 'detached', timeout: 20000 }); await wait(500); };
const plain = (p) => p.evaluate(() => { const el = document.querySelector('.bn-editor').cloneNode(true); el.querySelectorAll('.bn-collaboration-cursor__label, .bn-collaboration-cursor__base').forEach((n) => n.remove()); return el.innerText.replace(/\u2060/g, ''); });
const place = async (p, paragraph, where) => {
  await p.locator('.bn-editor .bn-block-content').nth(paragraph).click();
  await p.keyboard.press(where === 'start' ? 'Home' : 'End');
  await wait(250);
};
const typeNow = (p, str) => p.keyboard.type(str, { delay: 30 });
const typeAt = async (p, paragraph, where, str) => { await place(p, paragraph, where); await typeNow(p, str); };
// Put each person's caret down one after the other (two clicks in the same millisecond is not what people do), then both type together.
const together = async (a, pa, wa, sa, b, pb, wb, sb) => { await place(a, pa, wa); await place(b, pb, wb); await Promise.all([typeNow(a, sa), typeNow(b, sb)]); };


try {
  const note = (await api('POST', '/api/notes', { title: 'Yjs', content: BASE_TEXT, tags: [] })).note;
  const tok = (await api('POST', `/api/share/note/${note.id}`, { edit: true })).token;
  const { default: prisma } = await import(pathToFileURL(path.join(REPO, 'dist', 'server', 'db.js')).href);

  await page.addInitScript(() => { try { localStorage.setItem('peblo-style', 'studio'); localStorage.setItem('peblo-debug', '1'); } catch { /* ignore */ } });
  if (process.env.NET) { page.on('console', (m) => { if (/\[collab\]/.test(m.text())) console.log('  [owner]', m.text()); }); page.on('response', async (r) => { const q = r.request(); if (q.method() === 'PATCH' || q.method() === 'PUT') console.log('  [net]', q.method(), r.status(), (q.postData() || '').replace(/"content":"([^"]{0,60})[^"]*"/, '"content":"$1…"').slice(0, 260)); }); page.on('websocket', (w) => { if (/collab/.test(w.url())) { console.log('  [ws open owner]'); w.on('close', () => console.log('  [ws closed owner]')); } }); }
  await focusEmu(page);
  await page.goto(base + '/notes/' + note.id);
  await ready(page);
  const guestCtx = await ctx.browser().newContext({ viewport: { width: 1440, height: 900 } });
  await guestCtx.addInitScript(() => { try { localStorage.setItem('peblo-debug', '1'); } catch { /* ignore */ } });
  const g = await guestCtx.newPage();
  await focusEmu(g);
  if (process.env.NET) g.on('console', (m) => { if (/\[collab\]/.test(m.text())) console.log('  [guest]', m.text()); });
  const errors = [];
  g.on('pageerror', (e) => errors.push(e.message));
  await g.goto(`${base}/s/note/${tok}`);
  await ready(g);

  const O = page.locator('.bn-editor'); const G = g.locator('.bn-editor');
  check('1 owner sees the saved text', /P1 alpha line[\s\S]*P2 bravo line[\s\S]*P3 charlie line/.test(await O.innerText()), await O.innerText());
  check('1 guest sees the saved text', /P1 alpha line[\s\S]*P2 bravo line[\s\S]*P3 charlie line/.test(await G.innerText()), await G.innerText());
  check('1 no duplicate paragraphs after both opened', (await O.locator('.bn-block-content').count()) === 3 && (await G.locator('.bn-block-content').count()) === 3, `${await O.locator('.bn-block-content').count()} / ${await G.locator('.bn-block-content').count()}`);

  // 2. different paragraphs at the same moment
  await together(page, 0, 'start', 'OWNER-TOP ', g, 2, 'end', ' GUEST-BOTTOM');
  check('2 both pages show both edits', await until(async () => { const o = await plain(page); const x = await plain(g); return /OWNER-TOP/.test(o) && /GUEST-BOTTOM/.test(o) && /OWNER-TOP/.test(x) && /GUEST-BOTTOM/.test(x); }), `${await plain(page)} || ${await plain(g)}`);
  check('2 no conflict prompt on the guest page', (await g.locator('.conflict').count()) === 0);
  check('2 the saved note has both', await until(async () => { const t = await text(note.id); return /OWNER-TOP/.test(t) && /GUEST-BOTTOM/.test(t); }, 10000), JSON.stringify(await text(note.id)));

  // 3. the same paragraph, both ends, at the same moment
  await together(page, 1, 'start', 'LEFT-', g, 1, 'end', '-RIGHT');
  check('3 same paragraph keeps both edits', await until(async () => { const o = await plain(page); const x = await plain(g); return /LEFT-P2 bravo line-RIGHT/.test(o) && /LEFT-P2 bravo line-RIGHT/.test(x); }), `${await plain(page)} || ${await plain(g)}`);

  // 4. shared cursors
  const carets = async (p) => p.locator('.bn-collaboration-cursor__caret').count();
  check('4 each side sees the other person\'s cursor', await until(async () => (await carets(page)) > 0 && (await carets(g)) > 0), `${await carets(page)} / ${await carets(g)}`);

  // 5. the merged document is stored, so a restart loses nothing
  check('5 the document state is stored', await until(async () => (await prisma.$queryRawUnsafe('SELECT 1 FROM note_ydocs WHERE note_id = $1', note.id)).length === 1, 8000));

  // 6. a change made another way (API) reaches both open pages
  await api('PATCH', `/api/notes/${note.id}`, { content: 'API-REWRITTEN\n\nsecond block' });
  check('6 the owner page shows the API change', await until(async () => /API-REWRITTEN/.test(await O.innerText()), 14000), await O.innerText());
  check('6 the guest page shows the API change', await until(async () => /API-REWRITTEN/.test(await G.innerText()), 14000), await G.innerText());
  await ready(page); await ready(g);
  // and editing keeps working afterwards
  await together(page, 0, 'end', ' +o', g, 1, 'end', ' +g');
  check('6 editing continues after the reset', await until(async () => { const t = await text(note.id); return /API-REWRITTEN \+o/.test(t) && /second block \+g/.test(t); }, 10000), JSON.stringify(await text(note.id)));

  // 7. a dropped connection: edits made while offline merge in when it returns
  await g.evaluate(() => window.__pebloCollab.provider.disconnect());
  await wait(300);
  await typeAt(g, 1, 'end', ' OFFLINE-EDIT');
  await typeAt(page, 0, 'end', ' ONLINE-EDIT');
  await wait(1500);
  await g.evaluate(() => window.__pebloCollab.provider.connect());
  check('7 offline edit and online edit both survive', await until(async () => { const o = await plain(page); const x = await plain(g); return /OFFLINE-EDIT/.test(o) && /ONLINE-EDIT/.test(o) && /OFFLINE-EDIT/.test(x) && /ONLINE-EDIT/.test(x); }, 25000), `${await plain(page)} || ${await plain(g)}`);

  // 8. a restart of the room (all leave, one returns): the stored document is used and nothing is duplicated
  await guestCtx.close();
  await page.goto('about:blank');
  await wait(1500);
  await page.goto(base + '/notes/' + note.id);
  await ready(page);
  const afterCount = await O.locator('.bn-block-content').count();
  const afterText = await O.innerText();
  check('8 coming back shows the same text, not twice', afterCount === 2 && /OFFLINE-EDIT/.test(afterText) && /ONLINE-EDIT/.test(afterText), `${afterCount} ${afterText}`);

  // 9. turning the link off ends the guest's live access
  const g2Ctx = await ctx.browser().newContext({ viewport: { width: 1440, height: 900 } });
  const g2 = await g2Ctx.newPage();
  await g2.goto(`${base}/s/note/${tok}`);
  await ready(g2);
  await api('DELETE', `/api/share/note/${note.id}`);
  await typeAt(g2, 0, 'end', ' AFTER-REVOKE');
  await wait(9000);
  const finalText = await text(note.id);
  check('9 an edit after the link was turned off does not reach the note', !/AFTER-REVOKE/.test(finalText), finalText);
  await g2Ctx.close();
  check('no script errors on the guest page', errors.length === 0, errors.join(' | '));
} catch (e) {
  check('yjs ran', false, e && e.stack ? e.stack : String(e));
} finally {
  await finish();
}

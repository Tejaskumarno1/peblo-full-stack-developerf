// Two people editing one shared note: nobody's edits may be lost (API level, then two real browsers).
import { boot } from './lib.mjs';

const { base, api, page, ctx, check, finish, token } = await boot();
const BASE_TEXT = 'P1 alpha line\n\nP2 bravo line\n\nP3 charlie line';
const mkShared = async (content = BASE_TEXT) => {
  const note = (await api('POST', '/api/notes', { title: 'Collab', content, tags: [] })).note;
  const tok = (await api('POST', `/api/share/note/${note.id}`, { edit: true })).token;
  const cur = (await api('GET', `/api/notes/${note.id}`)).note;
  return { id: note.id, tok, base: cur.updatedAt, baseContent: cur.content };
};
const guestPut = async (s, content, extra = {}) => {
  const r = await fetch(`${base}/api/public/note/${s.tok}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'Collab', content, baseUpdatedAt: s.base, baseContent: s.baseContent, ...extra }) });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};
const ownerPatch = async (s, content) => {
  const r = await fetch(`${base}/api/notes/${s.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ content, baseUpdatedAt: s.base, baseContent: s.baseContent }) });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};
const text = async (s) => (await api('GET', `/api/notes/${s.id}`)).note.content;
const versions = async (s) => ((await api('GET', `/api/notes/${s.id}/backups`)).backups || []).length;

try {
  // 1. the owner saves from an older copy after a guest edited another paragraph
  let s = await mkShared();
  await guestPut(s, BASE_TEXT.replace('alpha', 'ALPHA-GUEST'));
  const o = await ownerPatch(s, BASE_TEXT.replace('charlie', 'CHARLIE-OWNER'));
  let t = await text(s);
  check('1 owner save keeps the guest edit', /ALPHA-GUEST/.test(t) && /CHARLIE-OWNER/.test(t), `${o.status} ${JSON.stringify(t)}`);

  // 2. two guests edit different paragraphs from the same starting copy
  s = await mkShared();
  const a = await guestPut(s, BASE_TEXT.replace('alpha', 'ALPHA-A'));
  const b = await guestPut(s, BASE_TEXT.replace('charlie', 'CHARLIE-B'));
  t = await text(s);
  check('2 second guest is merged, not rejected', b.status === 200 && a.status === 200, `${a.status} ${b.status}`);
  check('2 both guest edits are in the note', /ALPHA-A/.test(t) && /CHARLIE-B/.test(t), JSON.stringify(t));

  // 3. two guests edit different words of the same paragraph
  s = await mkShared('The quick brown fox jumps over the lazy dog today');
  await guestPut(s, 'The QUICK brown fox jumps over the lazy dog today');
  const c = await guestPut(s, 'The quick brown fox jumps over the lazy DOG today');
  t = await text(s);
  check('3 same paragraph, different words merge', c.status === 200 && /QUICK/.test(t) && /DOG/.test(t), `${c.status} ${t}`);

  // 4. the same moment: ten pairs of saves in parallel, none may disappear
  let lost = 0;
  for (let i = 0; i < 10; i++) {
    s = await mkShared();
    await Promise.all([guestPut(s, BASE_TEXT.replace('alpha', `A${i}`)), guestPut(s, BASE_TEXT.replace('charlie', `C${i}`))]);
    t = await text(s);
    if (!(t.includes(`A${i}`) && t.includes(`C${i}`))) lost++;
  }
  check('4 simultaneous saves never lose an edit (10 rounds)', lost === 0, `${lost} rounds lost an edit`);

  // 5. a real clash (same word changed two ways) is never silently dropped
  s = await mkShared('The word is alpha here');
  await guestPut(s, 'The word is ONE here');
  const d = await guestPut(s, 'The word is TWO here');
  t = await text(s);
  const kept = d.status === 409 ? /ONE/.test(t) : /ONE|TWO/.test(t);
  check('5 a clashing edit is refused or kept, never lost without trace', kept && (d.status === 409 || (await versions(s)) >= 1), `${d.status} ${t}`);

  // 6. an old copy of a note is saved as a version before it is replaced
  s = await mkShared();
  await guestPut(s, BASE_TEXT.replace('bravo', 'BRAVO-NEW'), { force: false });
  check('6 the text before a shared edit is kept as a version', (await versions(s)) >= 1);

  // 7. the owner sees guest edits in the open note without reloading, and typing is never lost
  s = await mkShared();
  await page.addInitScript(() => { try { localStorage.setItem('peblo-style', 'studio'); localStorage.setItem('peblo-debug', '1'); } catch { /* ignore */ } });
  await page.goto(base + '/notes/' + s.id);
  await page.locator('.bn-editor').waitFor({ timeout: 15000 });
  const guestCtx = await ctx.browser().newContext({ viewport: { width: 1440, height: 900 } });
  await guestCtx.addInitScript(() => { try { localStorage.setItem('peblo-debug', '1'); } catch { /* ignore */ } });
  const g = await guestCtx.newPage();
  await g.goto(`${base}/s/note/${s.tok}`);
  await g.locator('.bn-editor').waitFor({ timeout: 15000 });
  const edG = g.locator('.bn-editor'); const edO = page.locator('.bn-editor');
  await edO.click(); await page.keyboard.press('Control+Home'); await page.keyboard.type('OWNER-TOP ', { delay: 40 });
  await edG.click(); await g.keyboard.press('Control+End');
  for (const ch of 'GUEST-BOTTOM-TYPED-SLOWLY') { await g.keyboard.type(ch); await g.waitForTimeout(160); }
  await g.waitForTimeout(6000); await page.waitForTimeout(2000);
  const gt = await edG.innerText(); const ot = await edO.innerText();
  check('7 guest page shows the owner edit', /OWNER-TOP/.test(gt), gt.slice(0, 120));
  check('7 guest typing was not cut or reordered', /GUEST-BOTTOM-TYPED-SLOWLY/.test(gt), gt.slice(-80));
  check('7 owner page shows the guest edit', /GUEST-BOTTOM-TYPED-SLOWLY/.test(ot), ot.slice(-80));
  const finalText = await text(s);
  check('7 saved note has both', /OWNER-TOP/.test(finalText) && /GUEST-BOTTOM-TYPED-SLOWLY/.test(finalText), JSON.stringify(finalText));
  await guestCtx.close();
} catch (e) {
  check('collab ran', false, e && e.stack ? e.stack : String(e));
} finally {
  await finish();
}

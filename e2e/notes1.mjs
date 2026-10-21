// Notes batch 1: pictures (WebP, stored on the server, resize/side/wrap), toolbar, [[ links, ranked search, compare versions, share expiry.
import { boot } from './lib.mjs';
import { pathToFileURL } from 'url';
import path from 'path';
import { REPO } from './lib.mjs';

const { base, api, page, check, finish, token } = await boot();
const WEBP = Buffer.from('UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==', 'base64');
const shot = (n) => page.screenshot({ path: path.join(REPO, '.shots', n + '.png') });
try {
  // ---------- media API ----------
  const up = await fetch(base + '/api/media', { method: 'POST', headers: { 'Content-Type': 'image/webp', Authorization: `Bearer ${token}` }, body: WEBP });
  const upj = await up.json();
  check('a WebP picture can be stored', up.status === 201 && /^\/api\/media\//.test(upj.url), JSON.stringify(upj));
  const got = await fetch(base + upj.url);
  check('the picture is served without signing in, as WebP', got.status === 200 && got.headers.get('content-type') === 'image/webp' && (await got.arrayBuffer()).byteLength === WEBP.length);
  const noAuth = await fetch(base + '/api/media', { method: 'POST', headers: { 'Content-Type': 'image/webp' }, body: WEBP });
  check('storing needs sign-in', noAuth.status === 401);
  const badType = await fetch(base + '/api/media', { method: 'POST', headers: { 'Content-Type': 'image/svg+xml', Authorization: `Bearer ${token}` }, body: '<svg/>' });
  check('only picture types are accepted', badType.status === 415 || badType.status === 400, badType.status);

  // ---------- search ----------
  const A = (await api('POST', '/api/notes', { title: 'Weekly meeting', content: 'We talked about the roadmap and budget.' })).note;
  await api('POST', '/api/notes', { title: 'Grocery list', content: 'milk, eggs and a long meeting reminder' });
  await api('POST', '/api/notes', { title: 'Ideas', content: 'launch plan', tags: ['meeting'] });
  const s1 = (await api('GET', '/api/notes?search=meeting&snippet=1')).notes;
  check('search puts a title match first', s1[0]?.title === 'Weekly meeting', s1.map((n) => n.title).join(' | '));
  check('search returns the text around the match', /meeting|roadmap/i.test(s1.find((n) => n.title === 'Grocery list')?.matchSnippet || ''), JSON.stringify(s1.map((n) => n.matchSnippet)));
  const s2 = (await api('GET', '/api/notes?search=meetng&snippet=1')).notes;
  check('search forgives a typo in a title', s2.some((n) => n.title === 'Weekly meeting'), s2.map((n) => n.title).join(' | '));
  const s3 = (await api('GET', '/api/notes?search=roadmap budget&snippet=1')).notes;
  check('several words match in any order', s3.length === 1 && s3[0].title === 'Weekly meeting', s3.map((n) => n.title).join(' | '));

  // ---------- picture layout stored in the note ----------
  const body = Array.from({ length: 6 }, (_, i) => `Paragraph ${i + 1} sits next to the picture and goes on for a good while so that it wraps around it nicely across several lines of text.`).join('\n\n');
  const P = (await api('POST', '/api/notes', { title: 'Picture note', content: `![pic](${upj.url}#pw=300&ta=right)\n\n${body}` })).note;
  await page.addInitScript(() => { try { localStorage.setItem('peblo-debug', '1'); } catch {} });
  await page.goto(base + `/notes/${P.id}`);
  await page.locator('.bn-editor').waitFor({ timeout: 12000 });
  await page.waitForTimeout(800);
  const props = await page.evaluate(() => { const b = window.__pebloEditor?.document.find((x) => x.type === 'image'); return b ? { url: b.props.url, pw: b.props.previewWidth, ta: b.props.textAlignment } : null; });
  check('a saved picture keeps its width and side', props && props.pw === 300 && props.ta === 'right' && !props.url.includes('#'), JSON.stringify(props));
  const flt = await page.evaluate(() => { const el = document.querySelector('.bn-block-content[data-content-type="image"]')?.closest('.bn-block-outer'); return el ? getComputedStyle(el).float : 'none-found'; });
  check('a smaller right-hand picture floats right so text wraps beside it', flt === 'right', flt);
  await shot('notes1-wrap');

  // ---------- paste a picture: converted to WebP and stored on the server ----------
  await page.locator('.bn-editor').click();
  await page.keyboard.press('Control+End');
  const pasted = await page.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 2400; c.height = 1200;
    const g = c.getContext('2d'); const grd = g.createLinearGradient(0, 0, 2400, 1200); grd.addColorStop(0, '#f55'); grd.addColorStop(1, '#55f'); g.fillStyle = grd; g.fillRect(0, 0, 2400, 1200);
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
    const dt = new DataTransfer(); dt.items.add(new File([blob], 'big.png', { type: 'image/png' }));
    const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
    document.querySelector('.bn-editor').dispatchEvent(ev);
    return blob.size;
  });
  await page.waitForFunction(() => window.__pebloEditor.document.filter((x) => x.type === 'image' && x.props.url).length >= 2, null, { timeout: 20000 }).catch(() => {});
  const imgs = await page.evaluate(() => window.__pebloEditor.document.filter((x) => x.type === 'image').map((x) => x.props.url));
  const newUrl = imgs.find((u) => !u.includes(upj.url.split('/').pop()));
  check('a pasted picture is stored on the server, not inside the note', !!newUrl && /^\/api\/media\//.test(newUrl), JSON.stringify(imgs).slice(0, 200));
  if (newUrl) {
    const r = await fetch(base + newUrl);
    const buf = Buffer.from(await r.arrayBuffer());
    check('the pasted picture was converted to WebP', r.headers.get('content-type') === 'image/webp' && buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP', r.headers.get('content-type'));
    check('the WebP is smaller than the PNG', buf.length < pasted, `${buf.length} vs ${pasted}`);
  }
  await page.waitForTimeout(2500); // autosave
  const saved = (await api('GET', `/api/notes/${P.id}`)).note;
  check('the saved note is short text with no base64', saved.content.length < 3000 && !/base64/.test(saved.content), saved.content.length);
  check('the saved note keeps the picture layout', /#pw=300&ta=right/.test(saved.content), saved.content.slice(0, 120));

  // ---------- [[ links ----------
  await page.locator('.bn-editor').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type(' [[Weekly', { delay: 60 });
  const item = page.locator('.bn-suggestion-menu-item', { hasText: 'Weekly meeting' }).first();
  check('typing [[ offers your notes', await item.isVisible({ timeout: 4000 }).catch(() => false));
  await shot('notes1-linkmenu');
  await page.keyboard.press('Escape');

  // ---------- floating toolbar ----------
  await page.locator('.bn-block-content[data-content-type="paragraph"]').nth(1).dblclick();
  const tb = page.locator('.bn-toolbar').first();
  check('selecting text shows the formatting toolbar', await tb.isVisible({ timeout: 4000 }).catch(() => false));
  await shot('notes1-toolbar');
  // a clicked picture offers Wrap / size buttons
  await page.locator('.s-note-title').click(); // dismiss the text toolbar, which can sit over the picture
  const clickPic = async () => { const l = page.locator('.bn-visual-media-wrapper img').first(); await l.scrollIntoViewIfNeeded(); const b = await l.boundingBox(); await page.mouse.click(b.x + 8, b.y + 8); await page.waitForTimeout(400); };
  await clickPic();
  const sizeM = page.locator('.bn-toolbar button[data-test="mediumpicture"]').first();
  check('clicking a picture offers S / M / L / Full width buttons', await sizeM.waitFor({ timeout: 5000 }).then(() => true).catch(() => false));
  const wrap = page.locator('.bn-toolbar button[data-test="alignTextLeft"]').first();
  if (await wrap.isVisible().catch(() => false)) {
    await sizeM.click({ force: true });
    await page.waitForTimeout(300);
    await clickPic();
    await wrap.click({ force: true });
    await page.waitForTimeout(400);
    const f2 = await page.evaluate(() => { const el = document.querySelector('.bn-block-content[data-content-type="image"]')?.closest('.bn-block-outer'); return el ? getComputedStyle(el).float : 'x'; });
    check('aligning a smaller picture left floats it left', f2 === 'left', f2);
    await shot('notes1-wrapleft');
  }

  // ---------- search box in the notes list ----------
  await page.goto(base + `/notes/${A.id}`);
  await page.locator('.s-nsearch input').waitFor({ timeout: 10000 });
  await page.locator('.s-nsearch input').fill('meetng');
  await page.waitForTimeout(900);
  const rows = await page.locator('.s-note-row .t').allTextContents();
  check('the notes list search finds a note despite a typo', rows.some((t) => /Weekly meeting/.test(t)), rows.join(' | '));
  await page.locator('.s-nsearch input').fill('roadmap');
  await page.waitForTimeout(900);
  check('the match is highlighted in the list', (await page.locator('.s-note-row mark').count()) > 0);
  await shot('notes1-search');
  await page.locator('.s-nsearch input').fill('');

  // ---------- compare versions ----------
  await api('PATCH', `/api/notes/${A.id}`, { content: 'We talked about the roadmap and budget.\n\nNew line added later.' });
  await page.goto(base + `/notes/${A.id}`);
  await page.locator('.s-versions').waitFor({ timeout: 10000 });
  await page.locator('.s-versions').click();
  const cmp = page.locator('.s-menu button', { hasText: 'Compare' }).first();
  await cmp.waitFor({ timeout: 5000 }).catch(() => {});
  check('the version list offers Compare', await cmp.isVisible().catch(() => false));
  await cmp.click().catch(() => {});
  await page.locator('.s-vd').waitFor({ timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(600);
  const adds = await page.locator('.s-vd-cell.add').count();
  check('the comparison shows what was added', adds > 0, adds);
  await shot('notes1-diff');
  await page.keyboard.press('Escape');

  // ---------- share expiry ----------
  const sh = await api('POST', `/api/share/note/${A.id}`, { edit: false, expiresInDays: 7 });
  check('a share link can have an end date', !!sh.expiresAt && new Date(sh.expiresAt) > new Date(), JSON.stringify(sh));
  const open1 = await fetch(base + `/api/public/note/${sh.token}`);
  check('the link works before it ends', open1.status === 200);
  const { default: prisma } = await import(pathToFileURL(path.join(REPO, 'dist', 'server', 'db.js')).href);
  await prisma.$executeRaw`UPDATE notes SET share_expires_at = now() - interval '1 hour' WHERE id = ${A.id}`;
  const open2 = await fetch(base + `/api/public/note/${sh.token}`);
  check('the link stops working after it ends', open2.status === 404, open2.status);
  const re = await api('POST', `/api/share/note/${A.id}`, { expiresInDays: null });
  const open3 = await fetch(base + `/api/public/note/${sh.token}`);
  check('choosing "never expires" turns the same link back on', re.expiresAt === null && open3.status === 200, open3.status);
  await page.goto(base + `/notes/${A.id}`);
  await page.locator('.s-note-bar .s-menu-wrap button').click();
  await page.locator('.s-menu button', { hasText: 'Share link' }).click();
  await page.locator('#s-share-exp').waitFor({ timeout: 5000 }).catch(() => {});
  check('the share box has a "Link expires" choice', await page.locator('#s-share-exp').isVisible().catch(() => false));
  await shot('notes1-share');
} catch (e) {
  console.log('FAIL  test crashed:', e.message);
  try { await shot('notes1-crash'); } catch {}
  process.exitCode = 1;
}
await finish();

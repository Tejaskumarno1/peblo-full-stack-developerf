// Files in a note: PowerPoint, Word, Excel, PDF and other files. Adding, previews, full-screen viewer with search, block menu, saving, share page, errors.
import { boot } from './lib.mjs';
import { makeFixtures } from './fixtures/make.mjs';
const { base, api, page, ctx, token, check, finish } = await boot();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const fx = await makeFixtures();
page.on('pageerror', (e) => console.log('  pageerror stack:', String(e.stack).split('\n').slice(0, 5).join(' / ')));

async function slash(text) {
  await page.keyboard.type('/' + text);
  await page.locator('.bn-suggestion-menu').waitFor({ timeout: 5000 });
  await wait(400);
}
async function newLine() {
  await page.locator('.bn-block-content').last().click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
}
/** /<kind>, then pick the file in the Add a file window. */
async function addFile(kind, file) {
  await newLine();
  await slash(kind);
  await page.keyboard.press('Enter');
  await page.locator('[data-testid="df-add"]').waitFor({ timeout: 5000 });
  const chooser = page.waitForEvent('filechooser');
  await page.locator('[data-testid="df-choose"]').click();
  await (await chooser).setFiles(file);
}
const frame = (kind) => page.locator(`[data-testid="docfile"][data-kind="${kind}"]`);

try {
  const n = (await api('POST', '/api/notes', { title: 'Launch notes', content: 'Files for the launch.' })).note;
  await page.goto(base + '/notes/' + n.id);
  await page.locator('.bn-editor').waitFor({ timeout: 20000 });
  await wait(1500);

  // ---- the insert menu
  await newLine();
  await page.keyboard.type('/');
  await page.locator('.bn-suggestion-menu').waitFor({ timeout: 5000 });
  const menuText = await page.locator('.bn-suggestion-menu').innerText();
  check('insert menu: a Files group with Presentation, Document, Spreadsheet, PDF, Any other file', ['Presentation', 'Document', 'Spreadsheet', 'PDF', 'Any other file'].every((t) => menuText.includes(t)), menuText.slice(0, 200));
  check('insert menu: shows shortcut hints (/ppt)', /\/ppt/i.test(menuText));
  await page.keyboard.press('Escape'); await wait(200);
  await page.keyboard.press('Backspace'); await wait(300);

  // ---- PowerPoint
  await addFile('ppt', fx.pptx);
  await frame('ppt').waitFor({ timeout: 20000 });
  await page.locator('[data-testid="df-count"]').first().waitFor({ timeout: 20000 });
  check('ppt: the frame shows the file name', (await frame('ppt').innerText()).includes('Launch-plan.pptx'));
  check('ppt: meta says 5 slides', /5 slides/.test(await frame('ppt').locator('[data-testid="df-meta"]').innerText()));
  check('ppt: counter starts at 1 / 5', /1 \/ 5/.test(await frame('ppt').locator('[data-testid="df-count"]').innerText()));
  await frame('ppt').locator('[data-testid="df-next"]').click(); await wait(300);
  check('ppt: next arrow moves to 2 / 5', /2 \/ 5/.test(await frame('ppt').locator('[data-testid="df-count"]').innerText()));
  await frame('ppt').locator('[data-testid="df-prev"]').click(); await wait(200);
  check('ppt: previous arrow goes back to 1 / 5', /1 \/ 5/.test(await frame('ppt').locator('[data-testid="df-count"]').innerText()));
  await frame('ppt').locator('[data-testid="df-slides"]').click(); await wait(400);
  check('ppt: the Slides chip shows a strip of 5 thumbnails', (await frame('ppt').locator('.df-strip .df-t').count()) === 5);
  await frame('ppt').locator('.df-strip .df-t').nth(3).click(); await wait(300);
  check('ppt: a thumbnail jumps to that slide (4 / 5)', /4 \/ 5/.test(await frame('ppt').locator('[data-testid="df-count"]').innerText()));
  check('ppt: a slide is really drawn (text from the file)', /Timeline/.test(await frame('ppt').innerText()) || (await frame('ppt').locator('.df-slide-box').innerText()).includes('Timeline'));

  // ---- Word
  await addFile('doc', fx.docx);
  await frame('doc').waitFor({ timeout: 20000 });
  await frame('doc').locator('section.docx').first().waitFor({ timeout: 20000 });
  check('doc: the page text is drawn', /redesign ships on Friday/.test(await frame('doc').innerText()));
  check('doc: meta mentions the size', /KB|B/.test(await frame('doc').locator('[data-testid="df-meta"]').innerText()));

  // ---- Excel
  await addFile('xls', fx.xlsx);
  await frame('xls').waitFor({ timeout: 20000 });
  await frame('xls').locator('.df-grid').waitFor({ timeout: 20000 });
  check('xls: meta says 2 sheets', /2 sheets/.test(await frame('xls').locator('[data-testid="df-meta"]').innerText()));
  check('xls: two sheet tabs, Budget and Q4', JSON.stringify(await frame('xls').locator('[data-testid="df-sheet-tab"]').allInnerTexts()) === JSON.stringify(['Budget', 'Q4']));
  check('xls: first sheet cells are shown', /Design/.test(await frame('xls').locator('.df-grid').innerText()));
  const rowsShown = await frame('xls').locator('.df-grid .df-gr').count();
  check('xls: a long sheet is capped (200 rows, not 260)', rowsShown > 100 && rowsShown <= 202, String(rowsShown));
  await frame('xls').locator('[data-testid="df-sheet-tab"]').nth(1).click(); await wait(300);
  check('xls: the Q4 tab shows its own cells', /Priya/.test(await frame('xls').locator('.df-grid').innerText()));

  // ---- PDF
  await addFile('pdf', fx.pdf);
  await frame('pdf').waitFor({ timeout: 20000 });
  await frame('pdf').locator('canvas').first().waitFor({ timeout: 20000 });
  check('pdf: meta says 4 pages', /4 pages/.test(await frame('pdf').locator('[data-testid="df-meta"]').innerText()));
  check('pdf: a page is painted on a canvas', (await frame('pdf').locator('canvas').count()) >= 1);
  await frame('pdf').locator('[data-testid="df-range"]').click();
  await page.locator('[data-testid="df-range-menu"]').waitFor();
  await page.locator('[data-testid="dr-3"]').click(); await wait(500);
  check('pdf: the page range chip says Pages 1 to 3', /Pages 1 to 3/.test(await frame('pdf').locator('[data-testid="df-range"]').innerText()));
  await frame('pdf').locator('[data-testid="df-range"]').click();
  await page.locator('[data-testid="dr-pick"]').click();
  await page.locator('[data-testid="dr-from"]').fill('2');
  await page.locator('[data-testid="dr-to"]').fill('4');
  await page.locator('[data-testid="dr-go"]').click(); await wait(500);
  check('pdf: Pick pages 2 to 4 is kept', /Pages 2 to 4/.test(await frame('pdf').locator('[data-testid="df-range"]').innerText()));

  // ---- full-screen viewer with search (the Word file, then the PDF)
  await frame('doc').locator('[data-testid="df-expand"]').click();
  await page.locator('[data-testid="df-viewer"]').waitFor({ timeout: 10000 });
  await page.locator('[data-testid="df-viewer"] section.docx').first().waitFor({ timeout: 20000 });
  check('viewer: opens full screen over the note', await page.locator('[data-testid="df-viewer"]').isVisible());
  check('viewer: has a Download link', (await page.locator('[data-testid="dv-download"]').count()) === 1);
  await page.locator('[data-testid="dv-search"]').click();
  await page.locator('[data-testid="dv-term"]').fill('friday');
  await wait(600);
  check('viewer: search finds the word in a Word file', /1 of 2|1 of 1/.test(await page.locator('[data-testid="dv-hits"]').innerText()), await page.locator('[data-testid="dv-hits"]').innerText());
  await page.keyboard.press('Escape'); await wait(300);
  if (await page.locator('[data-testid="df-viewer"]').count()) await page.locator('[data-testid="dv-close"]').click();
  await wait(300);
  check('viewer: closes and the note is back', (await page.locator('[data-testid="df-viewer"]').count()) === 0);

  await frame('pdf').locator('[data-testid="df-expand"]').click();
  await page.locator('[data-testid="df-viewer"] canvas').first().waitFor({ timeout: 20000 });
  check('viewer: the PDF shows its page count', /1 \/ 4/.test(await page.locator('[data-testid="df-vcount"]').innerText()));
  await page.locator('[data-testid="dv-search"]').click();
  await page.locator('[data-testid="dv-term"]').fill('Review on Friday');
  await page.waitForFunction(() => /1 of 1/.test(document.querySelector('[data-testid="dv-hits"]')?.textContent || ''), null, { timeout: 15000 });
  check('viewer: search in a PDF jumps to the page that has it (2 / 4)', /2 \/ 4/.test(await page.locator('[data-testid="df-vcount"]').innerText()));
  await page.locator('[data-testid="dv-close"]').click(); await wait(300);

  // ---- block menu
  await frame('ppt').hover();
  await frame('ppt').locator('[data-testid="df-more"]').click();
  await page.locator('[data-testid="df-menu"]').waitFor();
  await page.locator('[data-testid="dm-size-wide"]').click(); await wait(400);
  check('menu: Wide changes the frame size', (await page.locator('.df-wrap.fr-wide').count()) === 1);
  await page.locator('[data-testid="dm-readers"]').uncheck({ force: true }); await wait(300);
  await page.keyboard.press('Escape'); await wait(300);
  await frame('ppt').locator('[data-testid="df-more"]').click();
  await page.locator('[data-testid="dm-caption"]').click(); await wait(300);
  await page.locator('[data-testid="df-caption"]').fill('Plan for the launch');
  await page.locator('[data-testid="df-caption"]').blur(); await wait(500);
  check('menu: a caption can be added', (await page.locator('[data-testid="df-caption"]').inputValue()) === 'Plan for the launch');

  // ---- saved as Markdown, back after a reload
  await wait(2500);
  const saved = (await api('GET', '/api/notes/' + n.id)).note;
  const md = saved.content || '';
  check('saved: the note keeps all four files by address', (md.match(/\/api\/files\//g) || []).length === 4, md.slice(0, 400));
  check('saved: frame size, caption and the download switch travel in the address', /fr=wide/.test(md) && /cp=Plan/.test(md) && /dl=0/.test(md), md.slice(0, 400));
  await page.reload();
  await page.locator('.bn-editor').waitFor({ timeout: 20000 });
  await page.locator('[data-testid="docfile"]').first().waitFor({ timeout: 20000 });
  check('reload: all four files come back as frames', (await page.locator('[data-testid="docfile"]').count()) === 4);
  check('reload: the wide size and the caption survived', (await page.locator('.df-wrap.fr-wide').count()) === 1 && (await page.locator('[data-testid="df-caption"]').count()) === 1);

  // ---- remove
  await frame('doc').hover();
  await frame('doc').locator('[data-testid="df-more"]').click();
  await page.locator('[data-testid="dm-remove"]').click(); await wait(500);
  check('menu: Remove takes the file out of the note', (await page.locator('[data-testid="docfile"]').count()) === 3);

  // ---- a file nobody can preview becomes a card to download
  await addFile('file', fx.pages);
  await page.locator('[data-testid="docfile"][data-kind="any"]').waitFor({ timeout: 20000 });
  check('unsupported: .pages shows a download card, not a broken preview', /Report\.pages/.test(await page.locator('[data-testid="docfile"][data-kind="any"]').innerText()) && (await page.locator('[data-testid="docfile"][data-kind="any"] [data-testid="df-expand"]').count()) === 0);

  // ---- too big
  const before = await page.locator('[data-testid="docfile"]').count();
  await addFile('ppt', fx.big);
  await page.locator('[data-testid="df-job"].err').waitFor({ timeout: 15000 });
  check('too big: says the 25 MB limit plainly', /25 MB/.test(await page.locator('[data-testid="df-jobs"]').innerText()));
  check('too big: nothing was added to the note', (await page.locator('[data-testid="docfile"]').count()) === before);

  // ---- drag and drop of a file (not a picture)
  await page.locator('.bn-block-content').first().click();
  const dt = await page.evaluateHandle(async () => {
    const d = new DataTransfer();
    d.items.add(new File([new Uint8Array([1, 2, 3, 4])], 'notes.zip', { type: 'application/zip' }));
    return d;
  });
  await page.locator('.bn-block-content').first().dispatchEvent('dragenter', { dataTransfer: dt });
  check('drop: dragging a file over the note shows the drop veil', (await page.locator('[data-testid="df-drop"]').count()) === 1);
  await page.locator('.bn-block-content').first().dispatchEvent('drop', { dataTransfer: dt });
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="docfile"][data-kind="any"]').length >= 2, null, { timeout: 15000 });
  check('drop: the dropped file lands in the note', (await page.locator('[data-testid="docfile"][data-kind="any"]').count()) === 2);

  // ---- the server
  const up = await fetch(base + '/api/files', { method: 'POST', headers: { 'X-File-Name': 'x.pdf' }, body: Buffer.from('hi') });
  check('server: adding a file needs a sign-in (401)', up.status === 401);
  const ok = await fetch(base + '/api/files', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'X-File-Name': 'page.html', 'X-File-Type': 'text/html' }, body: Buffer.from('<script>1</script>') });
  const okj = await ok.json();
  const got = await fetch(base + okj.url);
  check('server: a web page uploaded as a file is served as a download, not as a page', /attachment/.test(got.headers.get('content-disposition') || '') && got.headers.get('content-type') === 'application/octet-stream' && got.headers.get('x-content-type-options') === 'nosniff');
  const huge = await fetch(base + '/api/files', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'X-File-Name': 'big.bin' }, body: Buffer.alloc(26 * 1024 * 1024, 1) });
  check('server: over 25 MB is refused (413)', huge.status === 413, String(huge.status));
  const missing = await fetch(base + '/api/files/does-not-exist-123');
  check('server: an unknown file is 404', missing.status === 404);

  // ---- the share page: readers see the frames and can download, but cannot edit
  const tok = (await api('POST', `/api/share/note/${n.id}`, {})).token;
  const guest = await ctx.browser().newContext({ viewport: { width: 1440, height: 900 } });
  await guest.addInitScript(() => { try { localStorage.setItem('peblo-guest-name', 'Pia'); localStorage.setItem('peblo-guest-tour', '1'); } catch {} });
  const gp = await guest.newPage();
  await gp.goto(`${base}/s/note/${tok}`);
  await gp.locator('[data-testid="docfile"]').first().waitFor({ timeout: 25000 });
  check('share page: readers see the files as frames', (await gp.locator('[data-testid="docfile"]').count()) >= 3);
  check('share page: readers get no edit menu', (await gp.locator('[data-testid="df-more"]').count()) === 0);
  check('share page: the preview is drawn without signing in', (await gp.locator('[data-testid="docfile"][data-kind="ppt"] .df-slide-box, [data-testid="docfile"][data-kind="pdf"] canvas').count()) >= 1);
  await guest.close();
} catch (e) {
  check('test ran to the end', false, e && e.stack);
}
await finish();

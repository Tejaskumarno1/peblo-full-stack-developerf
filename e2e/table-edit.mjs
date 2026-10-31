// Table editing (mockup Table.dc): hover "+" handles, drag to resize columns, rows and the whole table, the toolbar, the context menu,
// settings kept in the note (reload and Markdown round trip), "/table" in the slash menu, tab separated paste.
import { boot } from './lib.mjs';

const { base, api, page, check, finish } = await boot();
const SHOTS = process.env.TABLE_SHOTS || '';
const shot = async (name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` }); };
const md = '# Pi planning\n\n| Board | Feature | Owner |\n| --- | --- | --- |\n| 24-27 | Session setup | Eshwar |\n| 28 | Team boards | Tejas |\n| 29 | Draft plan review | Anna |\n\nAfter the table.\n';
const wait = (ms) => page.waitForTimeout(ms);
const T = () => page.locator('.bn-editor table').first();
const cols = () => page.evaluate(() => [...document.querySelector('.bn-editor table').querySelectorAll(':scope > colgroup > col')].map((c) => Math.round(c.getBoundingClientRect().width)));
const dims = () => page.evaluate(() => { const t = document.querySelector('.bn-editor table'); return { rows: t.rows.length, cells: t.rows[0].cells.length, w: Math.round(t.getBoundingClientRect().width) }; });
const rect = (sel) => page.evaluate((s) => { const r = document.querySelector(s).getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, r: r.right, b: r.bottom }; }, sel);
const cell = (r, c) => T().locator('tr').nth(r).locator('td, th').nth(c);
const noteMd = async (id) => (await api('GET', `/api/notes/${id}`)).note.content;
const savedWith = async (id, re) => { for (let i = 0; i < 40; i++) { const c = await noteMd(id); if (re.test(c)) return c; await wait(250); } return await noteMd(id); };
const bar = (id) => page.locator(`[data-testid="tt-${id}"]`);

try {
  const note = (await api('POST', '/api/notes', { title: 'Tables', content: md, tags: [] })).note;
  await page.goto(base + '/notes/' + note.id);
  await T().waitFor({ timeout: 20000 });
  await wait(1200);
  const d0 = await dims();
  check('table is drawn with 4 rows and 3 columns', d0.rows === 4 && d0.cells === 3, JSON.stringify(d0));
  check('the table fills the note when nobody has sized it', d0.w > 450, String(d0.w));
  check('the editor strips that covered the next paragraph are gone', (await page.locator('.bn-extend-button:visible').count()) === 0);

  // ---- hover "+" at a column edge and a row edge
  const c0 = await cols(); const tr0 = await rect('.bn-editor table');
  const bx = tr0.x + c0[0];
  await cell(1, 0).click(); await wait(200);
  await page.mouse.move(bx, tr0.y + 25); await wait(300);
  check('a "+" shows at the column edge', await page.locator('[data-testid="tt-add-col"]').isVisible());
  check('and a grip to drag the column border', await page.locator('[data-testid="tt-col-grip"]').isVisible());
  await shot('hover-col');
  await page.locator('[data-testid="tt-add-col"]').click(); await wait(500);
  check('clicking the column "+" adds a column', (await dims()).cells === 4);
  const ys = await page.evaluate(() => [...document.querySelector('.bn-editor table').rows].map((r) => r.getBoundingClientRect().top));
  const tr1 = await rect('.bn-editor table');
  await page.mouse.move(tr1.x + 40, ys[1]); await wait(300);
  check('a "+" shows at the row edge', await page.locator('[data-testid="tt-add-row"]').isVisible());
  await page.locator('[data-testid="tt-add-row"]').click(); await wait(500);
  check('clicking the row "+" adds a row', (await dims()).rows === 5);
  await page.keyboard.press('Control+z'); await wait(300); await page.keyboard.press('Control+z'); await wait(500);
  check('undo takes both back', (await dims()).rows === 4 && (await dims()).cells === 3, JSON.stringify(await dims()));

  // ---- drag a column border: live, one edit, saved
  await page.evaluate(() => { window.__w = []; const col = document.querySelector('.bn-editor table col'); const loop = () => { window.__w.push(Math.round(col.getBoundingClientRect().width)); window.__raf = requestAnimationFrame(loop); }; loop(); });
  const c1 = await cols(); const tr2 = await rect('.bn-editor table');
  await page.mouse.move(tr2.x + c1[0], tr2.y + 60); await wait(300);
  await page.mouse.down();
  await page.mouse.move(tr2.x + c1[0] + 90, tr2.y + 60, { steps: 18 });
  await wait(150);
  check('a badge shows the width while dragging', /px/.test(await page.locator('.pbtt-px').first().textContent().catch(() => '')));
  await shot('drag-col');
  await page.mouse.up(); await wait(400);
  const samples = await page.evaluate(() => { cancelAnimationFrame(window.__raf); return window.__w; });
  const c2 = await cols();
  check('the column is about 90px wider', Math.abs(c2[0] - (c1[0] + 90)) <= 3, `${c1[0]} -> ${c2[0]}`);
  let back = 0; for (let i = 1; i < samples.length; i++) back = Math.max(back, samples[i - 1] - samples[i]);
  check('the width only grows while dragging right (no flicker)', back <= 1, `largest step back ${back}px in ${samples.length} samples`);
  check('the other columns kept their width', c2[1] === c1[1] && c2[2] === c1[2], JSON.stringify([c1, c2]));
  const saved = await savedWith(note.id, /pb-table/);
  const m = /<!--pb-table (\{.*\})-->/.exec(saved);
  check('the note keeps the widths in a hidden marker after the table', !!m && JSON.parse(m[1]).cw?.[0] === c2[0], saved);
  check('and the table is still a plain Markdown table', /\|\s*Board\s*\|\s*Feature\s*\|\s*Owner\s*\|/.test(saved) && /\|\s*-{3,}/.test(saved));
  await page.reload(); await T().waitFor({ timeout: 20000 }); await wait(1500);
  const c3 = await cols();
  check('after a reload the width is the same', Math.abs(c3[0] - c2[0]) <= 2, `${c2[0]} -> ${c3[0]}`);
  check('the marker is not shown as text in the note', !/pb-table/.test(await page.locator('.bn-editor').innerText()));

  // ---- drag a row border
  const r0 = await page.evaluate(() => document.querySelector('.bn-editor table').rows[1].getBoundingClientRect().height);
  const tr3 = await rect('.bn-editor table');
  const yb = await page.evaluate(() => document.querySelector('.bn-editor table').rows[2].getBoundingClientRect().top);
  await page.mouse.move(tr3.x + 60, yb); await wait(300);
  await page.locator('[data-testid="tt-row-grip"]').waitFor({ timeout: 3000 });
  await page.mouse.down(); await page.mouse.move(tr3.x + 60, yb + 40, { steps: 10 }); await page.mouse.up(); await wait(500);
  const r1 = await page.evaluate(() => document.querySelector('.bn-editor table').rows[1].getBoundingClientRect().height);
  check('dragging a row border makes the row taller', r1 >= r0 + 30, `${r0} -> ${r1}`);
  check('the row height is saved', /"rh":\[0,\d+/.test(await savedWith(note.id, /"rh"/)));

  // ---- the corner resizes the whole table
  const w0 = (await dims()).w; const tr4 = await rect('.bn-editor table');
  await page.mouse.move(tr4.r - 30, tr4.b - 10); await wait(300);
  const cr = await rect('[data-testid="tt-corner"]');
  await page.mouse.move(cr.x + 9, cr.y + 9); await page.mouse.down(); await page.mouse.move(cr.x + 9 - 120, cr.y + 9, { steps: 12 }); await page.mouse.up(); await wait(500);
  const w1 = (await dims()).w;
  check('the corner handle scales the whole table', Math.abs(w1 - (w0 - 120)) <= 6, `${w0} -> ${w1}`);

  // ---- the toolbar
  await cell(2, 0).click(); await wait(300);
  check('the toolbar shows over the table', await page.locator('[data-testid="table-toolbar"]').isVisible());
  check('and so do the status chips', /4 rows, 3 columns/.test(await page.locator('[data-testid="table-chips"]').innerText()));
  await shot('toolbar');
  await bar('hrow').click(); await wait(400);
  check('header row can be switched off', (await T().locator('tr').first().locator('th').count()) === 0);
  await bar('hrow').click(); await wait(300);
  await bar('hcol').click(); await wait(400);
  check('header column can be switched on', (await T().locator('th').count()) >= 4, String(await T().locator('th').count()));
  await bar('hcol').click(); await wait(300);
  await cell(2, 0).click();
  await bar('al-center').click(); await wait(300);
  check('align center', (await cell(2, 0).evaluate((e) => getComputedStyle(e).textAlign)) === 'center');
  await bar('al-right').click(); await wait(300);
  check('align right', (await cell(2, 0).evaluate((e) => getComputedStyle(e).textAlign)) === 'right');
  await bar('al-left').click(); await wait(300);
  check('align left', ['left', 'start'].includes(await cell(2, 0).evaluate((e) => getComputedStyle(e).textAlign)));
  await bar('valign').click(); await wait(300);
  check('vertical align (middle)', (await page.locator('[data-pb-va="middle"]').count()) === 1);
  await bar('color').click(); await wait(200);
  await page.locator('[data-testid="pbc-bg-red"]').first().click(); await wait(300);
  await page.locator('[data-testid="pbc-text-blue"]').first().click(); await wait(400);
  check('cell color', (await cell(2, 0).getAttribute('data-background-color')) === 'red');
  check('text color', (await cell(2, 0).getAttribute('data-text-color')) === 'blue');
  await bar('color').click();
  await bar('zebra').click(); await wait(300);
  check('zebra stripes', (await page.locator('[data-pb-z="1"]').count()) === 1);

  // merge and split
  await cell(3, 1).click(); await page.keyboard.down('Shift'); await cell(3, 2).click(); await page.keyboard.up('Shift'); await wait(300);
  check('two cells selected shows in the chips', /2 cells selected/.test(await page.locator('[data-testid="table-chips"]').innerText()));
  await bar('merge').click(); await wait(500);
  check('merge cells', (await T().locator('td[colspan="2"]').count()) === 1);
  await shot('merged');
  const mm = await savedWith(note.id, /"cs":2/);
  check('the merge is written to the note (the table stays a plain grid)', /"cs":2/.test(mm) && /"z":1/.test(mm) && /"bg":"red"/.test(mm) && /"tc":"blue"/.test(mm), mm);
  await page.reload(); await T().waitFor({ timeout: 20000 }); await wait(1500);
  check('merged cell, colours and stripes come back after a reload', (await T().locator('td[colspan="2"]').count()) === 1 && (await cell(2, 0).getAttribute('data-background-color')) === 'red' && (await page.locator('[data-pb-z="1"]').count()) === 1);
  await T().locator('td[colspan="2"]').click(); await wait(500);
  await shot('before-split');
  console.log('toolbar', await page.locator('[data-testid="table-toolbar"]').count(), 'active', await page.evaluate(() => document.activeElement?.className?.slice(0, 40) + '|' + document.activeElement?.tagName));
  await bar('split').click(); await wait(500);
  check('split cell', (await T().locator('td[colspan="2"]').count()) === 0);

  // sort, distribute, csv
  await cell(1, 0).click(); await wait(200);
  await bar('sort').click(); await wait(500);
  const col0 = async () => page.evaluate(() => [...document.querySelector('.bn-editor table').rows].slice(1).map((r) => r.cells[0].innerText.trim()));
  const sorted = await col0();
  check('sort A to Z keeps the header on top', sorted.join('|') === [...sorted].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).join('|') && (await T().locator('tr').first().innerText()).includes('Board'), sorted.join('|'));
  await bar('sort').click(); await wait(500);
  const desc = await col0();
  check('sort again for Z to A', desc.join('|') === [...sorted].reverse().join('|'), desc.join('|'));
  await bar('distribute').click(); await wait(500);
  const cd = await cols();
  check('distribute columns evenly', Math.max(...cd) - Math.min(...cd) <= 2, JSON.stringify(cd));
  await page.evaluate(() => { window.__csv = null; Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (t) => { window.__csv = t; } }, configurable: true }); });
  await bar('csv').click(); await wait(300);
  const csv = await page.evaluate(() => window.__csv);
  check('copy as CSV', typeof csv === 'string' && csv.split('\r\n').length === 4 && /^Board,Feature,Owner/.test(csv), String(csv));

  // ---- context menu
  await cell(2, 1).click({ button: 'right' }); await wait(300);
  check('right click opens the table menu', await page.locator('[data-testid="table-context-menu"]').isVisible());
  await shot('context-menu');
  await page.locator('[data-testid="cm-dup-row"]').click(); await wait(500);
  check('duplicate row', (await dims()).rows === 5);
  await cell(2, 1).click({ button: 'right' }); await page.locator('[data-testid="cm-del-row"]').click(); await wait(500);
  check('delete row', (await dims()).rows === 4);
  await cell(2, 1).click({ button: 'right' }); await page.locator('[data-testid="cm-dup-col"]').click(); await wait(500);
  check('duplicate column', (await dims()).cells === 4);
  await cell(2, 1).click({ button: 'right' }); await page.locator('[data-testid="cm-del-col"]').click(); await wait(500);
  check('delete column', (await dims()).cells === 3);
  await cell(2, 1).click({ button: 'right' }); await page.locator('[data-testid="cm-move-up"]').click(); await wait(500);
  check('move row up', (await page.evaluate(() => document.querySelector('.bn-editor table').rows[1].cells[1].innerText)).trim().length > 0);
  await cell(2, 1).click({ button: 'right' }); await page.locator('[data-testid="cm-freeze"]').click(); await wait(400);
  check('freeze header row', (await page.locator('[data-pb-fh="1"]').count()) === 1);
  await cell(2, 1).click({ button: 'right' }); await page.locator('[data-testid="cm-borders"]').click(); await wait(400);
  check('borders: all lines', (await page.locator('[data-pb-b="grid"]').count()) === 1);
  await cell(2, 1).click({ button: 'right' }); await page.locator('[data-testid="cm-fit"]').click(); await wait(500);
  const fitW = await page.evaluate(() => ({ t: Math.round(document.querySelector('.bn-editor table').getBoundingClientRect().width), b: document.querySelector('.bn-editor table').closest('.bn-block-content').clientWidth }));
  check('fit columns to width', Math.abs(fitW.t - fitW.b) <= 6, JSON.stringify(fitW));
  await cell(2, 1).click(); await page.keyboard.press('Alt+ArrowUp'); await wait(500);
  check('Alt+Up adds a row above', (await dims()).rows === 5);

  // ---- tab separated text becomes a table
  const before = await page.locator('.bn-editor table').count();
  await page.evaluate(() => document.activeElement && document.activeElement.blur()); await wait(300); await page.locator('.bn-editor p', { hasText: /^After the table\.$/ }).click({ position: { x: 40, y: 8 } }); await wait(300); await page.keyboard.press('End'); await wait(200); await page.keyboard.press('Enter'); await wait(200);
  await page.evaluate(() => { const dt = new DataTransfer(); dt.setData('text/plain', 'Name\tQty\nPear\t9\nFig\t4'); document.activeElement.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); });
  await wait(700);
  check('pasted tab separated text becomes a table', (await page.locator('.bn-editor table').count()) === before + 1);
  await shot('pasted');
  const last = await page.evaluate(() => { const t = [...document.querySelectorAll('.bn-editor table')].pop(); return { r: t.rows.length, c: t.rows[0].cells.length, text: t.innerText.replace(/\s+/g, ' ') }; });
  check('with the right rows and columns', last.r === 3 && last.c === 2 && /Pear/.test(last.text), JSON.stringify(last));
  // ---- /table in the slash menu
  const before2 = await page.locator('.bn-editor table').count();
  await page.evaluate(() => document.activeElement && document.activeElement.blur()); await wait(300); await page.locator('.bn-editor p', { hasText: /^After the table\.$/ }).click({ position: { x: 40, y: 8 } }); await wait(300); await page.keyboard.press('End'); await wait(200); await page.keyboard.press('Enter');
  await page.keyboard.type('/table'); await wait(600);
  const first = (await page.locator('.bn-suggestion-menu-item').first().innerText()).trim();
  check('"/table" offers Table first', /^Table/i.test(first), first);
  await page.keyboard.press('Enter'); await wait(700);
  check('and Enter puts in a table', (await page.locator('.bn-editor table').count()) === before2 + 1);

  await shot('final');

  // ---- no stray empty marker lines pile up: save, reload twice, the same Markdown
  await wait(3000);
  const a = await noteMd(note.id);
  await page.reload(); await T().waitFor({ timeout: 20000 }); await wait(1500);
  await page.locator('.bn-editor p', { hasText: 'After the table.' }).first().click(); await page.keyboard.press('End'); await page.keyboard.type(' ok'); await wait(1500);
  const b = await savedWith(note.id, / ok/);
  check('Markdown round trip is stable (no markers added or lost)', (a.match(/pb-table/g) || []).length === (b.match(/pb-table/g) || []).length, `${(a.match(/pb-table/g) || []).length} vs ${(b.match(/pb-table/g) || []).length}`);
} catch (e) {
  console.log(String(e && e.message).slice(0,1500)); check('table-edit ran', false, 'see above');
} finally {
  await finish();
}






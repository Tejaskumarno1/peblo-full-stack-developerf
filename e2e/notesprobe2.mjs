import { boot } from './lib.mjs';
const { base, api, page, finish } = await boot();
const say = (k, v) => console.log(`FINDING ${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`);
await page.addInitScript(() => { try { localStorage.setItem('peblo-debug', '1'); localStorage.setItem('peblo-style', 'soft'); } catch {} });
const mk = async (title, content) => (await api('POST', '/api/notes', { title, content })).note;
const open = async (n) => { await page.goto(base + '/notes/' + n.id); await page.waitForSelector('.bn-editor', { timeout: 15000 }); await page.waitForFunction(() => !!window.__pebloEditor, null, { timeout: 8000 }); await page.waitForTimeout(800); };
const get = async (id) => (await api('GET', '/api/notes/' + id)).note;

// Table with no header row: does each open+edit add an empty row?
const t = await mk('tbl', '| A | B |\n| - | - |\n| 1 | 2 |\n| 3 | 4 |');
const rowsOf = () => page.evaluate(() => { const b = window.__pebloEditor.document.find((x) => x.type === 'table'); return b ? { rows: b.content.rows.length, headerRows: b.content.headerRows } : null; });
await open(t); say('T1 rows when opened', await rowsOf());
for (let i = 0; i < 3; i++) {
  await page.evaluate(() => { const ed = window.__pebloEditor; ed.insertBlocks([{ type: 'paragraph', content: 'edit' }], ed.document[ed.document.length - 1], 'after'); });
  await page.waitForTimeout(2500);
  await open(t);
}
say('T2 rows after 3 edit+reload cycles', await rowsOf());
say('T3 saved markdown', (await get(t.id)).content.slice(0, 160));

// Code block language, math, toggle children, and paste of a wide table
const k = await mk('code', '```python\nprint(1)\n```\n\nInline $E=mc^2$ and\n\n$$\\int_0^1 x dx$$\n');
await open(k);
say('K1 blocks', await page.evaluate(() => window.__pebloEditor.document.map((b) => ({ t: b.type, lang: b.props?.language, txt: Array.isArray(b.content) ? b.content.map((c) => c.text).join('') : '' }))));
say('K2 math rendered?', await page.evaluate(() => !!document.querySelector('.katex, mjx-container')));

// Slash menu items available
await open(k);
await page.evaluate(() => { const ed = window.__pebloEditor; ed.insertBlocks([{ type: 'paragraph', content: '' }], ed.document[0], 'before'); ed.setTextCursorPosition(ed.document[0], 'end'); });
await page.keyboard.type('/');
await page.waitForTimeout(800);
const items = await page.evaluate(() => [...document.querySelectorAll('.bn-suggestion-menu-item')].map((e) => e.innerText.split('\n')[0]));
say('S1 slash menu (first screen)', items);
await finish();

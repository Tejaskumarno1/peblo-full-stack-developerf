// Probe (not a pass/fail test): what does the note system lose or do badly? Prints findings.
import { boot } from './lib.mjs';
const { base, api, page, ctx, finish, token } = await boot();
const say = (k, v) => console.log(`FINDING ${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`);
await page.addInitScript(() => { try { localStorage.setItem('peblo-debug', '1'); localStorage.setItem('peblo-style', 'soft'); } catch {} });
const mk = async (title, content) => (await api('POST', '/api/notes', { title, content })).note;
const open = async (n) => { await page.goto(base + '/notes/' + n.id); await page.waitForSelector('.bn-editor', { timeout: 15000 }); await page.waitForFunction(() => !!window.__pebloEditor, null, { timeout: 8000 }); await page.waitForTimeout(800); };
const get = async (id) => (await api('GET', '/api/notes/' + id)).note;

// A. formatting that Markdown cannot hold
const a = await mk('fmt', 'hello');
await open(a);
await page.evaluate(() => {
  const ed = window.__pebloEditor;
  ed.insertBlocks([
    { type: 'paragraph', props: { textAlignment: 'center', textColor: 'red', backgroundColor: 'yellow' }, content: [{ type: 'text', text: 'COLORED CENTERED', styles: { textColor: 'blue', backgroundColor: 'green', bold: true } }] },
    { type: 'table', content: { type: 'tableContent', rows: [{ cells: [[{ type: 'text', text: 'h1', styles: { bold: true } }], [{ type: 'text', text: 'h2', styles: {} }]] }, { cells: [[{ type: 'text', text: 'a', styles: { textColor: 'red' } }], [{ type: 'text', text: 'b', styles: {} }]] }] } },
  ], ed.document[0], 'before');
});
await page.waitForTimeout(3500);
const na = await get(a.id);
say('A1 saved markdown of colored+centered paragraph', na.content.slice(0, 200));
await open(a);
const reloaded = await page.evaluate(() => JSON.stringify(window.__pebloEditor.document.map((b) => ({ t: b.type, p: { a: b.props?.textAlignment, c: b.props?.textColor, bg: b.props?.backgroundColor }, c: Array.isArray(b.content) ? b.content.map((x) => ({ s: x.styles, x: x.text })) : 'table' }))));
say('A2 after reload (styles survive?)', reloaded.slice(0, 500));

// B. big note: cost of the full Markdown rebuild that runs on every change
const big = await mk('big', Array.from({ length: 1500 }, (_, i) => `Paragraph ${i} with **bold** and a [link](/notes/x) and some more words to make it realistic.`).join('\n\n'));
await open(big);
const timing = await page.evaluate(async () => {
  const ed = window.__pebloEditor; const t = performance.now(); const md = await ed.blocksToMarkdownLossy(ed.document); return { ms: Math.round(performance.now() - t), blocks: ed.document.length, chars: md.length };
});
say('B1 full markdown rebuild per change (1500 paragraphs)', timing);
const typing = await page.evaluate(async () => {
  const ed = window.__pebloEditor; const lat = [];
  for (let i = 0; i < 8; i++) { const t = performance.now(); ed.insertInlineContent('x'); await new Promise((r) => setTimeout(r, 0)); lat.push(Math.round(performance.now() - t)); }
  return lat;
});
say('B2 ms per keystroke (insertInlineContent) on that note', typing);

// C. two stale clients: last write wins silently
const c = await mk('conflict', 'start');
const r1 = await fetch(base + '/api/notes/' + c.id, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify({ content: 'phone edit' }) });
const r2 = await fetch(base + '/api/notes/' + c.id, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify({ content: 'laptop edit (never saw the phone edit)' }) });
say('C1 stale second write', { first: r1.status, second: r2.status, final: (await get(c.id)).content });

// D. offline typing
const d = await mk('offline', 'before');
await open(d);
await ctx.setOffline(true);
await page.evaluate(() => { const ed = window.__pebloEditor; ed.insertBlocks([{ type: 'paragraph', content: 'typed while offline' }], ed.document[0], 'before'); });
await page.waitForTimeout(3500);
const status1 = await page.evaluate(() => document.body.innerText.match(/Couldn.t save|Save failed|Saving…|Editing…|Saved[^\n]*/)?.[0] || 'none');
await ctx.setOffline(false);
await page.waitForTimeout(5000);
const afterBack = (await get(d.id)).content;
say('D1 offline typing', { statusShown: status1, serverHasItAfterReconnectAndWaiting: /typed while offline/.test(afterBack) });

// E. pictures live inside the note text
const px = 'iVBORw0KGgo' + 'A'.repeat(1_400_000);
const e = await mk('pic', 'x ![p](data:image/png;base64,' + px + ')');
const sz = await fetch(base + '/api/notes/' + e.id, { headers: { Authorization: 'Bearer ' + token } }).then((r) => r.text());
say('E1 one picture note, bytes sent on every open', sz.length);
const search = await api('GET', '/api/notes?search=AAAAAAAA');
say('E2 search for gibberish "AAAAAAAA" matches the picture note', (search.notes || []).some((n) => n.id === e.id));
const huge = await fetch(base + '/api/notes/' + e.id, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify({ content: 'y'.repeat(12_000_000) }) });
say('E3 saving a 12 MB note', huge.status);

// F. versions: how many are kept after many edits in quick succession
const f = await mk('versions', 'v0');
for (let i = 1; i <= 5; i++) await api('PATCH', '/api/notes/' + f.id, { content: 'edit ' + i });
const vs = await api('GET', '/api/notes/' + f.id + '/backups');
say('F1 versions kept after 5 quick edits', (vs.backups || []).length);

await finish();

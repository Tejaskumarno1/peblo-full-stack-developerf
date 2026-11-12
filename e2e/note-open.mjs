// Opening a note is never blank: its text shows at once (plain, read only) while the live copy connects, then the editor takes over.
import { boot } from './lib.mjs';
const { base, api, page, ctx, check, finish } = await boot();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  const n = (await api('POST', '/api/notes', { title: 'Opening probe', content: '## Plan\n\nFirst line the reader sees at once.\n\n- one\n- [ ] two' })).note;
  // 1) the live connection never answers: the text must still be on screen
  const p2 = await ctx.newPage();
  await p2.routeWebSocket(/\/(yjs|collab|ws)/i, () => { /* never connects */ });
  await p2.goto(base + '/notes/' + n.id, { waitUntil: 'domcontentloaded' });
  await p2.getByTestId('note-preview').waitFor({ timeout: 15000 });
  check('the text shows while the live copy connects', /First line the reader sees at once/.test(await p2.getByTestId('note-preview').innerText()));
  check('headings and list items show', /Plan/.test(await p2.getByTestId('note-preview').innerText()) && /two/.test(await p2.getByTestId('note-preview').innerText()));
  await p2.close();
  // 1b) a note with pictures: the preview draws the picture, never its Markdown text
  const pn = (await api('POST', '/api/notes', { title: 'Picture probe', content: 'before\n\n![image.png](/api/media/probe-a.png#pw=300&rc=1068&rp=300)\n\nafter' })).note;
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const p4 = await ctx.newPage();
  await p4.routeWebSocket(/\/(yjs|collab|ws)/i, () => { /* never connects */ });
  await p4.route(/\/api\/media\/probe-a\.png/, (r) => r.fulfill({ status: 200, contentType: 'image/png', body: png }));
  await p4.goto(base + '/notes/' + pn.id, { waitUntil: 'domcontentloaded' });
  await p4.getByTestId('note-preview').waitFor({ timeout: 15000 });
  check('a picture shows as a picture in the preview', (await p4.locator('[data-testid="note-preview"] .pic img').count()) === 1);
  check('no picture Markdown shows as text', !/!\[|\/api\/media|#pw=/.test(await p4.getByTestId('note-preview').innerText()));
  await p4.close();
  // 2) normal: the text is there and the placeholder goes away once the editor is ready
  await page.goto(base + '/notes/' + n.id, { waitUntil: 'domcontentloaded' });
  await page.locator('.bn-editor').waitFor({ timeout: 20000 });
  await page.waitForFunction(() => !document.querySelector('[data-testid="note-preview"]'), null, { timeout: 15000 });
  check('the placeholder is gone once the editor is ready', (await page.getByTestId('note-preview').count()) === 0);
  check('the editor holds the note text', /First line the reader sees at once/.test(await page.locator('.bn-editor').innerText()));
  // 3) the Notes screen outline is shown while its code downloads, never a bare spinner
  const p3 = await ctx.newPage();
  let held = false;
  await p3.route(/SoftNotesGate.*\.js/, async (r) => { held = true; await wait(1500); await r.continue(); });
  await p3.goto(base + '/', { waitUntil: 'domcontentloaded' });
  await p3.evaluate(() => { history.pushState({}, '', '/notes'); window.dispatchEvent(new PopStateEvent('popstate')); });
  await wait(300);
  check('the Notes outline shows while the screen loads (or the code was already warm)', (await p3.getByTestId('notes-skeleton').count()) >= 1 || !held);
  await p3.close();
} catch (e) { check('note-open ran without crashing', false, e?.stack || e); }
await finish();

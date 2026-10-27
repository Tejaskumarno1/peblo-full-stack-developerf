import { boot } from './lib.mjs';
const { base, api, page, check, finish } = await boot();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const txt = () => page.locator('.bn-editor').innerText().then((t) => t.replace(/\s+/g, ' '));
const info = () => page.evaluate(() => { const ed = document.querySelector('.ProseMirror').editor; const um = ed.state.plugins.find((p) => /y-undo/.test(p.key)).getState(ed.state).undoManager; const sz = (it) => { let n = 0; it.insertions.clients.forEach((a) => a.forEach((d) => { n += d.len; })); let m = 0; it.deletions.clients.forEach((a) => a.forEach((d) => { m += d.len; })); return n + '/' + m; }; return { undo: um.undoStack.length, redo: um.redoStack.length, items: um.undoStack.map(sz), lastChange: Date.now() % 100000 - (um.lastChange % 100000) }; });
try {
  const n = (await api('POST', '/api/notes', { title: 'Probe', content: 'Team offsite photos.' })).note;
  await page.goto(base + '/notes/' + n.id);
  await page.waitForFunction(() => document.querySelector('.ProseMirror') && document.querySelector('.ProseMirror').editor);
  await page.evaluate(() => { const ed = document.querySelector('.ProseMirror').editor; const pl = ed.state.plugins.find((p) => /y-undo/.test(p.key)); if (!pl) { window.__noUndoYet = true; return; } const um = pl.getState(ed.state).undoManager; const d = um.destroy.bind(um); um.destroy = () => { window.__destroyStack = new Error().stack; d(); }; });
  await wait(2500);
  console.log('destroy stack:', await page.evaluate(() => window.__destroyStack || ('none ' + window.__noUndoYet)));
  console.log('loaded  :', JSON.stringify(await info()));
  await page.evaluate(() => { const ed = document.querySelector('.ProseMirror').editor; const ss = ed.state.plugins.find((p) => /y-sync/.test(p.key)).getState(ed.state); window.__orig = []; ss.doc.on('afterTransaction', (tr) => { const um = ed.state.plugins.find((p) => /y-undo/.test(p.key)).getState(ed.state).undoManager; const nm = (o) => (o && o.key) || (o && o.constructor && o.constructor.name) || String(o); window.__orig.push('T' + um.trackedOrigins.has(tr.origin) + ' H' + (ss.doc._observers.get('afterTransaction') || new Set()).has(um.afterTransactionHandler) + ' S' + um.scope.some((t) => tr.changedParentTypes.has(t)) + ' C' + um.captureTransaction(tr) + ' [' + [...um.trackedOrigins].map(nm).join('+') + '] ' + nm(tr.origin)); }); });
  await page.locator('.bn-block-content').first().click();
  await page.keyboard.press('End');
  await page.keyboard.type(' alpha');
  await wait(900);
  console.log('alpha   :', JSON.stringify(await info()), JSON.stringify(await page.evaluate(() => window.__orig.slice(-12))));
  await page.keyboard.type(' beta');
  await wait(900);
  console.log('beta    :', JSON.stringify(await info()), await txt());
  for (const k of ['Control+z', 'Control+z', 'Control+y', 'Control+y']) { await page.keyboard.press(k); await wait(500); console.log(k.padEnd(10), '->', await txt(), JSON.stringify(await info())); }
  check('probe', true);
} catch (e) { check('no exception: ' + e.message, false); }
await finish();

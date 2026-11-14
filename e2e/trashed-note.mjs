// A note in the Trash cannot be opened by its link; it opens only from the Trash list.
const { boot } = await import('./lib.mjs');
const b = await boot();
const ok = (c, m, x) => b.check(m, !!c, x);
try {
  const n = await b.api('POST', '/api/notes', { title: 'Script Writting', content: '' });
  const id = (n.note || n).id;
  ok((await b.api('GET', `/api/notes/${id}`)).note, 'a live note opens by id');
  await b.api('DELETE', `/api/notes/${id}`);
  let gone = false;
  try { const r = await b.api('GET', `/api/notes/${id}`); gone = !!r.error || !r.note; } catch { gone = true; }
  ok(gone, 'a trashed note no longer opens by id');
  const t = await b.api('GET', `/api/notes/${id}?deleted=1`);
  ok(t.note && t.note.isDeleted, 'the Trash view can still open it');
  const p = b.page;
  await p.goto(b.base + `/notes/${id}`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(800);
  ok(!/\/notes\/[0-9a-f-]{36}/.test(p.url()), 'opening its link in the browser bounces to the notes list', p.url());
} catch (e) { ok(false, 'unexpected: ' + e.message); }
await b.finish();

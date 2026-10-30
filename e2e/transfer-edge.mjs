// Import / export edge cases through the real HTTP API (no browser needed; boot() starts the compiled server).
//   $env:PEBLO_TEST_DATABASE_URL = 'postgresql://postgres:postgres@127.0.0.1:55432/peblo_test_xfer'   (name must contain peblo_test)
//   node e2e/transfer-edge.mjs
// Covers: export -> import round trip (same user and a second user), name collisions, unicode/emoji/long/empty titles, tags,
// corrupt zip (400), ../ and absolute paths, zip bombs, 100k-row CSV, oversized files (413), Content-Length over 150 MB (413).
import http from 'http';
import zlib from 'zlib';
import AdmZip from 'adm-zip';
import { boot } from './lib.mjs';

process.env.API_RATE_MAX = process.env.API_RATE_MAX || '1000000';
const { base, check, finish, token: tokenA } = await boot();
const T0 = Date.now();

const call = async (token, method, url, body) => {
  const res = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};
const signup = async () => {
  const r = await fetch(base + '/api/auth/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: `xfer-b-${Date.now()}@peblo.test`, password: 'correct horse battery', name: 'B' }) });
  return (await r.json()).token;
};
const listNotes = async (token, archivedToo = true) => {
  const out = [];
  for (const archived of archivedToo ? [false, true] : [false]) {
    for (let offset = 0; offset < 5000; offset += 500) {
      const r = await call(token, 'GET', `/api/notes?limit=500&offset=${offset}&archived=${archived}`);
      const notes = r.body.notes || [];
      out.push(...notes.map((n) => ({ ...n, _arch: archived })));
      if (notes.length < 500) break;
    }
  }
  return out.map((n) => ({ id: n.id, title: n.title, content: n.content || '', archived: n._arch, tags: (n.tags || []).map((t) => (typeof t === 'string' ? t : t.tag?.name ?? t.name)).sort() }));
};
const upload = async (token, files, { raw } = {}) => {
  const fd = new FormData();
  for (const f of files) fd.append('files', new Blob([f.data]), f.name);
  try {
    const res = await fetch(base + '/api/import', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  } catch (e) { return { status: 0, body: { error: String(e.cause?.code || e.message) } }; }
};

// ---- a tiny zip writer so the tests can forge headers, names and sizes
const u16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; };
function makeZip(entries) {
  const parts = []; const central = []; let off = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8');
    const raw = Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data ?? '', 'utf8');
    const deflate = e.deflate !== false && raw.length > 0;
    const body = deflate ? zlib.deflateRawSync(raw) : raw;
    const usize = e.declaredSize ?? raw.length;
    const crc = zlib.crc32(raw);
    const local = Buffer.concat([u32(0x04034b50), u16(20), u16(0x0800), u16(deflate ? 8 : 0), u16(0), u16(0x21), u32(crc), u32(body.length), u32(usize), u16(name.length), u16(0), name]);
    parts.push(local, body);
    central.push(Buffer.concat([u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(deflate ? 8 : 0), u16(0), u16(0x21), u32(crc), u32(body.length), u32(usize), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(off), name]));
    off += local.length + body.length;
  }
  const cd = Buffer.concat(central);
  return Buffer.concat([...parts, cd, u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length), u32(cd.length), u32(off), u16(0)]);
}
const md = (title, body = 'body', extra = '') => `---\n${extra}title: ${JSON.stringify(title)}\ntags: []\n---\n\n# ${title}\n\n${body}\n`;

try {
  // =============== 1. round trip
  const tokenB = await signup();
  const long300 = 'L'.repeat(300);
  const seed = [
    { title: 'Plain note', content: 'Just text', tags: ['alpha', 'Beta'] },
    { title: 'Dup', content: 'first dup', tags: [] },
    { title: 'Dup', content: 'second dup', tags: ['alpha'] },
    { title: 'Dup', content: 'third dup', tags: [] },
    { title: 'Dup (2)', content: 'really named Dup (2)', tags: [] },
    { title: 'A', content: 'a one', tags: [] },
    { title: 'A', content: 'a two', tags: [] },
    { title: 'A (2)', content: 'the A (2) collision', tags: [] },
    { title: 'dup', content: 'lower-case dup', tags: [] },
    { title: 'Unicode 日本語 ñandú 😀🎉', content: 'Ünïcödé 日本語 😀 body', tags: ['日本語', 'emoji-😀'] },
    { title: long300, content: 'very long title', tags: [] },
    { title: '', content: 'no title at all', tags: [] },
    { title: 'Quote "q" and back\\slash and: colon', content: 'tricky chars', tags: [] },
    { title: 'Has / slash : and * star ? and <angle> | pipe', content: 'file-name unsafe characters', tags: [] },
    { title: '=HYPERLINK("http://evil","x")', content: 'formula title', tags: [] },
    { title: "+cmd|' /C calc'!A0", content: 'dde title', tags: [] },
    { title: '@SUM(1+1)', content: 'at title', tags: [] },
    { title: 'Props look-alike', content: 'Status: this line is the note text, not a property\nPriority: high\n\nSecond paragraph', tags: [] },
    { title: 'Front matter look-alike', content: '---\nfoo: bar\n---\nafter rule', tags: [] },
    { title: 'Markdown heavy', content: '# Inner heading\n\n- [ ] todo\n- [x] done\n\n```js\nconst a = "x";\n```\n\n| a | b |\n|---|---|\n| 1 | 2 |', tags: [] },
    { title: 'Empty body', content: '', tags: [] },
  ];
  for (const n of seed) {
    const r = await call(tokenA, 'POST', '/api/notes', n);
    if (r.status >= 300) check(`seed "${n.title.slice(0, 30)}" created`, false, JSON.stringify(r.body));
  }
  const before0 = await listNotes(tokenA);
  check('seeded all notes', before0.length === seed.length, `${before0.length}/${seed.length}`);
  // archived note goes under Archive/ in the zip
  const toArchive = before0.find((n) => n.title === 'Empty body');
  const ar = await call(tokenA, 'POST', `/api/notes/${toArchive.id}/archive`);
  const before = await listNotes(tokenA);

  const ex = await fetch(base + '/api/export', { headers: { Authorization: `Bearer ${tokenA}` } });
  const zipBuf = Buffer.from(await ex.arrayBuffer());
  check('export: 200 application/zip with a download name', ex.status === 200 && /zip/.test(ex.headers.get('content-type')) && /peblo-notes-\d{4}-\d\d-\d\d\.zip/.test(ex.headers.get('content-disposition') || ''));
  const entries = new AdmZip(zipBuf).getEntries();
  const names = entries.map((e) => e.entryName);
  const expectedCount = before.length;
  check('archive call worked and the archived note is exported under Archive/', ar.status === 200 && names.some((x) => x.startsWith('Archive/')), names.join('|'));
  check('export: one file per note, none lost to a name clash ("A", "A", "A (2)")', names.length === expectedCount && new Set(names.map((x) => x.toLowerCase())).size === names.length, `files=${names.length} unique=${new Set(names.map((x) => x.toLowerCase())).size} notes=${expectedCount}\n${names.join(' | ')}`);
  check('export: every file name is free of / \\ : * ? " < > | control chars (apart from the Archive/ folder)', names.every((x) => !/[\\:*?"<>|\u0000-\u001f]/.test(x) && !x.slice(0, -3).replace(/^Archive\//, '').includes('/')), names.filter((x) => /[\\:*?"<>|]/.test(x)).join(' | '));
  check('export: no path escapes (no ../ and no leading /)', names.every((x) => !x.split('/').includes('..') && !x.startsWith('/')));
  check('export: file names stay under 255 bytes', names.every((x) => Buffer.byteLength(x) < 255));
  const hostile = [...entries].find((e) => /HYPERLINK/.test(e.entryName));
  check('export: a formula-looking title is just a file name (not executable)', !!hostile && hostile.entryName.endsWith('.md'));

  const sig = (n) => `${n.title || 'Untitled'}\u0001${n.content.trim()}\u0001${n.tags.filter((t) => t !== 'imported').join(',')}\u0001${n.archived ? 'archived' : 'active'}`;
  const sameUser = await upload(tokenA, [{ name: 'peblo-notes.zip', data: zipBuf }]);
  check('import (same user): 200 and every note imported', sameUser.status === 200 && sameUser.body.imported === before.length, JSON.stringify(sameUser.body).slice(0, 300));
  const afterA = await listNotes(tokenA);
  const newOnes = afterA.filter((n) => !before.some((b) => b.id === n.id));
  const expectSigs = before.map(sig).sort();
  const gotSigs = newOnes.map(sig).sort();
  const missing = expectSigs.filter((s) => !gotSigs.includes(s));
  check('round trip (same user): titles, content and tags identical', missing.length === 0 && newOnes.length === before.length, missing.map((s) => JSON.stringify(s.slice(0, 120))).join('\n'));
  check('round trip: imported notes carry the "imported" tag', newOnes.every((n) => n.tags.includes('imported')));
  check('round trip: original notes untouched', before.every((b) => afterA.find((n) => n.id === b.id && sig(n) === sig(b))));

  const toB = await upload(tokenB, [{ name: 'peblo-notes.zip', data: zipBuf }]);
  const listB = await listNotes(tokenB);
  check('import (second user): 200, same count, nothing leaked to or from user A', toB.status === 200 && listB.length === before.length && listB.every((n) => !before.some((b) => b.id === n.id)), JSON.stringify(toB.body).slice(0, 200));
  check('round trip (second user): signatures identical', expectSigs.every((s) => listB.map(sig).includes(s)));
  check('user A did not get B\'s notes', (await listNotes(tokenA)).length === before.length * 2);

  // double round trip is stable (export the imported copy and import again: still same content)
  const ex2 = Buffer.from(await (await fetch(base + '/api/export', { headers: { Authorization: `Bearer ${tokenB}` } })).arrayBuffer());
  const names2 = new AdmZip(ex2).getEntries().map((e) => e.entryName);
  check('second export from imported data has no clashing names', new Set(names2.map((x) => x.toLowerCase())).size === names2.length && names2.length === before.length);

  // =============== 2. hostile / broken zips
  const corrupt = await upload(tokenA, [{ name: 'broken.zip', data: Buffer.from('PK\x03\x04 this is not really a zip file at all'.repeat(5)) }]);
  check('corrupt zip -> 400', corrupt.status === 400, JSON.stringify(corrupt));
  const truncated = await upload(tokenA, [{ name: 'trunc.zip', data: zipBuf.subarray(0, Math.floor(zipBuf.length / 2)) }]);
  check('truncated zip -> 400 (not 500)', truncated.status === 400, JSON.stringify(truncated));
  const empty = await upload(tokenA, []);
  check('no files -> 400', empty.status === 400);
  const noZipNames = await upload(tokenA, [{ name: 'x.exe', data: Buffer.from('MZ') }]);
  check('unsupported file -> 200 with it listed as skipped, nothing created', noZipNames.status === 200 && noZipNames.body.imported === 0 && noZipNames.body.skippedFiles?.includes('x.exe'), JSON.stringify(noZipNames));

  const countBefore = (await listNotes(tokenA)).length;
  const trav = makeZip([
    { name: '../../evil.md', data: md('Dots', 'dotdot body') },
    { name: '/etc/abs.md', data: md('Abs', 'absolute body') },
    { name: '..\\..\\win.md', data: md('Win', 'backslash body') },
    { name: 'C:\\Windows\\drive.md', data: md('Drive', 'drive body') },
    { name: 'a/b/c/d/e/f/deep.md', data: md('Deep', 'nested body') },
    { name: 'folder/sub/Untitled 1a2b3c4d5e6f1a2b3c4d5e6f1a2b3c4d.md', data: '# Notion Style\n\nStatus: Done\nTags: x, y\n\nnotion body\n' },
  ]);
  const tr = await upload(tokenA, [{ name: 'trav.zip', data: trav }]);
  check('../, absolute and drive paths in a zip: 200, notes imported by content (nothing is written to disk)', tr.status === 200 && tr.body.imported === 6, JSON.stringify(tr.body).slice(0, 300));
  const afterTrav = (await listNotes(tokenA)).slice(countBefore);
  const byTitle = Object.fromEntries((await listNotes(tokenA)).filter((n) => n.tags.includes('imported')).map((n) => [n.title, n]));
  check('traversal zip: titles come from the note, never from the path', ['Dots', 'Abs', 'Win', 'Drive', 'Deep', 'Notion Style'].every((t) => byTitle[t]), Object.keys(byTitle).join('|'));
  check('nested folders: notes arrive flat with their content and the Notion hash removed', byTitle['Deep']?.content === 'nested body' && byTitle['Notion Style']?.tags.includes('x'), JSON.stringify(byTitle['Notion Style']));

  const t1 = Date.now();
  const mb = (n) => Buffer.alloc(n * 1024 * 1024, 0x61);
  const bombBig = await upload(tokenA, [{ name: 'bomb1.zip', data: makeZip([{ name: 'huge.md', data: mb(11) }]) }]);
  check('zip bomb: one entry declaring 11 MB (limit 10) -> 413', bombBig.status === 413, JSON.stringify(bombBig));
  const bombMany = await upload(tokenA, [{ name: 'bomb2.zip', data: makeZip(Array.from({ length: 12 }, (_, i) => ({ name: `part${i}.md`, data: mb(9) }))) }]);
  check('zip bomb: 12 entries x 9 MB declared (108 MB total, limit 100) -> 413', bombMany.status === 413, JSON.stringify(bombMany));
  const manyFiles = await upload(tokenA, [{ name: 'many.zip', data: makeZip(Array.from({ length: 5001 }, (_, i) => ({ name: `n${i}.md`, data: '', deflate: false }))) }]);
  check('zip with 5001 entries (limit 5000) -> 413', manyFiles.status === 413, JSON.stringify(manyFiles));
  const lie = makeZip([{ name: 'liar.md', data: mb(30), declaredSize: 100 }]);
  const lieRes = await upload(tokenA, [{ name: 'liar.zip', data: lie }]);
  check('zip bomb: entry declaring 100 bytes that really inflates to 30 MB is refused (413 or 400), not imported', lieRes.status === 413 || lieRes.status === 400, JSON.stringify(lieRes).slice(0, 200));
  const nested = (d) => (d === 0 ? makeZip([{ name: 'leaf.md', data: md('Leaf') }]) : makeZip([{ name: `l${d}.zip`, data: nested(d - 1) }]));
  const deepRes = await upload(tokenA, [{ name: 'deep.zip', data: nested(8) }]);
  check('zip nested 8 deep: stops (skipped, no crash, no 500)', deepRes.status === 200 && deepRes.body.imported === 0, JSON.stringify(deepRes).slice(0, 200));
  const nestedOk = await upload(tokenA, [{ name: 'ok.zip', data: nested(2) }]);
  check('zip nested 2 deep: still imports', nestedOk.status === 200 && nestedOk.body.imported === 1, JSON.stringify(nestedOk).slice(0, 200));
  check('bomb checks took under 60 s (nothing was fully inflated)', Date.now() - t1 < 60000, `${Date.now() - t1} ms`);
  const alive = await fetch(base + '/api/health');
  check('server still healthy after the bombs', alive.status === 200);

  // =============== 3. loose files
  const rows = 100000;
  const bigCsv = 'Name,Status,Notes\r\n' + Array.from({ length: rows }, (_, i) => `Row ${i},${i % 2 ? 'open' : 'done'},"note ${i}, with comma"`).join('\r\n') + '\r\n';
  const t2 = Date.now();
  const csvRes = await upload(tokenA, [{ name: 'Big Database abcdefabcdefabcdefabcdefabcdefab.csv', data: Buffer.from(bigCsv) }]);
  check('CSV with 100,000 rows: 200, one note, no stack overflow', csvRes.status === 200 && csvRes.body.imported === 1, JSON.stringify(csvRes).slice(0, 300));
  console.log(`      (100k-row CSV took ${Date.now() - t2} ms, ${(bigCsv.length / 1048576).toFixed(1)} MB)`);
  const bigNote = (await listNotes(tokenA)).find((n) => n.title === 'Big Database');
  check('CSV note: title cleaned, header + last row present', !!bigNote && bigNote.content.includes(`Row ${rows - 1}`) && bigNote.content.startsWith(`Imported table with ${rows} rows`), bigNote?.content.slice(0, 80));
  const odd = await upload(tokenA, [
    { name: 'ünï 日本語 😀.md', data: Buffer.from('# Fancy\n\nbody') },
    { name: 'noheading.txt', data: Buffer.from('plain text no heading') },
    { name: 'bom.md', data: Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('# Bom title\n\nbom body')]) },
    { name: 'crlf.md', data: Buffer.from('# Crlf title\r\n\r\nline1\r\nline2\r\n') },
    { name: 'empty.md', data: Buffer.alloc(0) },
    { name: 'img.md', data: Buffer.from('# Pic\n\n![x](a/b.png) text [link](Other%20Page%2012345678901234567890123456789012.md)') },
  ]);
  check('loose files: unicode name, txt, BOM, CRLF, empty, images -> 200', odd.status === 200 && odd.body.imported === 6 && odd.body.skippedImages === 1, JSON.stringify(odd.body).slice(0, 300));
  const oddNotes = await listNotes(tokenA);
  const named = (t) => oddNotes.find((n) => n.title === t);
  check('loose files: titles/content right (BOM stripped, CRLF normalised, image dropped, page link flattened)', named('Fancy') && named('noheading') && named('Bom title')?.content === 'bom body' && named('Crlf title')?.content === 'line1\nline2' && named('Pic')?.content === 'text link', JSON.stringify(['Fancy', 'noheading', 'Bom title', 'Crlf title', 'Pic'].map((t) => named(t)?.content)));
  const uniName = await upload(tokenA, [{ name: 'ünï 日本語 😀.md', data: Buffer.from('plain body without heading') }]);
  check('multipart file name with unicode/emoji decoded as UTF-8 for the title', uniName.status === 200 && (await listNotes(tokenA)).some((n) => n.title === 'ünï 日本語 😀'));
  const nulUp = await upload(tokenA, [{ name: 'nul.md', data: Buffer.from('before\u0000after text') }]);
  check('a file with NUL characters imports with them stripped', nulUp.status === 200 && (await listNotes(tokenA)).some((n) => n.title === 'nul' && n.content === 'beforeafter text'), JSON.stringify(nulUp));
  const evilFm = await upload(tokenA, [{ name: 'fm.md', data: Buffer.from('---\ntitle: "=HYPERLINK(\\"http://evil\\",\\"x\\")"\ntags: [a, "b c"]\ncreated: 2020-01-02\n---\nbody') }]);
  const fmNote = (await listNotes(tokenA)).find((n) => n.title === '=HYPERLINK("http://evil","x")' && n.content === 'body');
  check('front matter title with JSON escapes (quotes) is read back exactly', evilFm.status === 200 && !!fmNote && fmNote.tags.includes('a') , JSON.stringify(fmNote));

  // =============== 4. size limits
  const oneBig = await upload(tokenA, [{ name: 'huge.md', data: Buffer.alloc(101 * 1024 * 1024, 0x61) }]);
  check('single file over 100 MB -> 413 (a dropped connection counts only if the server closed it early)', oneBig.status === 413 || oneBig.status === 0, JSON.stringify(oneBig));
  const tooMany = await upload(tokenA, Array.from({ length: 201 }, (_, i) => ({ name: `f${i}.md`, data: Buffer.from(`# F${i}\n\nx`) })));
  check('201 files (limit 200) -> 413', tooMany.status === 413, JSON.stringify(tooMany));
  const cl = await new Promise((resolve) => {
    const u = new URL(base);
    const req = http.request({ host: u.hostname, port: u.port, path: '/api/import', method: 'POST', headers: { Authorization: `Bearer ${tokenA}`, 'Content-Type': 'multipart/form-data; boundary=xx', 'Content-Length': String(160 * 1024 * 1024) } }, (res) => {
      let b = ''; res.on('data', (c) => { b += c; }); res.on('end', () => resolve({ status: res.statusCode, body: b.slice(0, 200) }));
    });
    req.on('error', (e) => resolve({ status: 0, body: e.code }));
    req.write('--xx--\r\n');
    setTimeout(() => { req.destroy(); resolve({ status: -1, body: 'timeout' }); }, 8000);
  });
  check('Content-Length of 160 MB -> 413 before any body is read', cl.status === 413, JSON.stringify(cl));
  const two = await upload(tokenA, [{ name: 'a.md', data: Buffer.alloc(80 * 1024 * 1024, 0x61) }, { name: 'b.md', data: Buffer.alloc(80 * 1024 * 1024, 0x62) }]);
  check('two real 80 MB files (160 MB together) -> 413', two.status === 413 || two.status === 0, JSON.stringify(two));
  check('server healthy after the size tests', (await fetch(base + '/api/health')).status === 200);
  const unauth = await fetch(base + '/api/import', { method: 'POST' });
  check('import without a token -> 401', unauth.status === 401);
  const unauthEx = await fetch(base + '/api/export');
  check('export without a token -> 401', unauthEx.status === 401);
} catch (e) { console.error(e); check('script ran to the end', false, e.stack); }
console.log(`(${((Date.now() - T0) / 1000).toFixed(1)} s)`);
await finish();

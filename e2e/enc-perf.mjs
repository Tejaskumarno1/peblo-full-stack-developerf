// Timing of the hot note paths before/after encryption at rest. Same data shape as perf-scale.mjs (3000 notes, every 20th about 50 KB).
//   $env:PEBLO_TEST_DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:55432/peblo_test_perf_enc'
//   PERF_SEED=1 node e2e/enc-perf.mjs        (first run only: seeds plain text through SQL)
//   $env:PEBLO_SERVER_DIST='dist'    -> baseline: the build before encryption
//   $env:PEBLO_SERVER_DIST='dist-enc' -> new code (set PEBLO_DATA_KEY to measure with encryption on, after scripts/encrypt-existing.mjs)
import crypto from 'crypto';
import path from 'path';
import { pathToFileURL } from 'url';
if (!/peblo_test_perf_enc/.test(process.env.PEBLO_TEST_DATABASE_URL || '')) { console.error('set PEBLO_TEST_DATABASE_URL to peblo_test_perf_enc'); process.exit(2); }
process.env.API_RATE_MAX = '1000000';
const { boot, REPO } = await import('./lib.mjs');
const { base, finish: libFinish } = await boot();
const { default: prisma } = await import(pathToFileURL(path.join(REPO, process.env.PEBLO_SERVER_DIST || 'dist', 'server', 'db.js')).href);
const N = Number(process.env.PERF_NOTES || 3000);
const words = 'project meeting budget roadmap launch design review sprint backlog customer invoice travel recipe workout garden reading idea draft summary plan notes research interview contract release bug feature migration database server client editor sharing calendar reminder'.split(' ');
let st = 1; const rnd = () => { st = (st * 1664525 + 1013904223) % 4294967296; return st / 4294967296; };
const pick = (a) => a[Math.floor(rnd() * a.length)];
const sentence = () => Array.from({ length: 8 + Math.floor(rnd() * 10) }, () => pick(words)).join(' ') + '.';
const para = (chars) => { let s = ''; while (s.length < chars) s += sentence() + ' '; return s.trim(); };
const body = (i) => i % 20 === 0 ? '# Big note ' + i + '\n\n' + Array.from({ length: 120 }, (_, k) => (k % 15 === 0 ? `## Section ${k / 15}\n\n` : '') + para(400)).join('\n\n') : `# Note ${i}\n\n` + Array.from({ length: 1 + Math.floor(rnd() * 4) }, () => para(300)).join('\n\n') + (i % 100 === 7 ? '\n\nzebracorn special word' : '');
const EMAIL = 'perf-enc@peblo.test', PASS = 'correct horse battery';
let res = await fetch(base + '/api/auth/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: EMAIL, password: PASS, name: 'Perf' }) });
if (res.status >= 400) res = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: EMAIL, password: PASS }) });
const token = (await res.json()).token;
const uid = (await prisma.$queryRawUnsafe('SELECT id FROM users WHERE email = $1', EMAIL))[0].id;
if (process.env.PERF_SEED === '1') {
  console.log(`seeding ${N} plain-text notes ...`);
  const ids = [], titles = [], contents = [];
  for (let i = 0; i < N; i++) { ids.push(crypto.randomUUID()); titles.push(`Perf note ${i} ${pick(words)}`); contents.push(body(i)); }
  for (let o = 0; o < N; o += 250) await prisma.$executeRawUnsafe(`INSERT INTO notes (id, user_id, title, content, updated_at, created_at) SELECT a, $1, b, c, now() - (g || ' minutes')::interval, now() - (g || ' minutes')::interval FROM unnest($2::text[], $3::text[], $4::text[], $5::int[]) AS t(a, b, c, g)`, uid, ids.slice(o, o + 250), titles.slice(o, o + 250), contents.slice(o, o + 250), ids.slice(o, o + 250).map((_x, k) => o + k));
  const tagIds = Array.from({ length: 200 }, () => crypto.randomUUID());
  await prisma.$executeRawUnsafe(`INSERT INTO tags (id, user_id, name) SELECT a, $1, b FROM unnest($2::text[], $3::text[]) AS t(a, b)`, uid, tagIds, tagIds.map((_x, i) => `tag${String(i).padStart(3, '0')}`));
  const nt = new Set(); for (const id of ids) { for (let k = 0; k < 1 + Math.floor(rnd() * 3); k++) nt.add(id + '|' + tagIds[Math.floor(Math.pow(rnd(), 2) * 200)]); }
  const pairs = [...nt].map((s) => s.split('|'));
  for (let o = 0; o < pairs.length; o += 2000) await prisma.$executeRawUnsafe(`INSERT INTO note_tags (note_id, tag_id) SELECT a, b FROM unnest($1::text[], $2::text[]) AS t(a, b) ON CONFLICT DO NOTHING`, pairs.slice(o, o + 2000).map((p) => p[0]), pairs.slice(o, o + 2000).map((p) => p[1]));
  // 50 versions on a small note (index 1) and on a big one (index 20)
  for (const idx of [1, 20]) for (let v = 0; v < 50; v++) await prisma.$executeRawUnsafe(`INSERT INTO note_backups (id, note_id, content, created_at) VALUES ($1, $2, $3, now() - ($4 || ' hours')::interval)`, crypto.randomUUID(), ids[idx], contents[idx] + ' v' + v, String(v + 1));
  await prisma.$executeRawUnsafe('ANALYZE');
  console.log('seeded');
}
const my = (await prisma.$queryRawUnsafe('SELECT id, title FROM notes WHERE user_id = $1 ORDER BY created_at ASC', uid));
const smallId = (await prisma.$queryRawUnsafe(`SELECT note_id FROM note_backups GROUP BY note_id HAVING count(*) = 50 ORDER BY max(length(content)) ASC LIMIT 1`))[0].note_id;
const bigId = (await prisma.$queryRawUnsafe(`SELECT note_id FROM note_backups GROUP BY note_id HAVING count(*) = 50 ORDER BY max(length(content)) DESC LIMIT 1`))[0].note_id;
const pct = (arr, p) => { const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]; };
const rows = [];
const bench = async (name, method, url, { n = 12, body: b } = {}) => {
  const times = []; let status = 0, bytes = 0;
  for (let i = 0; i < n + 1; i++) {
    const t = performance.now();
    const r = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: b ? JSON.stringify(typeof b === 'function' ? b(i) : b) : undefined });
    const text = await r.text(); const ms = performance.now() - t;
    status = r.status; if (i === 0) { bytes = text.length; continue; } times.push(ms);
  }
  rows.push({ name, p50: pct(times, 50), p95: pct(times, 95), kb: bytes / 1024, status });
  console.log(`${name.padEnd(52)} p50 ${pct(times, 50).toFixed(0).padStart(5)} ms  p95 ${pct(times, 95).toFixed(0).padStart(5)} ms  ${(bytes / 1024).toFixed(0).padStart(7)} KB  [${status}]`);
};
const dist = process.env.PEBLO_SERVER_DIST || 'dist';
console.log(`\n=== ${dist}, PEBLO_DATA_KEY ${process.env.PEBLO_DATA_KEY ? 'set' : 'unset'}, ${my.length} notes ===`);
const mid = my[1500];
const bigNote = (await prisma.$queryRawUnsafe('SELECT id FROM notes WHERE user_id = $1 ORDER BY length(content) DESC LIMIT 1', uid))[0].id; // may be ciphertext: the longest stays the longest
const bigPatch = (await prisma.$queryRawUnsafe('SELECT id FROM notes WHERE user_id = $1 ORDER BY length(content) DESC OFFSET 3 LIMIT 1', uid))[0].id;
await bench('GET /api/notes (full list, 3000 notes)', 'GET', '/api/notes');
await bench('GET /api/notes?snippet=1', 'GET', '/api/notes?snippet=1');
await bench('GET /api/notes?limit=50&snippet=1', 'GET', '/api/notes?limit=50&snippet=1');
await bench('GET search=zebracorn (rare word)&snippet=1', 'GET', '/api/notes?search=zebracorn&snippet=1');
await bench('GET search=project (common word)&snippet=1', 'GET', '/api/notes?search=project&snippet=1');
await bench('GET search=project&limit=50&snippet=1', 'GET', '/api/notes?search=project&limit=50&snippet=1');
await bench('GET search=meetng (fuzzy)&snippet=1', 'GET', '/api/notes?search=meetng&snippet=1');
await bench('GET search=tag000 (tag)&snippet=1', 'GET', '/api/notes?search=tag000&snippet=1');
await bench('GET tag=tag000&snippet=1', 'GET', '/api/notes?tag=tag000&snippet=1');
await bench('GET /api/notes/:id (50 KB)', 'GET', `/api/notes/${bigNote}`);
await bench('GET /api/notes/:id/mentions (scan all notes)', 'GET', `/api/notes/${my[3].id}/mentions`);
await bench('GET /api/notes/:id/backups (50 versions, ~2 KB)', 'GET', `/api/notes/${smallId}/backups`);
await bench('GET /api/notes/:id/backups (50 versions, ~50 KB)', 'GET', `/api/notes/${bigId}/backups`);
await bench('POST /api/ai/hub/search (retrieval, 1500 notes)', 'POST', '/api/ai/hub/search', { body: { query: 'project budget roadmap what is planned this week' } });
await bench('PATCH /api/notes/:id (2 KB)', 'PATCH', `/api/notes/${mid.id}`, { body: (i) => ({ content: para(2000) + i }) });
await bench('PATCH /api/notes/:id (50 KB)', 'PATCH', `/api/notes/${bigPatch}`, { body: (i) => ({ content: body(40) + ' edit ' + i }) });
await bench('POST /api/notes (create 2 KB)', 'POST', '/api/notes', { body: (i) => ({ title: 'x' + i, content: para(2000) }) });
// raw cost of the cipher itself: decrypt every stored note body in this process
if (process.env.PEBLO_DATA_KEY) {
  const { decryptText, aadOf } = await import(pathToFileURL(path.join(REPO, dist, 'server', 'dataCrypto.js')).href);
  const stored = await prisma.$queryRawUnsafe('SELECT id, content FROM notes WHERE user_id = $1', uid);
  const t = performance.now(); let chars = 0; for (const r of stored) chars += decryptText(r.content, aadOf('notes', 'content', r.id)).length;
  console.log(`decrypting ${stored.length} stored notes (${(chars / 1048576).toFixed(1)} MB of text): ${(performance.now() - t).toFixed(0)} ms`);
}
await libFinish();

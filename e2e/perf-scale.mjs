// Performance and scale run: seeds a big account through the real API, measures endpoint latency, EXPLAINs the hot queries,
// opens big notes in Chrome (open time, typing latency, memory), stresses the collab WebSocket and checks the per-IP limiters.
// Run:  $env:PEBLO_TEST_DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:55432/peblo_test_perf'; node e2e/perf-scale.mjs
// Env:  PERF_NOTES (3000) PERF_TODOS (5000) PERF_SKIP_BROWSER=1  PERF_SKIP_WS=1  PERF_BIG_KB (2048)  PERF_TYPE_SECONDS (60)
import path from 'path';
import { execFileSync } from 'child_process';
import { monitorEventLoopDelay } from 'perf_hooks';
import { pathToFileURL } from 'url';
import WebSocket from 'ws';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';

if (!/peblo_test_perf/.test(process.env.PEBLO_TEST_DATABASE_URL || '')) { console.error('set PEBLO_TEST_DATABASE_URL to the peblo_test_perf database'); process.exit(2); }
process.env.API_RATE_MAX = '1000000'; // the global API limiter (1200/min) would stop the seeding; it is not what is under test
const N_NOTES = Number(process.env.PERF_NOTES || 3000);
const N_TODOS = Number(process.env.PERF_TODOS || 5000);
const BIG_KB = Number(process.env.PERF_BIG_KB || 2048);
const TYPE_SECONDS = Number(process.env.PERF_TYPE_SECONDS || 60);
const PSQL = 'C:\\Program Files\\PostgreSQL\\17\\bin\\psql.exe';
const { boot, REPO } = await import('./lib.mjs');
const { base, ctx, token, finish: libFinish } = await boot();
const port = new URL(base).port;
const loop = monitorEventLoopDelay({ resolution: 10 }); loop.enable();
const rows = [];
const fails = [];
const now = () => performance.now();
const pct = (arr, p) => { const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]; };
const fmt = (n) => (n === undefined || n === null || Number.isNaN(n) ? '-' : n >= 100 ? n.toFixed(0) : n.toFixed(1));
const psql = (sql) => execFileSync(PSQL, ['-w', '-h', '127.0.0.1', '-p', '55432', '-U', 'postgres', '-d', 'peblo_test_perf', '-tA', '-c', sql], { env: { ...process.env, PGPASSWORD: 'postgres' }, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pool = async (n, conc, fn) => { let i = 0; const run = async () => { while (i < n) { const k = i++; await fn(k); } }; await Promise.all(Array.from({ length: conc }, run)); };
const call = async (method, url, body) => {
  const t = now();
  const res = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  return { ms: now() - t, status: res.status, bytes: text.length, json: (() => { try { return JSON.parse(text); } catch { return {}; } })() };
};

// ---------------- 1. seed ----------------
const words = 'project meeting budget roadmap launch design review sprint backlog customer invoice travel recipe workout garden reading idea draft summary plan notes research interview contract release bug feature migration database server client editor sharing calendar reminder'.split(' ');
let seedState = 1;
const rnd = () => { seedState = (seedState * 1664525 + 1013904223) % 4294967296; return seedState / 4294967296; };
const pick = (a) => a[Math.floor(rnd() * a.length)];
const sentence = () => Array.from({ length: 8 + Math.floor(rnd() * 10) }, () => pick(words)).join(' ') + '.';
const para = (chars) => { let s = ''; while (s.length < chars) s += sentence() + ' '; return s.trim(); };
const tagPool = Array.from({ length: 200 }, (_, i) => `tag${String(i).padStart(3, '0')}`);
const pickTags = () => { const n = 1 + Math.floor(rnd() * 3); return [...new Set(Array.from({ length: n }, () => tagPool[Math.floor(Math.pow(rnd(), 2) * tagPool.length)]))]; };
const noteBody = (i) => {
  if (i % 20 === 0) return '# Big note ' + i + '\n\n' + Array.from({ length: 120 }, (_, k) => (k % 15 === 0 ? `## Section ${k / 15}\n\n` : '') + para(400)).join('\n\n'); // about 50KB
  const n = 1 + Math.floor(rnd() * 4);
  return `# Note ${i}\n\n` + Array.from({ length: n }, () => para(300)).join('\n\n') + (i % 100 === 7 ? '\n\nzebracorn special word' : '');
};
console.log(`seeding ${N_NOTES} notes, ${N_TODOS} todos, 200 tags ...`);
let t0 = now();
const noteIds = [];
await pool(N_NOTES, 8, async (i) => {
  const r = await call('POST', '/api/notes', { title: `Perf note ${i} ${pick(words)}`, content: noteBody(i), tags: pickTags() });
  if (r.status !== 201) { fails.push('seed note ' + r.status); return; }
  noteIds[i] = r.json.note.id;
});
const tNotes = now() - t0; t0 = now();
const day = 86400000;
const todoIds = [];
await pool(N_TODOS, 8, async (i) => {
  const dl = new Date(Date.now() + Math.floor((rnd() * 90 - 45) * day));
  const r = await call('POST', '/api/todos', { text: `Perf task ${i} ${pick(words)} ${pick(words)}`, priority: pick(['low', 'medium', 'high']), deadline: dl.toISOString(), tags: pickTags(), noteId: i % 10 === 0 ? noteIds[i % noteIds.length] : null });
  if (r.status !== 201) { fails.push('seed todo ' + r.status + JSON.stringify(r.json).slice(0, 100)); return; }
  todoIds[i] = r.json.todo?.id;
});
await pool(800, 8, async (i) => { if (todoIds[i]) await call('PATCH', `/api/todos/${todoIds[i]}`, { completed: true }); });
const series = [];
for (const [rec, txt] of [['daily', 'Standup'], ['weekdays', 'Email triage'], ['weekly', 'Weekly review'], ['monthly', 'Pay rent'], ['daily', 'Water plants']]) {
  const r = await call('POST', '/api/todos', { text: txt, recurrence: rec, deadline: new Date().toISOString(), priority: 'medium' });
  series.push(r.status);
}
const tTodos = now() - t0;
const counts = psql('select (select count(*) from notes),(select count(*) from todos),(select count(*) from tags),(select count(*) from todo_series),(select coalesce(sum(length(content)),0)/1024/1024 from notes)').trim();
console.log(`seeded in ${(tNotes / 1000).toFixed(1)}s notes + ${(tTodos / 1000).toFixed(1)}s todos; db counts notes|todos|tags|series|contentMB = ${counts}; series create statuses ${series}; seed failures ${fails.length} ${fails.slice(0, 3)}`);
const userId = psql(`select user_id from notes group by 1 order by count(*) desc limit 1`).trim();
psql('ANALYZE');
// PERF_CLIENT_URL: measure the browser part against a Vite dev server (it serves the current client source without a build).
// The dev server proxies /api to this test server, so its port is written to a file for the Vite config to read.
const CLIENT = (process.env.PERF_CLIENT_URL || '').replace(/\/$/, '');
if (CLIENT) { (await import('fs')).writeFileSync(path.join(process.env.TEMP || '.', 'perf-port.txt'), String(port)); console.log('test server port written for the Vite proxy:', port); }

// ---------------- 2. endpoint latency ----------------
const bench = async (area, name, method, url, { n = 12, budget = 1500, body } = {}) => {
  const times = []; let status = 0, bytes = 0;
  for (let i = 0; i < n + 1; i++) { const r = await call(method, url, typeof body === 'function' ? body(i) : body); if (i === 0) { status = r.status; bytes = r.bytes; continue; } times.push(r.ms); status = r.status; }
  const row = { area, name, p50: pct(times, 50), p95: pct(times, 95), max: Math.max(...times), kb: bytes / 1024, budget, status, slow: pct(times, 95) > budget || status >= 400 };
  rows.push(row);
  console.log(`${row.slow ? 'SLOW' : 'ok  '} ${name.padEnd(50)} p50 ${fmt(row.p50).padStart(7)}ms  p95 ${fmt(row.p95).padStart(7)}ms  ${fmt(row.kb).padStart(8)}KB  [${status}]`);
  return row;
};
const tomorrow = new Date(Date.now() + day).toISOString().slice(0, 10);
const from = new Date(Date.now() - 15 * day).toISOString(), to = new Date(Date.now() + 15 * day).toISOString();
const bigNoteId = noteIds[20];
await bench('notes', 'GET /api/notes (full, no paging)', 'GET', '/api/notes');
await bench('notes', 'GET /api/notes?snippet=1', 'GET', '/api/notes?snippet=1');
await bench('notes', 'GET /api/notes?limit=50&snippet=1', 'GET', '/api/notes?limit=50&snippet=1');
await bench('notes', 'GET /api/notes?search=zebracorn&snippet=1', 'GET', '/api/notes?search=zebracorn&snippet=1');
await bench('notes', 'GET /api/notes?search=project (common)&snippet=1', 'GET', '/api/notes?search=project&snippet=1');
await bench('notes', 'GET /api/notes?search=meetng (fuzzy)&snippet=1', 'GET', '/api/notes?search=meetng&snippet=1');
await bench('notes', 'GET /api/notes?tag=tag000&snippet=1', 'GET', '/api/notes?tag=tag000&snippet=1');
await bench('notes', 'GET /api/notes/:id (50KB)', 'GET', `/api/notes/${bigNoteId}`, { budget: 400 });
await bench('notes', 'PATCH /api/notes/:id (50KB)', 'PATCH', `/api/notes/${bigNoteId}`, { budget: 600, body: (i) => ({ content: noteBody(20) + ' edit ' + i, tags: ['tag001'] }) });
await bench('notes', 'POST /api/notes (create)', 'POST', '/api/notes', { budget: 600, body: (i) => ({ title: 'x' + i, content: para(500), tags: ['tag002'] }) });
await bench('todos', 'GET /api/todos', 'GET', '/api/todos');
await bench('todos', 'GET /api/todos/today', 'GET', '/api/todos/today');
await bench('todos', 'GET /api/todos/range (30 days)', 'GET', `/api/todos/range?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
await bench('todos', 'GET /api/todos?date=tomorrow', 'GET', `/api/todos?date=${tomorrow}`);
await bench('todos', 'POST /api/todos (create)', 'POST', '/api/todos', { budget: 600, body: (i) => ({ text: 'quick ' + i, deadline: new Date().toISOString() }) });
await bench('tags', 'GET /api/tags', 'GET', '/api/tags');
await bench('dashboard', 'GET /api/dashboard/insights', 'GET', '/api/dashboard/insights');
await bench('dashboard', 'GET /api/dashboard/daily-briefing', 'GET', '/api/dashboard/daily-briefing', { n: 5 });
await bench('dashboard', 'GET /api/dashboard/weekly-report', 'GET', '/api/dashboard/weekly-report', { n: 5 });
await bench('ai', 'POST /api/ai/hub/search (retrieval, 1500 notes)', 'POST', '/api/ai/hub/search', { budget: 2000, body: { query: 'project budget roadmap what is planned this week' } });
await bench('ai', 'POST /api/ai/hub/search (rare word)', 'POST', '/api/ai/hub/search', { budget: 2000, body: { query: 'zebracorn' } });
const sh = await call('POST', `/api/share/note/${bigNoteId}`, { edit: true });
const shareTok = sh.json.token;
await bench('share', 'GET /api/public/note/:token (50KB)', 'GET', `/api/public/note/${shareTok}`, { budget: 500 });
await bench('share', 'GET /api/share (my shares)', 'GET', '/api/share', { budget: 800 });
await bench('collab', 'GET /api/collab/presence', 'GET', '/api/collab/presence', { budget: 300 });
{
  const t = now(); const rs = await Promise.all(Array.from({ length: 20 }, () => call('GET', '/api/notes?snippet=1&limit=50')));
  const mx = Math.max(...rs.map((r) => r.ms));
  rows.push({ area: 'notes', name: '20 parallel GET /api/notes?limit=50&snippet=1 (wall)', p50: now() - t, p95: mx, max: mx, kb: 0, budget: 3000, status: 200, slow: mx > 3000 });
  console.log(`conc 20 parallel limit=50: wall ${fmt(now() - t)}ms slowest ${fmt(mx)}ms`);
}
{
  const t = now(); const rs = await Promise.all(Array.from({ length: 10 }, () => call('GET', '/api/notes')));
  const mx = Math.max(...rs.map((r) => r.ms));
  rows.push({ area: 'notes', name: '10 parallel GET /api/notes (full) (wall)', p50: now() - t, p95: mx, max: mx, kb: rs[0].bytes / 1024, budget: 5000, status: 200, slow: mx > 5000 });
  console.log(`conc 10 parallel full list: wall ${fmt(now() - t)}ms slowest ${fmt(mx)}ms`);
}
console.log(`event loop delay during API phase: mean ${(loop.mean / 1e6).toFixed(1)}ms p99 ${(loop.percentile(99) / 1e6).toFixed(0)}ms max ${(loop.max / 1e6).toFixed(0)}ms; server rss ${(process.memoryUsage().rss / 1048576).toFixed(0)}MB`);

// ---------------- 3. EXPLAIN ANALYZE of the hot queries ----------------
console.log('\nEXPLAIN ANALYZE (user ' + userId + ')');
const U = `'${userId}'`;
const explains = {
  'notes list (ORDER BY updated_at)': `SELECT id,title,content,category,meta,created_at,updated_at FROM notes WHERE user_id=${U} AND is_archived=false AND is_deleted=false ORDER BY updated_at DESC`,
  'notes search ILIKE title/content': `SELECT id,title FROM notes WHERE user_id=${U} AND is_archived=false AND is_deleted=false AND (title ILIKE '%zebracorn%' OR content ILIKE '%zebracorn%' OR EXISTS (SELECT 1 FROM note_tags nt JOIN tags t ON t.id=nt.tag_id WHERE nt.note_id=notes.id AND t.name ILIKE '%zebracorn%'))`,
  'notes by tag': `SELECT n.id FROM notes n WHERE n.user_id=${U} AND n.is_archived=false AND n.is_deleted=false AND EXISTS (SELECT 1 FROM note_tags nt JOIN tags t ON t.id=nt.tag_id WHERE nt.note_id=n.id AND t.name='tag000')`,
  'todos list': `SELECT * FROM todos WHERE user_id=${U} ORDER BY is_completed ASC, deadline ASC, created_at DESC LIMIT 1000`,
  'todos today (<= +3d, open)': `SELECT * FROM todos WHERE user_id=${U} AND is_completed=false AND deadline IS NOT NULL AND deadline <= now()+interval '3 days' ORDER BY deadline ASC LIMIT 1000`,
  'todos range': `SELECT * FROM todos WHERE user_id=${U} AND deadline >= now()-interval '15 days' AND deadline <= now()+interval '15 days' ORDER BY deadline ASC, priority ASC LIMIT 2000`,
  'tags + counts': `SELECT t.name, count(nt.note_id) FROM tags t LEFT JOIN note_tags nt ON nt.tag_id=t.id WHERE t.user_id=${U} GROUP BY t.name`,
  'retrieval notes (LIMIT 1500)': `SELECT id,title,content,updated_at FROM notes WHERE user_id=${U} AND is_deleted=false ORDER BY updated_at DESC LIMIT 1500`,
  'share by token': `SELECT id FROM notes WHERE share_token='${shareTok}' AND is_deleted=false`,
  'backlinks (note_links)': `SELECT * FROM note_links WHERE target_id='${bigNoteId}'`,
  'todo series lookup': `SELECT * FROM todo_series WHERE user_id=${U}`,
};
const explainOut = {};
for (const [name, sql] of Object.entries(explains)) {
  try {
    const out = psql('EXPLAIN (ANALYZE, BUFFERS) ' + sql);
    const exec = /Execution Time: ([\d.]+) ms/.exec(out)?.[1];
    const seq = [...out.matchAll(/Seq Scan on (\w+)/g)].map((m) => m[1]);
    explainOut[name] = { exec: Number(exec), seq, out };
    console.log(`${(seq.length ? 'SEQSCAN(' + [...new Set(seq)].join(',') + ')' : 'indexed').padEnd(26)} ${String(exec).padStart(8)}ms  ${name}`);
  } catch (e) { console.log('explain failed for ' + name + ': ' + String(e.message).slice(0, 150)); }
}
for (const [name, e] of Object.entries(explainOut)) if (e.exec > 100) console.log(`\n--- plan for "${name}" (${e.exec}ms) ---\n` + e.out.split('\n').slice(0, 14).join('\n'));

// ---------------- 4. collab WebSocket stress, room cleanup, limiters ----------------
let synced = 0, converged = false, afterIdle = true, apiAlive = true, ok = 0, limited = 0, other = 0, put200 = 0, put429 = 0, putOther = 0, crashed = false, limiterNormal = false;
if (!process.env.PERF_SKIP_WS) {
  const collabMod = await import(pathToFileURL(path.join(REPO, 'dist', 'server', 'services', 'collab.js')).href);
  // the live-editing socket takes a single-use ticket (POST /api/collab/ticket), not the sign-in token
  const wsUrl = async (noteId) => { const r = await fetch(`http://127.0.0.1:${port}/api/collab/ticket`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ noteId }) }); const { ticket } = await r.json(); return `ws://127.0.0.1:${port}/collab?ticket=${encodeURIComponent(ticket || 'none')}&note=${noteId}`; };
  const makeClient = (noteId, label) => new Promise(async (resolve) => {
    const doc = new Y.Doc(); const text = doc.getText('perf');
    const ws = new WebSocket(await wsUrl(noteId)); ws.binaryType = 'arraybuffer';
    const c = { doc, text, ws, label, synced: false, closed: null, errors: 0 };
    const send = (enc) => { if (ws.readyState === 1) ws.send(encoding.toUint8Array(enc)); };
    doc.on('update', (u, origin) => { if (origin === ws) return; const e = encoding.createEncoder(); encoding.writeVarUint(e, 0); syncProtocol.writeUpdate(e, u); send(e); });
    ws.on('open', () => { const e = encoding.createEncoder(); encoding.writeVarUint(e, 0); syncProtocol.writeSyncStep1(e, doc); send(e); });
    ws.on('message', (data) => {
      try {
        const dec = decoding.createDecoder(new Uint8Array(data)); const type = decoding.readVarUint(dec);
        if (type === 0) { const e = encoding.createEncoder(); encoding.writeVarUint(e, 0); const st = syncProtocol.readSyncMessage(dec, e, doc, ws); if (st === 1) c.synced = true; if (encoding.length(e) > 1) send(e); }
      } catch { c.errors++; }
    });
    ws.on('close', (code) => { c.closed = code; });
    ws.on('error', () => { c.errors++; });
    ws.on('unexpected-response', (_q, res) => { c.closed = 'http ' + res.statusCode; resolve(c); });
    const wait = setInterval(() => { if (c.synced) { clearInterval(wait); resolve(c); } }, 20);
    setTimeout(() => { clearInterval(wait); resolve(c); }, 8000);
  });
  console.log('\n10 concurrent collab clients on one note');
  const collabNote = (await call('POST', '/api/notes', { title: 'collab perf', content: 'hello' })).json.note.id;
  const roomsBefore = collabMod.liveRoomIds().length;
  process.once('uncaughtException', () => { crashed = true; });
  const clients = await Promise.all(Array.from({ length: 10 }, (_, i) => makeClient(collabNote, 'c' + i)));
  synced = clients.filter((c) => c.synced).length;
  const tc = now();
  await Promise.all(clients.map(async (c, i) => { for (let k = 0; k < 40; k++) { c.text.insert(c.text.length, `[${i}.${k}]`); await sleep(15 + (i % 3) * 5); } }));
  await sleep(1500);
  const lens = clients.map((c) => c.text.toString());
  converged = lens.every((s) => s === lens[0]);
  const expectedLen = clients.reduce((a, _c, i) => a + Array.from({ length: 40 }, (_x, k) => `[${i}.${k}]`.length).reduce((x, y) => x + y, 0), 0);
  console.log(`synced ${synced}/10, converged ${converged}, length ${lens[0].length}/${expectedLen} in ${fmt(now() - tc)}ms, room live: ${collabMod.liveRoomIds().includes(collabNote)}, client errors ${clients.reduce((a, c) => a + c.errors, 0)}, closes ${clients.map((c) => c.closed).join(',')}`);
  apiAlive = (await call('GET', '/api/notes?limit=1')).status === 200;
  for (const c of clients) try { c.ws.close(); } catch { /* gone */ }
  await sleep(1000);
  console.log(`room still held 1s after all clients left: ${collabMod.liveRoomIds().includes(collabNote)} (idle close is 30s); waiting 33s ...`);
  await sleep(33000);
  afterIdle = collabMod.liveRoomIds().includes(collabNote);
  const persisted = psql(`select count(*) from note_ydocs where note_id='${collabNote}'`).trim();
  console.log(`room gone after idle: ${!afterIdle}; note_ydocs rows ${persisted}; server alive: ${apiAlive}; rooms ${roomsBefore} -> ${collabMod.liveRoomIds().length}`);
  await sleep(30000); // let the 10 upgrades above leave the one-minute window
  for (let i = 0; i < 70; i++) {
    const c = await new Promise(async (resolve) => {
      const ws = new WebSocket(await wsUrl(collabNote)); let done = false; const fin = (v) => { if (!done) { done = true; resolve(v); } };
      ws.on('open', () => fin({ ws, code: 'open' })); ws.on('unexpected-response', (_q, res) => fin({ ws, code: res.statusCode })); ws.on('error', () => fin({ ws, code: 'err' }));
    });
    if (c.code === 'open') { ok++; c.ws.close(); } else if (c.code === 429) limited++; else other++;
  }
  console.log(`70 upgrades in a burst: ${ok} accepted, ${limited} answered 429, ${other} other  (limit is 60/min per address)`);
  await sleep(1500);
  const shTok2 = (await call('POST', `/api/share/note/${noteIds[5]}`, { edit: true })).json.token;
  const cur = (await call('GET', `/api/notes/${noteIds[5]}`)).json.note;
  const putMs = [];
  for (let i = 0; i < 320; i++) {
    const t = now();
    const r = await fetch(`${base}/api/public/note/${shTok2}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: cur.title, content: cur.content + `\n\nguest edit ${i}`, baseUpdatedAt: cur.updatedAt, baseContent: cur.content }) });
    putMs.push(now() - t);
    if (r.status === 200) put200++; else if (r.status === 429) put429++; else putOther++;
    await r.arrayBuffer();
  }
  console.log(`320 guest PUTs: ${put200} ok, ${put429} answered 429, ${putOther} other (limit 300/min per address); PUT p50 ${fmt(pct(putMs, 50))}ms p95 ${fmt(pct(putMs, 95))}ms`);
  rows.push({ area: 'share', name: 'PUT /api/public/note/:token (guest save)', p50: pct(putMs, 50), p95: pct(putMs, 95), max: Math.max(...putMs), kb: 0, budget: 600, status: 200, slow: pct(putMs, 95) > 600 });
  limiterNormal = ok === 60 && limited >= 9 && put200 + putOther === 300 && put429 >= 19;
}

// ---------------- 5. browser: big note open time, typing latency, memory ----------------
const browserRows = [];
if (!process.env.PERF_SKIP_BROWSER) {
  if (CLIENT) { for (let i = 0; i < 240; i++) { try { if ((await fetch(CLIENT + '/')).ok) break; } catch { /* not up yet */ } await sleep(1000); } console.log('browser part runs against', CLIENT); }
  const mkNote = async (kb) => {
    const paras = []; let size = 0, k = 0;
    while (size < kb * 1024) { const p = (k % 25 === 0 ? `## Heading ${k}\n\n` : k % 7 === 3 ? '- ' : '') + para(380); paras.push(p); size += p.length + 2; k++; }
    const r = await call('POST', '/api/notes', { title: `Big ${kb}KB`, content: paras.join('\n\n') + '\n\nENDMARK' });
    return { id: r.json.note?.id, status: r.status, blocks: paras.length };
  };
  const sizes = (process.env.PERF_SIZES || `20,500,${BIG_KB}`).split(',').map(Number);
  for (const kb of sizes) {
    const label = kb >= 1024 ? kb / 1024 + 'MB' : kb + 'KB';
    const note = await mkNote(kb);
    if (!note.id) { console.log(`cannot create ${label} note (${note.status})`); continue; }
    const page = await ctx.newPage(); page.on('dialog', (d) => d.accept());
    await page.addInitScript(() => { try { localStorage.setItem('peblo-debug', '1'); } catch { /* none */ } window.__lt = []; try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push(e.duration); }).observe({ entryTypes: ['longtask'] }); } catch { /* none */ } });
    const cdp = await ctx.newCDPSession(page); await cdp.send('Performance.enable');
    const heap = async () => { await cdp.send('HeapProfiler.collectGarbage'); const m = await cdp.send('Performance.getMetrics'); return m.metrics.find((x) => x.name === 'JSHeapUsedSize').value / 1048576; };
    const reqs = []; page.on('request', (r) => { if (/\/api\/(notes|public)/.test(r.url()) && ['PATCH', 'PUT', 'POST'].includes(r.method())) reqs.push(r.method()); });
    const row = { label, blocks: note.blocks };
    const t = now();
    try {
      await page.goto((CLIENT || base) + `/notes/${note.id}`);
      await page.locator('.bn-editor').waitFor({ timeout: 240000 });
      row.editorMs = now() - t;
      await page.waitForFunction(() => document.querySelector('.bn-editor')?.textContent.includes('ENDMARK'), null, { timeout: 240000 });
      row.contentMs = now() - t;
      await page.waitForFunction(() => !!window.__pebloEditor, null, { timeout: 20000 }).catch(() => {});
      await page.locator('.bn-block-content').last().click();
      const ti = now(); await page.keyboard.press('End'); await page.keyboard.type('Z');
      await page.waitForFunction(() => document.querySelector('.bn-editor')?.textContent.includes('ENDMARKZ'), null, { timeout: 240000 });
      row.tti = now() - t; row.firstKeyMs = now() - ti;
      row.domNodes = await page.evaluate(() => document.querySelectorAll('*').length);
      row.live = await page.evaluate(() => !!window.__pebloCollab);
      row.serializeMs = await page.evaluate(async () => { const ed = window.__pebloEditor; if (!ed) return null; const ts = []; for (let i = 0; i < 3; i++) { const a = performance.now(); await ed.blocksToMarkdownLossy(ed.document); ts.push(performance.now() - a); } return ts.sort((x, y) => x - y)[1]; });
      row.heap0 = await heap();
      await page.evaluate(() => { window.__lt.length = 0; });
      const reqs0 = reqs.length; const phrase = 'the quick brown fox jumps over the lazy dog '; const per = [];
      for (let i = 0; i < 200; i++) {
        const ch = phrase[i % phrase.length];
        const a = now(); await page.keyboard.press(ch === ' ' ? 'Space' : ch);
        await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))); per.push(now() - a);
        await sleep(25);
      }
      row.keyP50 = pct(per, 50); row.keyP95 = pct(per, 95); row.keyMax = Math.max(...per);
      const lt = await page.evaluate(() => window.__lt.slice()); row.longTasks = lt.length; row.longTaskMs = lt.reduce((a, b) => a + b, 0); row.longTaskMax = Math.max(0, ...lt);
      await sleep(3000); row.saves200 = reqs.length - reqs0;
      if (kb === BIG_KB || kb === 500) {
        const samples = [await heap()]; const tStart = now(); let keys = 0; const per2 = []; let lastSample = tStart;
        while (now() - tStart < TYPE_SECONDS * 1000) {
          const a = now(); await page.keyboard.press(keys % 9 === 8 ? 'Space' : 'KeyE'); keys++;
          await page.evaluate(() => new Promise((r) => requestAnimationFrame(r))); per2.push(now() - a);
          await sleep(40);
          if (now() - lastSample > 15000) { lastSample = now(); samples.push(await heap()); }
        }
        await sleep(4000); samples.push(await heap());
        row.memSamples = samples.map((s) => s.toFixed(0)).join(' > '); row.memGrowth = samples[samples.length - 1] - samples[0]; row.keys60 = keys; row.key60p95 = pct(per2, 95);
        row.savedLen = (await call('GET', `/api/notes/${note.id}`)).json.note.content.length;
      }
    } catch (e) { row.error = String(e.message).split('\n')[0]; }
    browserRows.push(row);
    console.log(JSON.stringify(row));
    await page.close().catch(() => {});
    if (row.error) break;
  }
}

// ---------------- report ----------------
console.log('\n================ RESULTS ================');
console.log('| area | endpoint | p50 ms | p95 ms | max ms | payload KB | budget | status |');
console.log('|---|---|---|---|---|---|---|---|');
for (const r of rows) console.log(`| ${r.area} | ${r.name} | ${fmt(r.p50)} | ${fmt(r.p95)} | ${fmt(r.max)} | ${fmt(r.kb)} | ${r.budget} | ${r.slow ? 'SLOW' : 'ok'} ${r.status} |`);
if (browserRows.length) {
  console.log('\n| note | blocks | editor shown ms | all text ms | TTI first key echo ms | DOM nodes | collab live | md serialize ms | key p50 | key p95 | key max | long tasks n / total ms / max | saves in 200 keys | heap MB over run | growth MB |');
  console.log('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const b of browserRows) console.log(`| ${b.label} | ${b.blocks} | ${fmt(b.editorMs)} | ${fmt(b.contentMs)} | ${fmt(b.tti)} | ${b.domNodes ?? '-'} | ${b.live} | ${fmt(b.serializeMs)} | ${fmt(b.keyP50)} | ${fmt(b.keyP95)} | ${fmt(b.keyMax)} | ${b.longTasks ?? '-'} / ${fmt(b.longTaskMs)} / ${fmt(b.longTaskMax)} | ${b.saves200 ?? '-'} | ${b.memSamples ?? '-'} | ${b.memGrowth !== undefined ? b.memGrowth.toFixed(1) : '-'} ${b.error ? 'ERR ' + b.error : ''} |`);
}
console.log(`\nlimiters: collab upgrades 70 burst -> ${ok} accepted / ${limited} 429 ; share PUT 320 -> ${put200} ok / ${putOther} other / ${put429} 429 ; as designed: ${limiterNormal}`);
console.log(`collab: synced ${synced}/10 converged ${converged} roomCleanup ${!afterIdle} serverAlive ${apiAlive} uncaught ${crashed}`);
console.log(`event loop: p99 ${(loop.percentile(99) / 1e6).toFixed(0)}ms max ${(loop.max / 1e6).toFixed(0)}ms; rss ${(process.memoryUsage().rss / 1048576).toFixed(0)}MB`);
console.log('slow endpoints: ' + (rows.filter((r) => r.slow).map((r) => r.name).join(' ; ') || 'none'));
await libFinish();

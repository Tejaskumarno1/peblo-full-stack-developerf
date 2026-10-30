// Encryption at rest for note text, end to end against the real server code.
// Run (after: node e2e/_enc-build.mjs):
//   $env:PEBLO_SERVER_DIST='dist-enc'; $env:PEBLO_TEST_DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:55432/peblo_test_enc'; node e2e/encryption.mjs
// Part 1 runs the server in this process with a random PEBLO_DATA_KEY on peblo_test_enc and reads the rows straight from Postgres.
// Part 2 starts extra server processes (e2e/_enc-child.mjs): wrong key, no key, key rotation, and the conversion of a seeded plaintext
// database (peblo_test_enc2, created and dropped here), also while that server is answering requests.
import crypto from 'crypto';
import path from 'path';
import { spawn, execFileSync } from 'child_process';
import { pathToFileURL } from 'url';
import WebSocket from 'ws';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import AdmZip from 'adm-zip';

process.env.PEBLO_SERVER_DIST = process.env.PEBLO_SERVER_DIST || 'dist-enc';
if (!/peblo_test_enc/.test(process.env.PEBLO_TEST_DATABASE_URL || '')) { console.error('set PEBLO_TEST_DATABASE_URL to the peblo_test_enc database'); process.exit(2); }
process.env.API_RATE_MAX = '1000000';
const KEY_A = crypto.randomBytes(32).toString('base64');
const KEY_B = crypto.randomBytes(32).toString('base64');
const keyId = (k) => crypto.createHash('sha256').update('peblo-data-key-id\0').update(Buffer.from(k, 'base64')).digest('hex').slice(0, 8);
process.env.PEBLO_DATA_KEY = KEY_A;
delete process.env.PEBLO_DATA_KEY_OLD;
delete process.env.PEBLO_ENCRYPT_EXISTING;

// rows left by an earlier run were written under that run's random key: start from an empty database
const PSQL = 'C:\\Program Files\\PostgreSQL\\17\\bin\\psql.exe';
const psql = (db, sql) => execFileSync(PSQL, ['-w', '-h', '127.0.0.1', '-p', '55432', '-U', 'postgres', '-d', db, '-tA', '-F', '|', '-c', sql], { env: { ...process.env, PGPASSWORD: 'postgres' }, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim();
try { psql('peblo_test_enc', 'TRUNCATE users CASCADE'); } catch { /* first run: no tables yet */ }
const { boot, REPO } = await import('./lib.mjs');
const { base, check, finish, token } = await boot();
const DIST = path.join(REPO, process.env.PEBLO_SERVER_DIST, 'server');
const { default: prisma } = await import(pathToFileURL(path.join(DIST, 'db.js')).href);
const { fingerprint } = await import(pathToFileURL(path.join(DIST, 'services', 'collab.js')).href);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rnd = () => crypto.randomBytes(5).toString('hex');
const call = async (method, url, body, tok = token, b = base) => {
  const res = await fetch(b + url, { method, headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json = {}; try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, json, text };
};
const raw = async (sql, ...p) => prisma.$queryRawUnsafe(sql, ...p); // bypasses the encryption layer: shows what the database holds
const col = async (table, column, id, pk = 'id') => (await raw(`SELECT ${column} AS v FROM ${table} WHERE ${pk} = $1`, id))[0]?.v;
const isCipher = (v) => typeof v === 'string' && /^enc:v1:[0-9a-f]{8}:[A-Za-z0-9+/=]+$/.test(v);
const mkNote = async (title, content, tags = []) => (await call('POST', '/api/notes', { title, content, tags })).json.note;

// ====================================================================================== PART 1
console.log('--- part 1: encryption in the running server ---');
const S1 = 'quokka' + rnd();
const n1 = await mkNote('Plain Title Alpha', `# Heading\n\nThe ${S1} lives here.`, ['encprobe']);
check('create: API returns plain text', n1?.content?.includes(S1), JSON.stringify(n1)?.slice(0, 200));
let c1 = await col('notes', 'content', n1.id);
check('create: database holds enc:v1: ciphertext', isCipher(c1), String(c1).slice(0, 60));
check('create: ciphertext hides the text', !String(c1).includes(S1) && !String(c1).includes('Heading'));
check('title stays plain text (known limitation)', (await col('notes', 'title', n1.id)) === 'Plain Title Alpha');
check('get: API returns plain text', (await call('GET', `/api/notes/${n1.id}`)).json.note?.content?.includes(S1));
const S1b = 'wombat' + rnd();
const up = await call('PATCH', `/api/notes/${n1.id}`, { content: `Updated body ${S1b}` });
const c1b = await col('notes', 'content', n1.id);
check('update: ciphertext replaced, new IV, still hidden', up.status === 200 && isCipher(c1b) && c1b !== c1 && !c1b.includes(S1b));
const cur = (await call('GET', `/api/notes/${n1.id}`)).json.note;
check('update: reads back the new text', cur.content === `Updated body ${S1b}`);
const S1c = 'platypus' + rnd();
const up2 = await call('PATCH', `/api/notes/${n1.id}`, { content: `Merged save ${S1c}`, baseUpdatedAt: cur.updatedAt, baseContent: cur.content });
check('merged save (noteSave.ts) stores ciphertext and answers 200', up2.status === 200 && isCipher(await col('notes', 'content', n1.id)) && (await call('GET', `/api/notes/${n1.id}`)).json.note.content === `Merged save ${S1c}`);
const empty = await mkNote('Empty one', '');
check('empty note stays empty (nothing to hide)', (await col('notes', 'content', empty.id)) === '');
const odd = await mkNote('Odd text', 'enc:v1:deadbeef:not really base64 !!! just a note about the format');
check('a note that merely starts like ciphertext round-trips', (await call('GET', `/api/notes/${odd.id}`)).json.note?.content?.startsWith('enc:v1:deadbeef:not really'));
const uni = 'Zażółć gęślą jaźń 日本語 \u{1F600} ' + rnd();
const un = await mkNote('Unicode', uni);
check('unicode round-trips', (await call('GET', `/api/notes/${un.id}`)).json.note.content === uni);

// ---- list / search
const W = 'zucchini' + rnd();
const n2 = await mkNote('Gardening Journal', `Planted tomatoes and ${W} today. ` + 'filler '.repeat(120), ['plants']);
const n3 = await mkNote('Meeting notes', 'budget review with the team');
const n4 = await mkNote('Misc stuff', 'nothing to see', ['rarelabel' + 'x1']);
const ids = (r) => (r.json.notes || []).map((n) => n.id);
let r = await call('GET', `/api/notes?search=${W}`);
check('search by a word in the text', ids(r).includes(n2.id) && ids(r).length === 1, r.text.slice(0, 200));
check('search result keeps its shape (tags array, matchSnippet, score, content)', r.json.notes[0] && Array.isArray(r.json.notes[0].tags) && typeof r.json.notes[0].matchSnippet === 'string' && r.json.notes[0].matchSnippet.includes(W) && typeof r.json.notes[0].score === 'number' && r.json.notes[0].content.includes(W) && 'hasSummary' in r.json.notes[0] && Array.isArray(r.json.notes[0].linkedTodos));
r = await call('GET', `/api/notes?search=${W.toUpperCase()}`);
check('search ignores case', ids(r).includes(n2.id));
r = await call('GET', '/api/notes?search=Gardening');
check('search by title', ids(r).includes(n2.id));
r = await call('GET', '/api/notes?search=rarelabelx1');
check('search by tag', ids(r).includes(n4.id));
r = await call('GET', '/api/notes?search=meetng');
check('fuzzy title search ("meetng" finds "Meeting notes")', ids(r).includes(n3.id), r.text.slice(0, 200));
r = await call('GET', `/api/notes?search=tomatoes+${W}`);
check('search with several words', ids(r).includes(n2.id));
r = await call('GET', '/api/notes?search=nosuchwordanywhere123');
check('search with no hit returns an empty list', r.status === 200 && ids(r).length === 0);
r = await call('GET', `/api/notes?search=${W}&snippet=1`);
check('snippet=1 cuts long text to 400 chars and says so', r.json.notes[0].content.length === 400 && r.json.notes[0].truncated === true);
const allE = ids(await call('GET', '/api/notes?search=e'));
r = await call('GET', '/api/notes?search=e&limit=2&offset=0');
const r2 = await call('GET', '/api/notes?search=e&limit=2&offset=2');
check('search paging (limit/offset) is applied after the text filter', allE.length >= 5 && r.json.notes.length === 2 && r.json.limit === 2 && r2.json.notes.length === 2 && ids(r).every((i) => allE.includes(i)) && ids(r2).every((i) => allE.includes(i)) && !ids(r).some((i) => ids(r2).includes(i)), `${allE.length} ${ids(r)} | ${ids(r2)}`);
r = await call('GET', '/api/notes?tag=plants');
check('tag filter', ids(r).includes(n2.id) && !ids(r).includes(n3.id));
r = await call('GET', '/api/notes');
check('full list returns every note decrypted', r.status === 200 && r.json.notes.find((n) => n.id === n1.id)?.content === `Merged save ${S1c}`);

// ---- mentions / backlinks
const target = await mkNote('Photosynthesis Guide', 'About light and plants.');
const other = await mkNote('Study log', 'Yesterday I read the photosynthesis guide twice.');
r = await call('GET', `/api/notes/${target.id}/mentions`);
check('mentions: a note that says the title is found (searched in JS)', r.json.mentions?.some((m) => m.id === other.id && /photosynthesis guide/i.test(m.snippet)), r.text.slice(0, 200));
r = await call('POST', `/api/notes/${target.id}/mentions/${other.id}/link`);
const linked = (await call('GET', `/api/notes/${other.id}`)).json.note.content;
check('mentions: link inserted into the other note', r.status === 200 && linked.includes(`](/notes/${target.id})`) && isCipher(await col('notes', 'content', other.id)));
r = await call('GET', `/api/notes/${target.id}/backlinks`);
check('backlinks: lists the note that links here', r.json.backlinks?.some((b) => b.id === other.id));

// ---- versions
const V1 = 'versionone' + rnd();
const vn = await mkNote('Versioned', `first text ${V1}`);
await call('PATCH', `/api/notes/${vn.id}`, { content: 'second text only' });
r = await call('GET', `/api/notes/${vn.id}/backups`);
const b0 = r.json.backups?.[0];
check('versions list: preview and size come from the decrypted text', b0 && b0.preview === `first text ${V1}` && b0.size === `first text ${V1}`.length, r.text.slice(0, 200));
check('versions: stored encrypted', isCipher(await col('note_backups', 'content', b0.id)));
r = await call('GET', `/api/notes/${vn.id}/backups/${b0.id}`);
check('one version: plain text returned', r.json.backup?.content === `first text ${V1}`);
r = await call('POST', `/api/notes/${vn.id}/versions`, { label: 'checkpoint' });
check('name a version', r.status === 200 && r.json.ok);
r = await call('POST', `/api/notes/${vn.id}/backups/${b0.id}/revert`);
check('restore a version: note has the old text again', r.status === 200 && (await call('GET', `/api/notes/${vn.id}`)).json.note.content === `first text ${V1}` && isCipher(await col('notes', 'content', vn.id)), r.text.slice(0, 200));
const list2 = (await call('GET', `/api/notes/${vn.id}/backups`)).json.backups;
check('restore kept the replaced text as a version (readable)', list2.some((b) => b.preview === 'second text only'));

// ---- trash
const tn = await mkNote('Trash me', 'trash body ' + rnd());
r = await call('DELETE', `/api/notes/${tn.id}`);
const tl = await call('GET', '/api/notes?deleted=true');
check('trash: moved and listed with its text', r.status === 200 && tl.json.notes.find((n) => n.id === tn.id)?.content === tn.content);
r = await call('POST', `/api/notes/${tn.id}/restore`);
check('restore from trash returns the note with text', r.status === 200 && r.json.note?.content === tn.content && isCipher(await col('notes', 'content', tn.id)));

// ---- share link (read + guest edit)
const sn = await mkNote('Shared one', 'shared body ' + rnd());
const sh = await call('POST', `/api/share/note/${sn.id}`, { edit: true });
const tok = sh.json.token;
r = await call('GET', `/api/public/note/${tok}`, null, null);
check('share: public read returns plain text', r.status === 200 && r.json.content === sn.content, r.text.slice(0, 160));
const G = 'guestedit' + rnd();
r = await call('PUT', `/api/public/note/${tok}`, { title: 'Shared one', content: `${sn.content}\n\n${G}`, baseUpdatedAt: r.json.updatedAt, baseContent: sn.content }, null);
check('share: guest edit saved', r.status === 200, r.text.slice(0, 160));
check('share: guest edit is encrypted in the database and visible to the owner', isCipher(await col('notes', 'content', sn.id)) && !(await col('notes', 'content', sn.id)).includes(G) && (await call('GET', `/api/notes/${sn.id}`)).json.note.content.includes(G));
const md = await fetch(`${base}/s/note/${tok}.md`);
check('share: Markdown view for agents works', md.status === 200 && (await md.text()).includes(G));

// ---- comments + notifications
const cn = await mkNote('Commented', 'comment target text');
const CM = 'commentsecret' + rnd();
r = await call('POST', `/api/collab/comments/${cn.id}`, { body: CM, quote: 'target text' });
const ownerCid = r.json.id;
check('comment: created', r.status === 200 && ownerCid, r.text.slice(0, 160));
const crow = (await raw('SELECT body, quote FROM note_comments WHERE id = $1', ownerCid))[0];
check('comment: body and quote stored encrypted', isCipher(crow?.body) && isCipher(crow?.quote) && !crow.body.includes(CM));
r = await call('GET', `/api/collab/comments/${cn.id}`);
check('comment: list returns plain text', r.json.comments?.some((c) => c.body === CM && c.quote === 'target text'));
const cshare = (await call('POST', `/api/share/note/${cn.id}`, { edit: true })).json.token;
const sid = 'sid' + crypto.randomBytes(12).toString('hex');
const GC = 'guestcomment' + rnd();
r = await call('POST', `/api/public/collab/${cshare}/comments`, { sid, name: 'Guesty', body: GC }, null);
check('guest comment on a shared note', r.status === 200, r.text.slice(0, 160));
r = await call('GET', '/api/collab/notifications');
const notif = r.json.notifications?.find((n) => n.body === GC);
check('notification body is readable through the API', !!notif, r.text.slice(0, 200));
check('notification body stored encrypted', isCipher(await col('user_notifications', 'body', notif?.id)));
r = await call('GET', `/api/public/collab/${cshare}/comments?sid=${sid}`, null, null);
check('guest sees the comments (decrypted)', r.json.comments?.some((c) => c.body === GC));

// ---- AI-derived tables written through the client layer, and the compare-and-swap in river.ts
const gnote = await mkNote('For AI rows', 'content for ai rows ' + rnd());
const me = (await raw('SELECT user_id FROM notes WHERE id = $1', gnote.id))[0].user_id;
const PR = 'promise' + rnd();
const gen = await prisma.aiGeneration.create({ data: { noteId: gnote.id, userId: me, type: 'promises', result: JSON.stringify({ items: [{ text: PR, status: 'open' }] }) } });
check('ai_generations.result stored encrypted', isCipher(await col('ai_generations', 'result', gen.id)) && !(await col('ai_generations', 'result', gen.id)).includes(PR));
r = await call('GET', `/api/river/promises?noteId=${gnote.id}`);
check('river: promises read back decrypted', r.json.promises?.[0]?.items?.[0]?.text === PR, r.text.slice(0, 200));
r = await call('PATCH', `/api/river/promises/${gen.id}`, { index: 0, status: 'added' });
check('river: status change (compare-and-swap on the stored value) works', r.status === 200 && r.json.items?.[0]?.status === 'added', r.text.slice(0, 200));
const afterCas = await col('ai_generations', 'result', gen.id);
check('river: still encrypted after the swap, and holds the change', isCipher(afterCas) && (await prisma.aiGeneration.findUnique({ where: { id: gen.id } })).result.includes('"added"'));
await prisma.noteEmbedding.upsert({ where: { noteId: gnote.id }, update: { vector: '[0.1,0.2]' }, create: { noteId: gnote.id, vector: '[0.1,0.2]' } });
await prisma.noteEmbedding.upsert({ where: { noteId: gnote.id }, update: { vector: '[0.3,0.4]' }, create: { noteId: gnote.id, vector: '[0.3,0.4]' } });
const emb = (await raw('SELECT id, vector FROM note_embeddings WHERE note_id = $1', gnote.id))[0];
check('embedding upsert (create then update) stored encrypted and readable', isCipher(emb.vector) && (await prisma.noteEmbedding.findUnique({ where: { noteId: gnote.id } })).vector === '[0.3,0.4]');
const QN = 'quizq' + rnd();
const quiz = await prisma.quizRun.create({ data: { userId: me, topic: 'enc-topic', questions: JSON.stringify([{ q: QN, noteId: gnote.id }]), total: 1 } });
check('quiz_runs.questions stored encrypted', isCipher(await col('quiz_runs', 'questions', quiz.id)));
r = await call('GET', `/api/study/notes/${gnote.id}/questions`);
check('study: count of questions from a note (searched in JS)', r.json.count === 1, r.text);
r = await call('POST', `/api/study/quiz/${quiz.id}/answers`, { answers: [0] });
check('study: answering a quiz (updateMany on finishedAt) works', r.status === 200, r.text.slice(0, 160));
check('quiz answers stored encrypted', isCipher(await col('quiz_runs', 'answers', quiz.id)));
// nested select/include of encrypted models
const nested = await prisma.noteBackup.findMany({ where: { noteId: vn.id }, select: { content: true, note: { select: { content: true, title: true } } }, take: 2 });
check('nested select through a relation decrypts both levels (and no id leaks)', nested.length > 0 && nested.every((x) => !x.content.startsWith('enc:v1:') && !x.note.content.startsWith('enc:v1:') && x.id === undefined && x.note.id === undefined));
const withInc = await prisma.note.findUnique({ where: { id: vn.id }, include: { backups: true } });
check('include of encrypted children decrypts them', withInc.backups.length > 0 && withInc.backups.every((b) => !b.content.startsWith('enc:v1:')));
let threw = '';
try { await prisma.note.findMany({ where: { content: { contains: 'x' } } }); } catch (e) { threw = e.message; }
check('a filter on an encrypted column is refused (cannot silently miss)', /encrypted/.test(threw), threw);

// ---- MCP + hub search + dashboard
const pat = (await call('POST', '/api/tokens', { name: 'e2e-enc', scope: 'full' })).json.token;
const rpc = async (name, args) => {
  const res = await fetch(base + '/mcp', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: 'Bearer ' + pat }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) });
  const t = await res.text();
  const data = t.includes('data:') ? t.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim())[0] : t;
  const j = JSON.parse(data);
  const txt = j.result?.content?.[0]?.text || '';
  return { err: !!j.result?.isError, text: txt, json: (() => { try { return JSON.parse(txt); } catch { return null; } })() };
};
let m = await rpc('search_notes', { query: W });
check('MCP search_notes finds a note by a word in its text', m.json?.some((n) => n.id === n2.id), m.text.slice(0, 200));
m = await rpc('get_note', { id: n2.id });
check('MCP get_note returns the text', (m.json?.markdown || '').includes(W));
const MU = 'mcpupdate' + rnd();
m = await rpc('update_note', { id: n3.id, content: `Budget ${MU}` });
check('MCP update_note stores encrypted text', !m.err && isCipher(await col('notes', 'content', n3.id)) && (await call('GET', `/api/notes/${n3.id}`)).json.note.content.includes(MU), m.text.slice(0, 200));
m = await rpc('append_to_note', { id: n3.id, text: 'appended line' });
check('MCP append_to_note', !m.err && (await call('GET', `/api/notes/${n3.id}`)).json.note.content.includes('appended line'), m.text.slice(0, 200));
m = await rpc('list_note_history', { id: n3.id });
check('MCP list_note_history', !m.err, m.text.slice(0, 200));
await sleep(500);
const act = (await call('GET', '/api/tokens/activity')).json.activity || [];
const actRow = (await raw(`SELECT summary FROM mcp_activity WHERE user_id = $1 ORDER BY at DESC LIMIT 1`, me))[0];
check('MCP activity log: summary stored encrypted, shown decrypted', act.length > 0 && isCipher(actRow?.summary) && act.some((a) => a.tool === 'search_notes' && a.summary === W), JSON.stringify(act).slice(0, 200));
r = await call('POST', '/api/ai/hub/search', { query: `tomatoes ${W}` });
check('hub search (retrieval) finds the note with a snippet around the word', r.json.sources?.some((s) => s.id === n2.id && s.snippet.includes(W)), r.text.slice(0, 200));
check('dashboard insights still answer', (await call('GET', '/api/dashboard/insights')).status === 200);

// ---- import / export / backup / restore
const IMP = 'importsecret' + rnd();
const form = new FormData();
form.append('files', new Blob([`# Imported Note\n\nBody with ${IMP}\n`], { type: 'text/markdown' }), 'imported-note.md');
let imp = await fetch(base + '/api/import', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form });
const impJson = await imp.json();
const impId = impJson.notes?.[0]?.id;
check('import: note created', imp.status === 200 && impJson.imported === 1 && impId, JSON.stringify(impJson).slice(0, 200));
check('import: stored encrypted, readable', isCipher(await col('notes', 'content', impId)) && (await call('GET', `/api/notes/${impId}`)).json.note.content.includes(IMP));
const ex = await fetch(base + '/api/export', { headers: { Authorization: `Bearer ${token}` } });
const zip = new AdmZip(Buffer.from(await ex.arrayBuffer()));
check('export: zip holds the decrypted Markdown', ex.status === 200 && zip.getEntries().some((e) => e.getData().toString('utf8').includes(IMP)));
const bk = await call('GET', '/api/backup');
check('backup: JSON has plain note text, no ciphertext', bk.json.notes?.some((n) => n.content?.includes(IMP)) && !/enc:v1:[0-9a-f]{8}:[A-Za-z0-9+\/]{40,}/.test(bk.text));
const before = (await call('GET', '/api/notes')).json.notes.length;
const rs = await call('POST', '/api/restore', bk.json);
const afterN = (await call('GET', '/api/notes')).json.notes.length;
check('restore: notes re-created from the backup file', rs.status === 200 && afterN > before, rs.text.slice(0, 200));
const plainLeft1 = await raw(`SELECT count(*)::int AS n FROM notes WHERE content <> '' AND content NOT LIKE 'enc:v1:%' AND user_id = $1`, me);
check('no plain text sits in notes.content for this user (after create/update/import/restore/mcp)', plainLeft1[0].n === 0, JSON.stringify(plainLeft1));

// ---- live collab: edit, persist, reload
const lc = await mkNote('Live', 'live base text');
const LIVE = 'livesecret' + rnd();
const openRoom = async (noteId) => {
  const t = (await call('POST', '/api/collab/ticket', { noteId })).json.ticket;
  const doc = new Y.Doc(); const text = doc.getText('t');
  const ws = new WebSocket(`${base.replace('http', 'ws')}/collab?ticket=${encodeURIComponent(t)}&note=${noteId}`); ws.binaryType = 'arraybuffer';
  const c = { doc, text, ws, synced: false, closed: null };
  const sendEnc = (e) => { if (ws.readyState === 1) ws.send(encoding.toUint8Array(e)); };
  doc.on('update', (u, origin) => { if (origin === ws) return; const e = encoding.createEncoder(); encoding.writeVarUint(e, 0); syncProtocol.writeUpdate(e, u); sendEnc(e); });
  ws.on('open', () => { const e = encoding.createEncoder(); encoding.writeVarUint(e, 0); syncProtocol.writeSyncStep1(e, doc); sendEnc(e); });
  ws.on('message', (data) => { try { const dec = decoding.createDecoder(new Uint8Array(data)); if (decoding.readVarUint(dec) === 0) { const e = encoding.createEncoder(); encoding.writeVarUint(e, 0); const st = syncProtocol.readSyncMessage(dec, e, doc, ws); if (st === 1) c.synced = true; if (encoding.length(e) > 1) sendEnc(e); } } catch { /* ignore */ } });
  ws.on('close', (code) => { c.closed = code; });
  ws.on('unexpected-response', (_q, res2) => { c.closed = 'http ' + res2.statusCode; });
  for (let i = 0; i < 100 && !c.synced && !c.closed; i++) await sleep(50);
  return c;
};
let live = await openRoom(lc.id);
check('collab: owner joins the live room', live.synced, String(live.closed));
live.text.insert(0, LIVE);
await sleep(2500); // the room saves 1.5 s after the last change
const yrow = (await raw('SELECT state, md_hash FROM note_ydocs WHERE note_id = $1', lc.id))[0];
const stateBuf = yrow ? Buffer.from(yrow.state) : Buffer.alloc(0);
check('collab: saved Yjs document is encrypted (magic header, text absent)', stateBuf.subarray(0, 7).toString('latin1') === 'PEBENC1' && !stateBuf.includes(Buffer.from(LIVE)) && !stateBuf.includes(Buffer.from('live base text')));
check('collab: md_hash stored encrypted', isCipher(yrow?.md_hash));
live.ws.close();
console.log('   (waiting 33 s for the room to be freed from memory, so the next join loads it from the database)');
await sleep(33000);
const live2 = await openRoom(lc.id);
check('collab: after the room was dropped, the encrypted document loads back with the edit', live2.synced && live2.text.toString() === LIVE, `synced=${live2.synced} text=${live2.text.toString().slice(0, 40)}`);
live2.ws.close();

// ---- swapped ciphertext (AAD) and a damaged value
const sa = await mkNote('Swap A', 'swap a ' + rnd());
const sb = await mkNote('Swap B', 'swap b ' + rnd());
const ca = await col('notes', 'content', sa.id); const cb = await col('notes', 'content', sb.id);
await raw('UPDATE notes SET content = $1 WHERE id = $2', cb, sa.id);
await raw('UPDATE notes SET content = $1 WHERE id = $2', ca, sb.id);
r = await call('GET', `/api/notes/${sa.id}`);
check('swapped ciphertext between two rows is rejected (500, generic message, no text)', r.status === 500 && !r.text.includes('swap') && !/enc:v1/.test(r.text), r.text.slice(0, 200));
r = await call('PATCH', `/api/notes/${sa.id}`, { content: 'overwrite attempt', baseUpdatedAt: new Date(0).toISOString(), baseContent: 'x' });
check('a save on top of an unreadable value does not overwrite it', r.status === 500 && (await col('notes', 'content', sa.id)) === cb);
await raw('UPDATE notes SET content = $1 WHERE id = $2', ca, sa.id);
await raw('UPDATE notes SET content = $1 WHERE id = $2', cb, sb.id);
check('swapped back: readable again', (await call('GET', `/api/notes/${sa.id}`)).json.note?.content === sa.content);
await raw('UPDATE notes SET content = $1 WHERE id = $2', ca.slice(0, -6) + 'AAAAAA', sa.id);
check('a damaged value is rejected cleanly', (await call('GET', `/api/notes/${sa.id}`)).status === 500);
await raw('UPDATE notes SET content = $1 WHERE id = $2', ca, sa.id);
const bkRow = (await raw('SELECT id FROM note_backups WHERE note_id = $1 LIMIT 1', vn.id))[0];
const bkOrig = await col('note_backups', 'content', bkRow.id);
await raw('UPDATE note_backups SET content = $1 WHERE id = $2', await col('notes', 'content', sb.id), bkRow.id);
check('a note value moved into another table is rejected too', (await call('GET', `/api/notes/${vn.id}/backups/${bkRow.id}`)).status === 500);
await raw('UPDATE note_backups SET content = $1 WHERE id = $2', bkOrig, bkRow.id);

// ====================================================================================== PART 2
console.log('--- part 2: wrong key, no key, rotation, conversion of existing data (extra server processes) ---');
const DB1 = process.env.PEBLO_TEST_DATABASE_URL;
const DB2NAME = 'peblo_test_enc2';
const DB2 = 'postgresql://postgres:postgres@127.0.0.1:55432/' + DB2NAME;
const children = [];
const startChild = async (db, env) => {
  const e = { ...process.env, ENC_CHILD_DB: db, ...env };
  for (const k of ['PEBLO_DATA_KEY', 'PEBLO_DATA_KEY_OLD', 'PEBLO_ENCRYPT_EXISTING']) if (env[k] === undefined) delete e[k];
  const p = spawn(process.execPath, [path.join('e2e', '_enc-child.mjs')], { cwd: REPO, env: e, stdio: ['pipe', 'pipe', 'pipe'] });
  const c = { p, out: '', port: 0 };
  p.stdout.on('data', (d) => { c.out += d; }); p.stderr.on('data', (d) => { c.out += d; });
  for (let i = 0; i < 300 && !/PORT=\d+/.test(c.out); i++) { if (p.exitCode !== null) break; await sleep(100); }
  const mm = /PORT=(\d+)/.exec(c.out);
  if (!mm) throw new Error('child did not start: ' + c.out.slice(0, 500));
  c.port = Number(mm[1]); c.base = 'http://127.0.0.1:' + c.port;
  children.push(c);
  c.stop = async () => { try { p.stdin.end(); } catch { /* gone */ } for (let i = 0; i < 50 && p.exitCode === null; i++) await sleep(100); if (p.exitCode === null) p.kill(); };
  return c;
};
const signup = async (c) => (await (await fetch(c.base + '/api/auth/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: `enc-${rnd()}@peblo.test`, password: 'correct horse battery', name: 'Enc' }) })).json()).token;

// ---- wrong key on the database that now holds encrypted notes
const keepA = await col('notes', 'content', n1.id);
const wrong = await startChild(DB1, { PEBLO_DATA_KEY: KEY_B });
const myEmail = (await raw('SELECT email FROM users WHERE id = $1', me))[0].email;
const tokWrong = (await (await fetch(wrong.base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: myEmail, password: 'correct horse battery' }) })).json()).token;
r = await call('GET', `/api/notes/${n1.id}`, null, tokWrong, wrong.base);
check('wrong key: reading an encrypted note fails cleanly (500, generic text)', r.status === 500 && !r.text.includes(S1c) && !/enc:v1|PEBLO/i.test(r.text), r.text.slice(0, 200));
r = await call('PATCH', `/api/notes/${n1.id}`, { content: 'wrong key overwrite' }, tokWrong, wrong.base);
check('wrong key: a write is refused', r.status === 500, r.text.slice(0, 200));
r = await call('POST', '/api/notes', { title: 'new with wrong key', content: 'must not be stored' }, tokWrong, wrong.base);
check('wrong key: creating a note is refused too (nothing written)', r.status === 500 && (await raw(`SELECT count(*)::int AS n FROM notes WHERE title = 'new with wrong key'`))[0].n === 0, r.text.slice(0, 200));
check('wrong key: stored ciphertext untouched', (await col('notes', 'content', n1.id)) === keepA);
check('wrong key: the server says why in its log, without printing any key or content', /LOCKED/.test(wrong.out) && !wrong.out.includes(KEY_A) && !wrong.out.includes(KEY_B) && !wrong.out.includes(S1c), wrong.out.slice(0, 400));
check('wrong key: other endpoints (health) still answer', (await fetch(wrong.base + '/api/health')).status === 200);
await wrong.stop();

// ---- no key, database holds encrypted notes plus a legacy plain one
const plainId = crypto.randomUUID();
await raw(`INSERT INTO notes (id, user_id, title, content, updated_at) VALUES ($1, $2, 'Legacy plain', 'legacy plaintext body', now())`, plainId, me);
const nokey = await startChild(DB1, {});
r = await call('GET', `/api/notes/${plainId}`, null, tokWrong, nokey.base);
check('no key: an old plain-text note is still readable', r.status === 200 && r.json.note.content === 'legacy plaintext body', r.text.slice(0, 200));
r = await call('GET', `/api/notes/${n1.id}`, null, tokWrong, nokey.base);
check('no key: an encrypted note answers 500 (generic), never ciphertext', r.status === 500 && !/enc:v1/.test(r.text), r.text.slice(0, 160));
r = await call('PATCH', `/api/notes/${plainId}`, { content: 'new plain text' }, tokWrong, nokey.base);
check('no key: writes are refused while the database holds encrypted data (no plain text mixed in)', r.status === 500 && (await col('notes', 'content', plainId)) === 'legacy plaintext body', r.text.slice(0, 160));
check('no key: ciphertext untouched', (await col('notes', 'content', n1.id)) === keepA);
await nokey.stop();
await raw('DELETE FROM notes WHERE id = $1', plainId);

// ---- a database that still holds only plain text (the owner's situation before enabling)
try { psql('postgres', `DROP DATABASE IF EXISTS ${DB2NAME}`); } catch { /* none */ }
psql('postgres', `CREATE DATABASE ${DB2NAME} ENCODING 'UTF8' TEMPLATE template0`);
const old = await startChild(DB2, {}); // no key: like the desktop app today
const t2 = await signup(old);
const mk2 = async (title, content, tags) => (await call('POST', '/api/notes', { title, content, tags }, t2, old.base)).json.note;
const LEG = 'legacysecret' + rnd();
const l1 = await mk2('Legacy one', `# One\n\n${LEG} first body`, ['legacy']);
const l2 = await mk2('Legacy two', `Second ${LEG}\n\nmore text`);
const l3 = await mk2('Legacy three', `Third ${LEG}`);
await call('PATCH', `/api/notes/${l1.id}`, { content: `# One\n\n${LEG} edited body` }, t2, old.base); // makes a version row
await call('POST', `/api/notes/${l2.id}/versions`, { label: 'legacy named' }, t2, old.base);
await call('POST', `/api/collab/comments/${l1.id}`, { body: `legacy comment ${LEG}`, quote: 'edited body' }, t2, old.base);
const lsh = (await call('POST', `/api/share/note/${l3.id}`, { edit: true }, t2, old.base)).json.token;
await call('POST', `/api/public/collab/${lsh}/comments`, { sid: 'legacysession' + rnd() + 'abcd', name: 'G', body: `guest ${LEG}` }, null, old.base);
const l2user = psql(DB2NAME, `SELECT user_id FROM notes WHERE id = '${l1.id}'`);
const ydoc = new Y.Doc(); ydoc.getText('t').insert(0, `ydoc ${LEG}`);
const l1content = (await call('GET', `/api/notes/${l1.id}`, null, t2, old.base)).json.note.content;
psql(DB2NAME, `INSERT INTO note_ydocs (note_id, state, md_hash) VALUES ('${l1.id}', decode('${Buffer.from(Y.encodeStateAsUpdate(ydoc)).toString('hex')}', 'hex'), '${fingerprint(l1content)}')`);
psql(DB2NAME, `INSERT INTO ai_generations (id, note_id, user_id, type, result) VALUES ('ag-${rnd()}', '${l1.id}', '${l2user}', 'summary', '{"s":"${LEG} summary"}')`);
psql(DB2NAME, `INSERT INTO media (id, user_id, mime, size, data, description) VALUES ('media${rnd()}0000', '${l2user}', 'image/png', 3, decode('010203','hex'), 'picture of ${LEG}')`);
psql(DB2NAME, `INSERT INTO notes (id, user_id, title, content, updated_at) SELECT 'bulk-' || g, '${l2user}', 'Bulk ' || g, 'bulkplain ' || g || ' ' || repeat('lorem ipsum ', 150), now() - (g || ' minutes')::interval FROM generate_series(1, 600) g`);
const snap = async (c) => ({ list: (await call('GET', '/api/notes', null, t2, c.base)).json.notes.map((n) => [n.id, n.title, n.content]).sort(), vers: (await call('GET', `/api/notes/${l2.id}/backups`, null, t2, c.base)).json.backups.map((b) => b.preview), cm: (await call('GET', `/api/collab/comments/${l1.id}`, null, t2, c.base)).json.comments.map((c2) => c2.body) });
const snapBefore = JSON.stringify(await snap(old));
const stamps = psql(DB2NAME, `SELECT id, updated_at FROM notes WHERE id IN ('${l1.id}','${l2.id}') ORDER BY id`);
await old.stop();
check('legacy database really holds plain text', psql(DB2NAME, `SELECT count(*) FROM notes WHERE content LIKE '%${LEG}%'`) === '3');
const cli = (args, env = {}) => new Promise((resolve) => {
  const p = spawn(process.execPath, [path.join('scripts', 'encrypt-existing.mjs'), ...args], { cwd: REPO, env: { ...process.env, DATABASE_URL: DB2, PEBLO_DATA_KEY: KEY_A, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = ''; p.stdout.on('data', (d) => { out += d; }); p.stderr.on('data', (d) => { out += d; });
  p.on('close', (code) => resolve({ code, out }));
});
const dump = () => psql(DB2NAME, `SELECT md5(string_agg(coalesce(content,''), '|' ORDER BY id)) FROM notes UNION ALL SELECT md5(coalesce(string_agg(coalesce(content,''), '|' ORDER BY id),'')) FROM note_backups UNION ALL SELECT md5(coalesce(string_agg(coalesce(body,'')||coalesce(quote,''), '|' ORDER BY id),'')) FROM note_comments UNION ALL SELECT md5(coalesce(string_agg(encode(state,'hex')||coalesce(md_hash,''), '|' ORDER BY note_id),'')) FROM note_ydocs UNION ALL SELECT md5(coalesce(string_agg(coalesce(result,''), '|' ORDER BY id),'')) FROM ai_generations UNION ALL SELECT md5(coalesce(string_agg(coalesce(description,''), '|' ORDER BY id),'')) FROM media`);
const dumpBefore = dump();
const dry = await cli(['--dry-run']);
const num = (out, table, idx) => { const line = out.split('\n').find((l) => l.startsWith(table + ' ')); return line ? Number(line.trim().split(/\s+/)[idx]) : NaN; }; // idx: 2 = needing, 3 = plaintext, 4 = converted, 5 = re-keyed
check('CLI --dry-run counts what would change', dry.code === 0 && num(dry.out, 'notes', 2) === 603 && num(dry.out, 'note_backups', 2) >= 2 && num(dry.out, 'note_comments', 2) === 2 && num(dry.out, 'note_ydocs', 2) === 1 && num(dry.out, 'media', 2) === 1, dry.out.slice(0, 900));
check('CLI --dry-run changes nothing', dump() === dumpBefore);
check('CLI output has counts only (no note text, no key)', !dry.out.includes(LEG) && !dry.out.includes(KEY_A));

// ---- the server with a key reads the legacy rows, and writes ciphertext for new ones
const keyed = await startChild(DB2, { PEBLO_DATA_KEY: KEY_A });
check('key set on a legacy database: old plain rows still read exactly as before', JSON.stringify(await snap(keyed)) === snapBefore);
const fresh = (await call('POST', '/api/notes', { title: 'New after key', content: 'new ' + LEG }, t2, keyed.base)).json.note;
check('key set: a new note is stored as ciphertext next to the old plain ones', isCipher(psql(DB2NAME, `SELECT content FROM notes WHERE id = '${fresh.id}'`)));

// ---- convert while the server answers requests
let stopLoop = false; let reqs = 0; let bad = 0; let lastPatched = null; let patchCount = 0;
const hammer = (async () => {
  while (!stopLoop) {
    const a = await call('GET', '/api/notes', null, t2, keyed.base); reqs++;
    if (a.status !== 200 || !a.json.notes?.find((n) => n.id === l1.id)) bad++;
    if (patchCount < 25) { const txt = `live patch ${patchCount} ${LEG}`; const pr = await call('PATCH', `/api/notes/${l3.id}`, { content: txt }, t2, keyed.base); if (pr.status === 200) { lastPatched = txt; patchCount++; } else bad++; }
    await sleep(15);
  }
})();
const conv = await cli([]);
await sleep(300); stopLoop = true; await hammer;
check('CLI conversion finished OK', conv.code === 0, conv.out.slice(0, 900));
check(`requests kept working during the conversion (${reqs} requests, ${patchCount} edits)`, reqs > 5 && bad === 0 && patchCount > 0, `bad=${bad}`);
const plainLeft = psql(DB2NAME, `SELECT (SELECT count(*) FROM notes WHERE content <> '' AND content NOT LIKE 'enc:v1:%') + (SELECT count(*) FROM note_backups WHERE content <> '' AND content NOT LIKE 'enc:v1:%') + (SELECT count(*) FROM note_comments WHERE body <> '' AND body NOT LIKE 'enc:v1:%') + (SELECT count(*) FROM ai_generations WHERE result NOT LIKE 'enc:v1:%') + (SELECT count(*) FROM media WHERE description NOT LIKE 'enc:v1:%') + (SELECT count(*) FROM note_ydocs WHERE encode(substring(state from 1 for 7),'hex') <> '504542454e4331')`);
check('conversion: no plain text left in notes, versions, comments, AI results, media descriptions, Yjs documents', plainLeft === '0', plainLeft + '\n' + conv.out.slice(0, 900));
const after = await snap(keyed);
const norm = (o) => ({ ...o, list: o.list.map((x) => (x[0] === l3.id ? [x[0], x[1], ''] : x)).sort() });
const expected = JSON.parse(snapBefore); expected.list.push([fresh.id, 'New after key', 'new ' + LEG]);
check('conversion: every note, version and comment reads back identical', JSON.stringify(norm(after)) === JSON.stringify(norm(expected)), JSON.stringify(after).slice(0, 300));
check('conversion: the edit made during the conversion survived (not overwritten by the older plain copy)', (await call('GET', `/api/notes/${l3.id}`, null, t2, keyed.base)).json.note.content === lastPatched);
check('conversion does not touch updated_at (list order unchanged)', stamps === psql(DB2NAME, `SELECT id, updated_at FROM notes WHERE id IN ('${l1.id}','${l2.id}') ORDER BY id`));
const dumpMid = dump();
const again = await cli([]);
check('conversion twice is idempotent: second run converts nothing, database unchanged', again.code === 0 && dump() === dumpMid && ['notes', 'note_backups', 'note_comments', 'note_ydocs'].every((t) => num(again.out, t, 4) === 0 && num(again.out, t, 2) === 0), again.out.slice(0, 700));
check('--dry-run after conversion reports nothing left', num((await cli(['--dry-run'])).out, 'notes', 2) === 0);
// the converted Yjs document is loaded by the live room
const ydTicket = (await call('POST', '/api/collab/ticket', { noteId: l1.id }, t2, keyed.base)).json.ticket;
const yClient = await new Promise((resolve) => {
  const doc = new Y.Doc(); const ws = new WebSocket(`${keyed.base.replace('http', 'ws')}/collab?ticket=${ydTicket}&note=${l1.id}`); ws.binaryType = 'arraybuffer';
  const send = (e) => { if (ws.readyState === 1) ws.send(encoding.toUint8Array(e)); };
  ws.on('open', () => { const e = encoding.createEncoder(); encoding.writeVarUint(e, 0); syncProtocol.writeSyncStep1(e, doc); send(e); });
  ws.on('message', (data) => { const dec = decoding.createDecoder(new Uint8Array(data)); if (decoding.readVarUint(dec) === 0) { const e = encoding.createEncoder(); encoding.writeVarUint(e, 0); syncProtocol.readSyncMessage(dec, e, doc, ws); if (encoding.length(e) > 1) send(e); } });
  setTimeout(() => { resolve({ text: doc.getText('t').toString(), ws }); }, 2500);
});
check('converted Yjs document opens in the live room with its text', yClient.text === `ydoc ${LEG}`, yClient.text);
yClient.ws.close();
await keyed.stop();
check('server logs never contain note text or keys', !keyed.out.includes(LEG) && !keyed.out.includes(KEY_A) && !conv.out.includes(LEG), keyed.out.slice(0, 300));

// ---- startup job (PEBLO_ENCRYPT_EXISTING=1)
psql(DB2NAME, `INSERT INTO notes (id, user_id, title, content, updated_at) VALUES ('startup-plain-1', '${l2user}', 'Startup plain', 'startup ${LEG}', now())`);
psql(DB2NAME, `INSERT INTO note_backups (id, note_id, content) VALUES ('startup-bk-1', 'startup-plain-1', 'old startup ${LEG}')`);
const st = await startChild(DB2, { PEBLO_DATA_KEY: KEY_A, PEBLO_ENCRYPT_EXISTING: '1' });
let done = false;
for (let i = 0; i < 100 && !done; i++) { await sleep(300); done = isCipher(psql(DB2NAME, `SELECT content FROM notes WHERE id = 'startup-plain-1'`)) && isCipher(psql(DB2NAME, `SELECT content FROM note_backups WHERE id = 'startup-bk-1'`)); }
check('startup job (PEBLO_ENCRYPT_EXISTING=1) converts plain rows in the background', done, st.out.slice(0, 400));
await sleep(500);
check('startup job logs counts only', /\[encrypt\] done/.test(st.out) && !st.out.includes(LEG), st.out.slice(0, 400));
check('startup job: the converted row reads back through the API', (await call('GET', '/api/notes/startup-plain-1', null, t2, st.base)).json.note?.content === `startup ${LEG}`);
await st.stop();

// ---- key rotation
const rot = await startChild(DB2, { PEBLO_DATA_KEY: KEY_B, PEBLO_DATA_KEY_OLD: KEY_A });
r = await call('GET', `/api/notes/${l1.id}`, null, t2, rot.base);
check('rotation: with the new key and the old one configured, rows under the old key still read', r.status === 200 && r.json.note.content.includes(LEG), r.text.slice(0, 160));
r = await call('POST', '/api/notes', { title: 'Under new key', content: 'rot ' + LEG }, t2, rot.base);
check('rotation: new writes use the new key id', psql(DB2NAME, `SELECT content FROM notes WHERE id = '${r.json.note?.id}'`).startsWith(`enc:v1:${keyId(KEY_B)}:`), r.text.slice(0, 160));
await rot.stop();
const rk = await cli([], { PEBLO_DATA_KEY: KEY_B, PEBLO_DATA_KEY_OLD: KEY_A });
const kb = keyId(KEY_B);
const oldLeft = psql(DB2NAME, `SELECT (SELECT count(*) FROM notes WHERE content LIKE 'enc:v1:%' AND content NOT LIKE 'enc:v1:${kb}:%') + (SELECT count(*) FROM note_backups WHERE content LIKE 'enc:v1:%' AND content NOT LIKE 'enc:v1:${kb}:%') + (SELECT count(*) FROM note_comments WHERE body LIKE 'enc:v1:%' AND body NOT LIKE 'enc:v1:${kb}:%') + (SELECT count(*) FROM note_ydocs WHERE encode(substring(state from 1 for 16),'hex') <> '504542454e433100${Buffer.from(kb).toString('hex')}')`);
check('rotation: the conversion re-keys every row to the new key', rk.code === 0 && num(rk.out, 'notes', 5) >= 3 && oldLeft === '0', rk.out.slice(0, 900) + ' left=' + oldLeft);
const onlyB = await startChild(DB2, { PEBLO_DATA_KEY: KEY_B });
r = await call('GET', `/api/notes/${l1.id}`, null, t2, onlyB.base);
check('rotation: after re-keying, the new key alone reads everything', r.status === 200 && r.json.note.content.includes(LEG) && (await call('GET', `/api/collab/comments/${l1.id}`, null, t2, onlyB.base)).json.comments.length > 0, r.text.slice(0, 160));
await onlyB.stop();
const onlyA = await startChild(DB2, { PEBLO_DATA_KEY: KEY_A });
r = await call('GET', `/api/notes/${l1.id}`, null, t2, onlyA.base);
check('rotation: the retired key alone no longer opens the re-keyed rows (locked, 500)', r.status === 500 && /LOCKED/.test(onlyA.out), r.text.slice(0, 160));
await onlyA.stop();

// ---- clean up
for (const c of children) await c.stop();
try { psql('postgres', `DROP DATABASE IF EXISTS ${DB2NAME}`); } catch (e) { console.log('could not drop ' + DB2NAME + ': ' + String(e.message).slice(0, 100)); }
await finish();

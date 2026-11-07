// The Peblo MCP: contract, privacy (#private never reaches an AI client), approval inbox, retries, duplicates, read-only tokens.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { boot, REPO } from './lib.mjs';
const b = await boot();
const ok = (c, m, x) => b.check(m, !!c, x);
const DIST = path.join(REPO, process.env.PEBLO_SERVER_DIST || 'dist', 'server', 'mcp', 'tools.js');
const { createPebloMcp, explainFailure, MCP_VERSION } = await import(pathToFileURL(DIST).href);
const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js');

async function connect(base, token) {
  const server = createPebloMcp(base, token);
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '1' });
  await Promise.all([server.connect(st), client.connect(ct)]);
  const call = async (name, args = {}) => { const r = await client.callTool({ name, arguments: args }); const text = r.content?.[0]?.text ?? ''; let json; try { json = JSON.parse(text); } catch { json = undefined; } return { ...r, text, json }; };
  return { client, call };
}
try {
  const mk = await b.api('POST', '/api/tokens', { name: 'mcp test' });
  const ro = await b.api('POST', '/api/tokens', { name: 'mcp read', scope: 'read' });
  const { client, call } = await connect(b.base, mk.token);

  // ---------- contract: tools are never removed or renamed, and no new required inputs ----------
  const tools = (await client.listTools()).tools;
  const names = tools.map((t) => t.name).sort();
  const required = Object.fromEntries(tools.map((t) => [t.name, [...(t.inputSchema?.required || [])].sort()]));
  const file = path.join(REPO, 'server', 'src', 'mcp', 'contract.json');
  if (process.env.WRITE_CONTRACT || !fs.existsSync(file)) fs.writeFileSync(file, JSON.stringify({ version: MCP_VERSION, required }, null, 2) + '\n');
  const base = JSON.parse(fs.readFileSync(file, 'utf8'));
  const gone = Object.keys(base.required).filter((n) => !names.includes(n));
  ok(gone.length === 0, 'no tool was removed or renamed since the contract was written', gone.join(', '));
  const widened = Object.entries(base.required).filter(([n, req]) => names.includes(n) && required[n].some((r) => !req.includes(r))).map(([n]) => n);
  ok(widened.length === 0, 'no existing tool gained a required input', widened.join(', '));
  ok(['get_status', 'search_all', 'search_notes', 'create_task'].every((n) => names.includes(n)), 'new tools are listed');
  ok(tools.every((t) => t.description && t.description.length > 20), 'every tool has a real description');

  // ---------- status ----------
  const st = await call('get_status');
  ok(st.json?.version === MCP_VERSION && typeof st.json?.timezone === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(st.json?.today) && st.json?.canWrite === true && st.json?.privateNotesHidden === true, 'get_status: version, time zone, today, canWrite, private hidden', st.text);

  // ---------- #private never reaches the AI client ----------
  const pub = (await b.api('POST', '/api/notes', { title: 'Orbit plan', content: 'orbit public text', tags: ['work'] })).note;
  const priv = (await b.api('POST', '/api/notes', { title: 'Orbit secret diary', content: 'orbit very private words', tags: ['private'] })).note;
  const s1 = await call('search_notes', { query: 'orbit', include_duplicates: true });
  const found = JSON.stringify(s1.json);
  ok(found.includes(pub.id) && !found.includes(priv.id) && !/secret diary/.test(s1.text), 'search_notes hides the #private note');
  const g = await call('get_note', { id: priv.id });
  ok(g.isError && /private/i.test(g.text), 'get_note on a #private note is refused', g.text);
  ok((await call('update_note', { id: priv.id, title: 'x' })).isError, 'update_note on #private is refused');
  ok((await call('append_to_note', { id: priv.id, text: 'x' })).isError, 'append_to_note on #private is refused');
  ok((await call('trash_note', { id: priv.id })).isError, 'trash_note on #private is refused');
  ok((await call('create_share_link', { kind: 'note', id: priv.id })).isError, 'create_share_link on #private is refused');
  ok((await call('get_backlinks', { id: priv.id })).isError, 'get_backlinks on #private is refused');
  const sa = await call('search_all', { query: 'orbit' });
  ok(sa.json && JSON.stringify(sa.json.notes).includes(pub.id) && !JSON.stringify(sa.json).includes(priv.id), 'search_all: grouped, and without the #private note', sa.text.slice(0, 200));
  const tg = await call('list_tags');
  ok(!/"private"/.test(tg.text), 'list_tags does not reveal the private tag');
  const still = (await b.api('GET', `/api/notes/${priv.id}`)).note;
  ok(still && still.title === 'Orbit secret diary' && !still.isDeleted, 'the signed-in person still sees and keeps the #private note');
  const sess = (await b.api('GET', '/api/notes?limit=50')).notes || [];
  ok(sess.some((n) => n.id === priv.id), 'the app list still includes the #private note');
  // a token cannot take the whole library out
  const ex = await fetch(b.base + '/api/export', { headers: { Authorization: `Bearer ${mk.token}` } });
  const bk = await fetch(b.base + '/api/backup', { headers: { Authorization: `Bearer ${mk.token}` } });
  const rs = await fetch(b.base + '/api/restore', { method: 'POST', headers: { Authorization: `Bearer ${mk.token}`, 'Content-Type': 'application/json' }, body: '{}' });
  ok(ex.status === 403 && bk.status === 403 && rs.status === 403, 'an access token cannot export, back up or restore', `${ex.status} ${bk.status} ${rs.status}`);
  const exMe = await fetch(b.base + '/api/export', { headers: { Authorization: `Bearer ${b.token}` } });
  ok(exMe.status === 200, 'the signed-in person can still export', exMe.status);

  // ---------- Plan my day approval ----------
  await b.api('PUT', '/api/profile', { settings: { aiApproval: true } });
  const t1 = await call('create_task', { text: 'Approve me', deadline: new Date(Date.now() + 86400000).toISOString() });
  ok(t1.json?.status && /approve/i.test(t1.json.status), 'with "ask me before Claude adds tasks" on, the MCP task waits for approval', t1.text);
  await b.api('PUT', '/api/profile', { settings: { aiApproval: false } });
  const t2 = await call('create_task', { text: 'No approval needed', deadline: new Date(Date.now() + 86400000).toISOString() });
  ok(t2.json?.id && !t2.json?.status, 'with it off the task is added straight away', t2.text);

  // ---------- duplicates, reminders, travel ----------
  const n1 = await call('create_note', { title: 'Dup check', content: 'same' });
  const n2 = await call('create_note', { title: 'Dup check', content: 'same' });
  const dupCount = ((await b.api('GET', '/api/notes?search=Dup%20check')).notes || []).filter((n) => n.title === 'Dup check').length;
  ok(n1.json?.id && n2.json?.id === n1.json.id && n2.json?.duplicate && dupCount === 1, 'the same create twice in a minute is done once', `${dupCount} ${n2.text}`);
  const ev = await call('create_task', { text: 'Design review', deadline: new Date(Date.now() + 2 * 86400000).toISOString(), startTime: '16:30', endTime: '17:30', reminders: [10, 1440], travelMin: 25 });
  const evRow = ((await b.api('GET', '/api/todos')).todos || []).find((t) => t.id === ev.json?.id);
  ok(JSON.stringify(evRow?.meta?.reminders) === '[10,1440]' && evRow?.meta?.travelMin === 25 && evRow?.meta?.remindMin === 10, 'create_task saves reminders and travel time', JSON.stringify(evRow?.meta));
  await call('update_task', { id: ev.json.id, reminders: [], travelMin: null });
  const evRow2 = ((await b.api('GET', '/api/todos')).todos || []).find((t) => t.id === ev.json?.id);
  ok(!evRow2?.meta?.reminders && !evRow2?.meta?.travelMin, 'update_task clears them');

  // ---------- paging ----------
  for (let i = 0; i < 4; i++) await b.api('POST', '/api/notes', { title: `Page note ${i}`, content: `pagetext ${i}`, tags: [] });
  const p1 = await call('search_notes', { query: 'pagetext', limit: 2 });
  const p2 = await call('search_notes', { query: 'pagetext', limit: 2, offset: p1.json?.nextOffset ?? 2 });
  const ids1 = (p1.json?.notes || []).map((n) => n.id); const ids2 = (p2.json?.notes || p2.json || []).map((n) => n.id);
  ok(p1.json?.nextOffset === 2 && ids1.length === 2 && ids2.length >= 1 && ids2.every((i) => !ids1.includes(i)), 'search_notes pages with offset and nextOffset', p1.text.slice(0, 120));

  // ---------- read-only token ----------
  const r = await connect(b.base, ro.token);
  const w = await r.call('create_note', { title: 'should fail' });
  ok(w.isError && /read-only/i.test(w.text), 'a read-only token cannot write, and says so', w.text);
  const rs2 = await r.call('get_status');
  ok(rs2.json?.canWrite === false && rs2.json?.readOnly === true, 'get_status reports read-only');
  const bad = await connect(b.base, 'pbl_notarealtoken');
  const bt = await bad.call('search_notes', { query: 'x' });
  ok(bt.isError && /Connect/i.test(bt.text), 'a removed token gives a plain "connect again" message', bt.text);

  // ---------- friendly errors ----------
  ok(/rate limiting/.test(explainFailure(429).message) && explainFailure(429).retryable, '429 is explained and retryable');
  ok(/waking up/.test(explainFailure(503).message) && explainFailure(503).retryable, '503 says the server may be waking up');
  ok(!explainFailure(404).retryable && /id/.test(explainFailure(404).message), '404 says to check the id');

  // ---------- retries: a server that fails twice (waking up) then answers ----------
  let hits = 0;
  const fake = http.createServer((req, res) => {
    hits += 1;
    if (hits <= 2) { res.writeHead(503, { 'content-type': 'application/json' }); return res.end('{"error":"warming"}'); }
    res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ timezone: 'Asia/Kolkata', today: '2026-11-07', now: 'x', readOnly: false, viaToken: true }));
  }).listen(0, '127.0.0.1');
  await new Promise((r2) => fake.on('listening', r2));
  const f = await connect(`http://127.0.0.1:${fake.address().port}`, 'pbl_x');
  const fr = await f.call('get_status');
  ok(!fr.isError && fr.json?.timezone === 'Asia/Kolkata' && hits === 3, 'a read is retried while the server wakes up', `${hits} ${fr.text}`);
  let posts = 0;
  const fake2 = http.createServer((req, res) => { if (req.method === 'POST') posts += 1; res.writeHead(503, { 'content-type': 'application/json' }); res.end('{"error":"down"}'); }).listen(0, '127.0.0.1');
  await new Promise((r2) => fake2.on('listening', r2));
  const f2 = await connect(`http://127.0.0.1:${fake2.address().port}`, 'pbl_x');
  const wr = await f2.call('create_note', { title: 'never twice' });
  ok(wr.isError && posts === 1, 'a write is never retried, so nothing is saved twice', `${posts}`);
  fake.close(); fake2.close();
} catch (e) { b.check('no error: ' + (e?.stack || e), false); }
await b.finish();

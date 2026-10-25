// Tests AI connections (migration 015, /api/ai/connections, the provider cascade) against a throwaway local Postgres named peblo_test
// and a fake OpenAI-compatible server on localhost. Usage: npm run build:server && node scripts/connections-test.mjs
import path from 'path';
import http from 'node:http';
import dotenv from 'dotenv';
import { pathToFileURL } from 'url';

dotenv.config({ path: path.resolve('server/.env') });
process.env.DATABASE_URL = process.env.PEBLO_TEST_DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:55432/peblo_test';
if (!/peblo_test/.test(process.env.DATABASE_URL)) { console.error('refusing to run: not peblo_test'); process.exit(1); }
process.env.PEBLO_SQL_DIR = path.resolve('server/prisma/sql');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'smoke-test-secret-smoke-test-secret';
process.env.TRUST_PROXY = '1';
process.env.AI_BURST_MAX = '1000';
process.env.SIGNUP_RATE_MAX = '1000';
delete process.env.OPENAI_API_KEY; delete process.env.GEMINI_API_KEY; delete process.env.GEMINI_API_KEYS; delete process.env.PEBLO_HOSTED;

// A fake "OpenAI-compatible" provider: knows one key, lists two models, answers chat (plain and streamed).
const GOOD = 'fake-good-key-123';
const seen = [];
const fake = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const auth = req.headers.authorization || '';
    seen.push({ url: req.url, auth, body });
    if (auth !== `Bearer ${GOOD}`) { res.writeHead(401, { 'Content-Type': 'application/json' }); return res.end('{"error":"bad key"}'); }
    if (req.url === '/v1/models') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ data: [{ id: 'text-embedding-x' }, { id: 'fake-chat-1' }, { id: 'fake-chat-2' }] })); }
    if (req.url === '/v1/chat/completions') {
      const j = JSON.parse(body || '{}');
      if (j.stream) {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        for (const t of ['Hello ', 'from fake']) res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: t } }] })}\n\n`);
        res.write('data: [DONE]\n\n');
        return res.end();
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ suggested_title: 'Title from ' + j.model }) } }] }));
    }
    res.writeHead(404); res.end();
  });
});
await new Promise((r) => fake.listen(0, '127.0.0.1', r));
const fakeBase = `http://127.0.0.1:${fake.address().port}/v1`;

const { startServer } = await import(pathToFileURL(path.resolve('dist/server/index.js')).href);
const { server, port } = await startServer({ port: 0, staticDir: path.resolve('client/dist') });
const base = `http://127.0.0.1:${port}`;
let token = null; let failures = 0;
const runId = Date.now();
const emailA = `conn-a-${runId}@peblo.test`; const emailB = `conn-b-${runId}@peblo.test`;
async function call(method, url, body) {
  const res = await fetch(base + url, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text(); let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, json, text };
}
function check(name, cond, extra) { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); if (!cond) { failures++; if (extra !== undefined) console.log('      ', JSON.stringify(extra).slice(0, 500)); } }

try {
  let r = await call('GET', '/api/ai/connections');
  check('connections need a sign-in', r.status === 401, r.status);
  r = await call('POST', '/api/auth/signup', { email: emailA, password: 'correct horse battery', name: 'Conn A' });
  token = r.json.token; const tokenA = token;
  r = await call('POST', '/api/auth/signup', { email: emailB, password: 'correct horse battery', name: 'Conn B' });
  const tokenB = r.json.token;
  token = tokenA;

  r = await call('GET', '/api/ai/connections');
  check('starts empty, with the provider list', r.status === 200 && r.json.connections.length === 0 && r.json.providers.some((p) => p.id === 'groq') && r.json.providers.some((p) => p.id === 'custom' && !p.fixedAddress) && r.json.localAddressesAllowed === true, r.json);

  // ---- detecting a pasted key ----
  r = await call('POST', '/api/ai/connections/detect', { key: '' });
  check('detect: an empty key is refused', r.status === 400, r.json);
  r = await call('POST', '/api/ai/connections/detect', { key: 'zzz-not-a-known-shape' });
  check('detect: an unknown key shape asks which provider', r.status === 200 && r.json.ok === false && r.json.needsProvider === true, r.json);
  r = await call('POST', '/api/ai/connections/detect', { key: 'k', provider: 'nope' });
  check('detect: an unknown provider is refused', r.status === 400, r.json);
  r = await call('POST', '/api/ai/connections/detect', { key: 'wrong-key', provider: 'custom', baseUrl: fakeBase });
  check('detect: a wrong key is rejected by the provider', r.status === 200 && r.json.ok === false && /did not accept/i.test(r.json.error), r.json);
  r = await call('POST', '/api/ai/connections/detect', { key: GOOD, provider: 'custom', baseUrl: 'ftp://x' });
  check('detect: a bad address is refused', r.json.ok === false && /http/i.test(r.json.error), r.json);
  r = await call('POST', '/api/ai/connections/detect', { key: GOOD, provider: 'custom', baseUrl: 'http://user:pw@127.0.0.1:1/v1' });
  check('detect: an address with a login in it is refused', r.json.ok === false && /user name/i.test(r.json.error), r.json);
  r = await call('POST', '/api/ai/connections/detect', { key: GOOD, provider: 'custom', baseUrl: fakeBase });
  check('detect: a good key works and lists models', r.json.ok === true && r.json.provider === 'custom' && r.json.models.includes('fake-chat-1') && r.json.suggestedModel === 'fake-chat-1', r.json);

  // ---- saving ----
  r = await call('POST', '/api/ai/connections', { provider: 'custom', baseUrl: fakeBase, key: GOOD });
  check('add: a model is required', r.status === 400, r.json);
  r = await call('POST', '/api/ai/connections', { provider: 'groq', key: '', model: 'x' });
  check('add: a named provider needs a key', r.status === 400, r.json);
  r = await call('POST', '/api/ai/connections', { provider: 'custom', baseUrl: fakeBase, key: GOOD, model: 'fake-chat-1', label: 'Fake one' });
  check('add: a custom connection is saved', r.status === 201 && r.json.connection.label === 'Fake one' && r.json.connection.hasKey === true, r.json);
  check('add: the key is never sent back', !r.text.includes(GOOD), r.text);
  const idOne = r.json.connection?.id;
  r = await call('POST', '/api/ai/connections', { provider: 'custom', baseUrl: fakeBase, key: GOOD, model: 'fake-chat-2' });
  const idTwo = r.json.connection?.id;
  check('add: a second one gets the next place and a default name', r.status === 201 && r.json.connection.position === 1 && r.json.connection.label === '127.0.0.1', r.json);
  r = await call('GET', '/api/ai/connections');
  check('list: both there, key never shown', r.json.connections.length === 2 && !r.text.includes(GOOD), r.json);
  r = await call('GET', '/api/profile');
  check('profile never carries a connection key', !r.text.includes(GOOD));

  // ---- the key is stored encrypted ----
  const { default: prisma } = await import(pathToFileURL(path.resolve('dist/server/db.js')).href);
  const row = await prisma.aiConnection.findUnique({ where: { id: idOne } });
  check('the key is encrypted in the database', row.apiKey?.startsWith('enc:v1:') && !row.apiKey.includes(GOOD), row.apiKey?.slice(0, 12));

  // ---- changing, ordering, other people's connections ----
  r = await call('PATCH', `/api/ai/connections/${idTwo}`, { model: 'fake-chat-2b', enabled: false });
  check('patch: model and on/off change', r.status === 200 && r.json.connection.model === 'fake-chat-2b' && r.json.connection.enabled === false, r.json);
  r = await call('PATCH', `/api/ai/connections/${idTwo}`, { enabled: 'yes' });
  check('patch: bad values are refused', r.status === 400, r.json);
  r = await call('PATCH', `/api/ai/connections/${idTwo}`, { enabled: true });
  r = await call('PUT', '/api/ai/connections/order', { ids: [idTwo, idOne] });
  check('order: can be rearranged', r.status === 200 && r.json.connections[0].id === idTwo && r.json.connections[1].id === idOne, r.json);
  token = tokenB;
  r = await call('PATCH', `/api/ai/connections/${idOne}`, { model: 'hijack' });
  check("another account cannot change my connection", r.status === 404, r.status);
  r = await call('DELETE', `/api/ai/connections/${idOne}`);
  check("another account cannot delete my connection", r.status === 404, r.status);
  r = await call('PUT', '/api/ai/connections/order', { ids: [idOne, idTwo] });
  check("another account's order call changes nothing and shows nothing of mine", r.status === 200 && r.json.connections.length === 0, r.json);
  r = await call('GET', '/api/ai/hub/models');
  check("another account's model list has none of mine", !r.json.cloud.some((c) => String(c.provider).startsWith('conn:')), r.json.cloud);
  token = tokenA;
  check('still there after the other account tried', (await prisma.aiConnection.count({ where: { id: { in: [idOne, idTwo] } } })) === 2);

  // ---- using them: the model picker, the cascade and the AI Hub ----
  r = await call('GET', '/api/ai/hub/models');
  const mine = r.json.cloud.filter((c) => c.provider.startsWith('conn:'));
  check('hub models lists the connections, in order, marked as on this computer', mine.length === 2 && mine[0].provider === `conn:${idTwo}` && mine[0].local === true && mine[0].configured, r.json.cloud);

  r = await call('POST', '/api/notes', { title: 'Cascade note', content: 'Some text to title' });
  const noteId = r.json.note?.id || r.json.id;
  seen.length = 0;
  r = await call('POST', `/api/notes/${noteId}/ai/title`, { content: 'Some text to title' });
  check('AI feature is answered by the first connection', r.status === 200 && r.json.suggested_title === 'Title from fake-chat-2b' && seen.some((s) => s.auth === `Bearer ${GOOD}`), { r: r.json, seen: seen.length });

  await call('PATCH', `/api/ai/connections/${idTwo}`, { enabled: false });
  seen.length = 0;
  r = await call('POST', `/api/notes/${noteId}/ai/title`, { content: 'Some text to title' });
  check('turning one off passes the work to the next', r.json.suggested_title === 'Title from fake-chat-1', r.json);

  const hub = async (body) => (await (await fetch(base + '/api/ai/hub/chat', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body) })).text()).split('\n').filter((l) => l.startsWith('data: ')).map((l) => JSON.parse(l.slice(6)));
  let ev = await hub({ messages: [{ role: 'user', content: 'hi' }] });
  const done = ev.find((e) => e.type === 'done');
  check('AI Hub streams from a connection', ev.filter((e) => e.type === 'delta').map((e) => e.text).join('') === 'Hello from fake' && done?.model === 'fake-chat-1' && done?.local === true, ev);
  ev = await hub({ messages: [{ role: 'user', content: 'hi' }], provider: `conn:${idOne}`, model: 'fake-chat-2' });
  check('AI Hub can be told to use one connection and model', ev.find((e) => e.type === 'done')?.model === 'fake-chat-2', ev);
  ev = await hub({ messages: [{ role: 'user', content: 'hi' }], provider: `conn:${idTwo}` });
  check('AI Hub refuses a connection that is off', ev.some((e) => e.type === 'error'), ev);

  // A connection on this computer is "local": it satisfies "Only on this computer", and a cloud one must not.
  await call('PUT', '/api/profile', { settings: { defaultAiModel: 'ollama' } });
  seen.length = 0;
  r = await call('POST', `/api/notes/${noteId}/ai/title`, { content: 'Some text to title' });
  check('"Only on this computer" still uses a localhost connection', r.status === 200 && r.json.suggested_title === 'Title from fake-chat-1', r.json);
  await call('PUT', '/api/profile', { settings: { defaultAiModel: 'auto' } });

  // A connection whose key was saved by another install cannot be read: it is skipped, not a crash.
  await prisma.aiConnection.update({ where: { id: idOne }, data: { apiKey: 'enc:v1:AAAA:BBBB:CCCC' } });
  r = await call('POST', `/api/notes/${noteId}/ai/title`, { content: 'Some text to title' });
  check('an unreadable key is skipped with a clear message', r.status >= 400 && /No AI set up|failed/i.test(JSON.stringify(r.json)), r.json);
  await prisma.aiConnection.update({ where: { id: idOne }, data: { apiKey: row.apiKey } });

  // ---- removing ----
  r = await call('DELETE', `/api/ai/connections/${idOne}`);
  check('delete works', r.status === 200, r.status);
  r = await call('GET', '/api/ai/connections');
  check('delete: gone from the list', r.json.connections.length === 1 && r.json.connections[0].id === idTwo, r.json);
  // limit
  // (filled straight into the table: the key-check limiter would stop twenty real requests in one minute)
  await prisma.aiConnection.createMany({ data: Array.from({ length: 19 }, (_, i) => ({ userId: row.userId, provider: 'custom', label: 'x' + i, baseUrl: fakeBase, model: 'm', position: 10 + i })) });
  const last = await call('POST', '/api/ai/connections', { provider: 'custom', baseUrl: fakeBase, key: GOOD, model: 'one-too-many' });
  check('at most 20 connections', last.status === 400 && /20/.test(last.json.error), last.json);

  // ---- deleting the account removes its connections ----
  await prisma.user.deleteMany({ where: { email: emailA } });
  check('connections go with the account', (await prisma.aiConnection.count({ where: { userId: row.userId } })) === 0);
} catch (err) {
  failures++; console.error(err);
} finally {
  server.close(); fake.close();
  const { default: prisma } = await import(pathToFileURL(path.resolve('dist/server/db.js')).href);
  try { await prisma.user.deleteMany({ where: { email: { in: [emailA, emailB] } } }); } catch {}
  await prisma.$disconnect();
  console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
  process.exit(failures ? 1 : 0);
}

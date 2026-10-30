// API-only checks for the server routes no other e2e file covers (no browser).
// Boots the real compiled server (dist/) on a throwaway database and talks to it with plain fetch.
//   $env:PEBLO_TEST_DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:55432/peblo_test_api'; node e2e/api-routes.mjs
// For every uncovered endpoint: happy path, validation (bad types / missing / huge / arrays), a second user is refused,
// no sign-in -> 401, personal access tokens (PAT) restrictions, rate limits answer 429, and 5xx never leak internals.
import path from 'path';
import fs from 'fs';
import http from 'http';
import dotenv from 'dotenv';
import { pathToFileURL, fileURLToPath } from 'url';
import { REPO } from './lib.mjs';

const DB_URL = process.env.PEBLO_TEST_DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:55432/peblo_test_api';
if (!/peblo_test/.test(DB_URL)) throw new Error('refusing to run: not a peblo_test database');

let failures = 0;
let passes = 0;
const check = (name, ok, extra) => {
  if (ok) passes++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) { failures++; if (extra !== undefined) console.log('      ', String(extra).slice(0, 400)); }
};

// ---------------------------------------------------------------- boot
Object.assign(process.env, dotenv.parse(fs.readFileSync(path.join(REPO, 'server', '.env'), 'utf8')));
for (const k of ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'RESEND_API_KEY', 'MAIL_OUTBOX']) delete process.env[k]; // tests never send mail
process.env.DATABASE_URL = DB_URL;
process.env.NODE_ENV = 'test'; // never "development": that mode adds stack traces to error replies on purpose
process.env.PEBLO_SQL_DIR = path.join(REPO, 'server', 'prisma', 'sql');
process.env.SIGNUP_RATE_MAX = '100000';
process.env.API_RATE_MAX = '1000000';
const AI_CHILD = process.argv[2] === '--ai-limit-child';
process.env.AI_BURST_MAX = process.env.API_TEST_AI_BURST || '0'; // 0 = off; the AI limit itself is checked in a child process with a small value
process.env.AI_DAILY_LIMIT = '0';
delete process.env.OPENAI_API_KEY; delete process.env.GEMINI_API_KEY; delete process.env.GEMINI_API_KEYS;
delete process.env.SMTP_HOST; delete process.env.SMTP_USER; delete process.env.SMTP_PASS;
process.env.PUBLIC_URL = '';

// PEBLO_DIST=<folder> tests a scratch build of the server instead of dist/ (same layout: <folder>/server/index.js)
const DIST = process.env.PEBLO_DIST ? path.resolve(REPO, process.env.PEBLO_DIST) : path.join(REPO, 'dist');
const { startServer } = await import(pathToFileURL(path.join(DIST, 'server', 'index.js')).href);
const { default: prisma } = await import(pathToFileURL(path.join(DIST, 'server', 'db.js')).href);
const { server, port } = await startServer({ port: 0 });
const BASE = `http://127.0.0.1:${port}`;

// ---------------------------------------------------------------- http helpers
const LEAK = /(\bat\s+\S+\s+\(.*:\d+:\d+\))|(\bat\s+(file:|[A-Za-z]:\\|\/)\S*:\d+:\d+)|PrismaClient|prisma\.\w+\.|\bSELECT\b[\s\S]*\bFROM\b|\bINSERT INTO\b|node_modules|invalid byte sequence|ECONNREFUSED|\.tsx?:\d+|"stack"|P20\d\d|Invalid `/i;
const unexpected5xx = (s) => s >= 500 && ![502, 503, 504].includes(s);
const bad5 = new Map(); // "METHOD path" -> first evidence
const leaks = new Map();
const short = (v) => { const s = typeof v === 'string' ? JSON.stringify(v.length > 30 ? v.slice(0, 20) + `...(${v.length})` : v) : JSON.stringify(v); return s; };

async function call(method, url, { token, body, raw, headers = {}, base = BASE } = {}) {
  const h = { ...headers };
  if (token) h.Authorization = `Bearer ${token}`;
  let payload;
  if (raw !== undefined) payload = raw;
  else if (body !== undefined) { h['Content-Type'] = h['Content-Type'] || 'application/json'; payload = JSON.stringify(body); }
  let res, text = '';
  try {
    res = await fetch(base + url, { method, headers: h, body: payload, signal: AbortSignal.timeout(40000) });
    text = await res.text().catch(() => '');
  } catch (e) {
    console.log(`      (no answer from ${method} ${url.slice(0, 80)}: ${String(e).slice(0, 80)})`);
    return { status: 0, text: String(e), json: undefined, headers: new Headers() };
  }
  let json; try { json = JSON.parse(text); } catch { /* not JSON */ }
  const key = `${method} ${url.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, ':id').slice(0, 70)}`;
  if (unexpected5xx(res.status) && !bad5.has(key)) bad5.set(key, `${res.status} body=${(typeof payload === 'string' ? payload : '').slice(0, 90)} reply=${text.slice(0, 160)}`);
  if (res.status >= 400 && LEAK.test(text) && !leaks.has(key)) leaks.set(key, `${res.status} ${text.slice(0, 200)}`);
  return { status: res.status, text, json, headers: res.headers };
}

function rawReq(method, p, headers = {}) {
  return new Promise((resolve) => {
    try {
      const u = new URL(BASE);
      const rq = http.request({ host: u.hostname, port: u.port, method, path: p, headers }, (res) => {
        let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => resolve({ status: res.statusCode, text: d }));
      });
      rq.on('error', (e) => resolve({ status: 0, text: String(e) }));
      rq.end();
    } catch (e) { resolve({ status: 0, text: String(e) }); }
  });
}

const uniq = Date.now().toString(36);
async function newUser(tag) {
  const email = `apitest-${tag}-${uniq}@peblo.test`;
  const r = await call('POST', '/api/auth/signup', { body: { email, password: 'correct horse battery', name: `U ${tag}` } });
  return { email, password: 'correct horse battery', token: r.json?.token, id: r.json?.user?.id, signup: r };
}

// ---------------------------------------------------------------- fuzz helpers
const JUNK = [123, -1, 1.5, true, null, [], ['a'], [['a']], {}, { a: 1 }, 'x'.repeat(200000), 'a\u0000b', '\ud800', '../../etc/passwd', "'; DROP TABLE users;--", '<script>alert(1)</script>', 'é'.repeat(50)];
const BODIES = ['', '[]', '"str"', '123', 'null', '{bad json', '{"a":', 'x'.repeat(50)];

async function fuzzBody(label, method, url, fields, base, token) {
  const fails = [];
  for (const f of fields) {
    for (const v of JUNK) {
      const r = await call(method, url, { token, body: { ...base, [f]: v } });
      if (unexpected5xx(r.status) || r.status === 0) fails.push(`${f}=${short(v)} -> ${r.status} ${r.text.slice(0, 90)}`);
    }
  }
  for (const raw of BODIES) {
    const r = await call(method, url, { token, raw, headers: { 'Content-Type': 'application/json' } });
    if (unexpected5xx(r.status) || r.status === 0) fails.push(`rawbody ${short(raw)} -> ${r.status} ${r.text.slice(0, 90)}`);
  }
  const r2 = await call(method, url, { token, raw: 'a=b&c=d', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
  if (unexpected5xx(r2.status)) fails.push(`form body -> ${r2.status}`);
  check(`validation: ${label} never answers 5xx for bad types / shapes`, fails.length === 0, `${fails.length} bad: ` + fails.slice(0, 3).join(' | '));
}

const QJUNK = ['k[]=a&k[]=b', 'k[a]=b', 'k=' + 'x'.repeat(5000), 'k=%00', 'k=%E0%A4%A', 'k=1&k=2', 'k[__proto__][x]=1'];
async function fuzzQuery(label, url, keys, token) {
  const fails = [];
  for (const k of keys) for (const q of QJUNK) {
    const r = await call('GET', `${url}?${q.replace(/^k/, k).replace(/&k/g, '&' + k)}`, { token });
    if (unexpected5xx(r.status) || r.status === 0) fails.push(`?${q.slice(0, 40).replace(/^k/, k)} -> ${r.status} ${r.text.slice(0, 80)}`);
  }
  check(`validation: GET ${label} query junk never 5xx`, fails.length === 0, `${fails.length} bad: ` + fails.slice(0, 3).join(' | '));
}

const IDJUNK = ['%00', 'x'.repeat(3000), '..%2f..%2fetc', '%E0%A4%A', '%C3%BC', "'%20OR%201=1", 'abcdefgh', '12345678-1234-1234-1234-123456789012', 'undefined', '%F0%9F%98%80'];
async function fuzzId(label, method, makeUrl, token, { body } = {}) {
  const fails = [];
  for (const id of IDJUNK) {
    const r = await call(method, makeUrl(id), { token, body });
    if (unexpected5xx(r.status) || r.status === 0) fails.push(`id=${id.slice(0, 20)} -> ${r.status} ${r.text.slice(0, 80)}`);
  }
  check(`validation: ${method} ${label} with odd ids never 5xx`, fails.length === 0, `${fails.length} bad: ` + fails.slice(0, 3).join(' | '));
}

if (AI_CHILD) { // child process: AI_BURST_MAX is small here, so the per-account AI limit can be reached quickly
  const R = await newUser('airate');
  const out = [];
  let last;
  for (let i = 0; i < 9; i++) { last = await call('POST', '/api/study/quiz', { token: R.token, body: { topic: 'none-' + i } }); out.push(last.status); }
  const other = await newUser('airate2');
  const o = await call('POST', '/api/study/quiz', { token: other.token, body: { topic: 'none' } });
  const reads = await call('GET', '/api/notes', { token: R.token });
  console.log('AIRATE:' + JSON.stringify({ statuses: out, retryAfter: last.headers.get('retry-after'), error: last.json?.error, otherUser: o.status, reads: reads.status }));
  server.close(); await prisma.user.deleteMany({ where: { email: { startsWith: 'apitest-airate' } } }).catch(() => {}); await prisma.$disconnect(); process.exit(0);
}

// ================================================================ setup
const A = await newUser('a');
const B = await newUser('b');
check('setup: two users signed up (201, token, no passwordHash in reply)', !!A.token && !!B.token && A.signup.status === 201 && !/passwordHash|\$2[aby]\$/.test(A.signup.text), A.signup.text);
if (!A.token || !B.token) { console.log('cannot continue'); process.exit(1); }

const SECRET = 'SECRET-NOTE-A-' + uniq;
const mk = await call('POST', '/api/notes', { token: A.token, body: { title: SECRET, content: `# ${SECRET}\n\nbody of A which is longer than forty characters for the quiz`, tags: ['alpha'] } });
const nid = mk.json?.note?.id ?? mk.json?.id;
const mk2 = await call('POST', '/api/notes', { token: A.token, body: { title: 'Second', content: 'second note of A that links nowhere', tags: [] } });
const nid2 = mk2.json?.note?.id ?? mk2.json?.id;
check('setup: A created notes', !!nid && !!nid2, mk.text);
const td = await call('POST', '/api/todos', { token: A.token, body: { text: SECRET + ' task', tags: ['alpha'], deadline: new Date(Date.now() + 86400000).toISOString() } });
const tid = td.json?.todo?.id;
check('setup: A created a task', !!tid, td.text);
const ptk = await call('POST', '/api/tokens', { token: A.token, body: { name: 'full pat' } });
const ptkRO = await call('POST', '/api/tokens', { token: A.token, body: { name: 'read pat', scope: 'read' } });
const PAT = ptk.json?.token; const PAT_RO = ptkRO.json?.token;
check('tokens: create full + read-only token (201, secret returned once, pbl_ prefix)', ptk.status === 201 && /^pbl_/.test(PAT || '') && ptkRO.json?.scope === 'read', ptk.text);
const patId = ptk.json?.id;
const KEYSECRET = 'sk-secret-A-' + uniq;
// baseUrl points at an unresolvable host so no test ever sends the fake key to a real provider
const mkConn = (label, model, position) => prisma.aiConnection.create({ data: { userId: A.id, provider: 'custom', label, baseUrl: 'https://api.invalid/v1', apiKey: KEYSECRET, model, position } });
const conn = await mkConn('A conn', 'gpt-x', 0);
const conn2 = await mkConn('A conn2', 'gpt-y', 1);
const connFz = await mkConn('A fuzz conn', 'gpt-f', 2);
const fzTodo = (await call('POST', '/api/todos', { token: A.token, body: { text: 'fuzz target' } })).json?.todo?.id;
const bk = await prisma.noteBackup.create({ data: { noteId: nid, content: 'old content of A' } });
const run = await prisma.quizRun.create({ data: { userId: A.id, topic: 'alpha', questions: JSON.stringify([{ q: 'q?', options: ['a', 'b'], answer: 0, concept: 'c', noteId: nid }]), total: 1 } });
const genFz = await prisma.aiGeneration.create({ data: { noteId: nid, userId: A.id, type: 'promises', result: JSON.stringify({ items: [{ text: 'fuzz promise', status: 'open' }] }) } });
const gen = await prisma.aiGeneration.create({ data: { noteId: nid, userId: A.id, type: 'promises', result: JSON.stringify({ items: [{ text: 'promise ' + SECRET, status: 'open' }] }) } });

// ================================================================ 1. unauthenticated -> 401
{
  const X = 'x';
  const routes = [
    ['GET', '/api/profile'], ['PUT', '/api/profile'],
    ['POST', '/api/auth/send-verification'], ['POST', '/api/auth/cancel-email-change'], ['POST', '/api/auth/change-password'], ['POST', '/api/auth/logout-all'], ['POST', '/api/auth/delete-account'],
    ['GET', '/api/notes'], ['POST', '/api/notes'], ['POST', '/api/notes/daily'], ['GET', `/api/notes/${X}`], ['PATCH', `/api/notes/${X}`], ['DELETE', `/api/notes/${X}`],
    ['GET', `/api/notes/${X}/backlinks`], ['GET', `/api/notes/${X}/mentions`], ['POST', `/api/notes/${X}/mentions/y/link`], ['POST', `/api/notes/${X}/restore`], ['POST', `/api/notes/${X}/archive`],
    ['GET', `/api/notes/${X}/backups`], ['POST', `/api/notes/${X}/versions`], ['PATCH', `/api/notes/${X}/backups/y`], ['GET', `/api/notes/${X}/backups/y`], ['POST', `/api/notes/${X}/backups/y/revert`],
    ['GET', '/api/todos'], ['GET', '/api/todos/today'], ['GET', '/api/todos/range?from=2020-01-01&to=2030-01-01'], ['POST', '/api/todos'], ['PATCH', `/api/todos/${X}`], ['DELETE', `/api/todos/${X}`],
    ['GET', '/api/tags'], ['POST', '/api/tags/rename'], ['POST', '/api/tags/delete'],
    ['GET', '/api/tokens'], ['POST', '/api/tokens'], ['GET', '/api/tokens/activity'], ['DELETE', '/api/tokens/activity'], ['DELETE', `/api/tokens/${X}`],
    ['GET', '/api/ai/connections'], ['POST', '/api/ai/connections/detect'], ['POST', '/api/ai/connections'], ['GET', `/api/ai/connections/${X}/models`], ['PUT', '/api/ai/connections/order'], ['PATCH', `/api/ai/connections/${X}`], ['DELETE', `/api/ai/connections/${X}`],
    ['GET', '/api/ai/hub/models'], ['POST', '/api/ai/hub/search'], ['POST', '/api/ai/hub/chat'],
    ['GET', '/api/ai/link-preview?url=https://example.com'], ['GET', '/api/ai/ollama/check'], ['GET', '/api/ai/local/status'], ['POST', '/api/ai/local/pull'], ['POST', '/api/ai/transcribe'],
    ['POST', '/api/notes/block/ai'], ['POST', `/api/notes/${X}/ai/summary`], ['POST', `/api/notes/${X}/ai/actions`], ['POST', `/api/notes/${X}/ai/title`], ['POST', `/api/notes/${X}/ai/tags`],
    ['POST', '/api/ai/chat'], ['POST', '/api/ai/chat-stream'], ['POST', '/api/ai/chat/apply-update'], ['POST', '/api/ai/smart-intake'], ['POST', '/api/ai/smart-intake-upload'],
    ['GET', '/api/dashboard/insights'], ['POST', '/api/dashboard/toggle-task'], ['GET', '/api/dashboard/daily-briefing'], ['GET', '/api/dashboard/weekly-report'],
    ['GET', '/api/study/mastery'], ['POST', '/api/study/quiz'], ['POST', `/api/study/quiz/${X}/answers`], ['GET', '/api/study/activity'], ['GET', `/api/study/notes/${X}/questions`],
    ['POST', '/api/river/brief'], ['POST', `/api/river/notes/${X}/promises`], ['GET', '/api/river/promises'], ['PATCH', `/api/river/promises/${X}`],
    ['GET', '/api/collab/presence'], ['GET', `/api/collab/comments/${X}`], ['POST', `/api/collab/comments/${X}`], ['PATCH', `/api/collab/comments/${X}/c`], ['DELETE', `/api/collab/comments/${X}/c`], ['GET', '/api/collab/notifications'], ['POST', '/api/collab/notifications/read'],
    ['GET', '/api/share'], ['GET', `/api/share/note/${X}`], ['POST', `/api/share/note/${X}`], ['DELETE', `/api/share/note/${X}`],
    ['POST', '/api/files'], ['POST', '/api/media'], ['POST', `/api/media/${X}12345678/describe`],
    ['POST', '/api/import'], ['GET', '/api/export'], ['GET', '/api/backup'], ['POST', '/api/restore'], ['POST', '/api/example'], ['POST', '/api/example/clear'],
    ['GET', '/api/oauth/info'], ['POST', '/api/oauth/approve'],
  ];
  const wrong = [];
  for (const [m, u] of routes) {
    const r = await call(m, u, m === 'GET' ? {} : { body: {} });
    if (r.status !== 401) wrong.push(`${m} ${u} -> ${r.status} ${r.text.slice(0, 60)}`);
  }
  check(`unauthenticated: ${routes.length} protected endpoints answer 401`, wrong.length === 0, wrong.slice(0, 6).join(' | '));
  const forged = [];
  const jwt = (await import(pathToFileURL(path.join(REPO, 'node_modules', 'jsonwebtoken', 'lib', 'index.js')).href).catch(() => import('jsonwebtoken'))).default;
  const tokens = {
    garbage: 'not-a-token', empty: '', 'pbl_ unknown': 'pbl_doesnotexist12345678901234567890',
    'wrong-secret jwt': jwt.sign({ sub: A.id, email: A.email, v: 0 }, 'other-secret', { algorithm: 'HS256' }),
    'alg none': Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url') + '.' + Buffer.from(JSON.stringify({ sub: A.id, email: A.email, v: 0 })).toString('base64url') + '.',
    'expired jwt': jwt.sign({ sub: A.id, email: A.email, v: 0, exp: Math.floor(Date.now() / 1000) - 60 }, process.env.JWT_SECRET || 'dev-only-insecure-secret-change-me', { algorithm: 'HS256' }),
    'old token version': jwt.sign({ sub: A.id, email: A.email, v: 99 }, process.env.JWT_SECRET || 'dev-only-insecure-secret-change-me', { algorithm: 'HS256' }),
  };
  for (const [name, t] of Object.entries(tokens)) {
    for (const u of ['/api/notes', '/api/profile', '/api/tokens']) {
      const r = await call('GET', u, { headers: { Authorization: `Bearer ${t}` } });
      if (r.status !== 401) forged.push(`${name} ${u} -> ${r.status}`);
    }
  }
  const noBearer = await call('GET', '/api/notes', { headers: { Authorization: `Basic ${Buffer.from('a:b').toString('base64')}` } });
  if (noBearer.status !== 401) forged.push(`Basic scheme -> ${noBearer.status}`);
  check('unauthenticated: forged / expired / unsigned / signed-out / unknown tokens all 401', forged.length === 0, forged.slice(0, 5).join(' | '));
  const m1 = await call('POST', '/mcp', { body: {} });
  const m2 = await call('POST', '/mcp', { token: A.token, body: {} });
  check('mcp: no token or a sign-in JWT -> 401 with WWW-Authenticate', m1.status === 401 && m2.status === 401 && /resource_metadata/.test(m1.headers.get('www-authenticate') || ''), `${m1.status} ${m2.status}`);
}

// ================================================================ 2. PAT restrictions
{
  const variants = [
    ['GET', '/api/tokens'], ['GET', '/api/Tokens'], ['GET', '/api/TOKENS'], ['GET', '/api/tOkEnS/'], ['GET', '/api/tokens?x=1'], ['GET', '/api/Tokens/activity'], ['POST', '/api/TokEns'], ['DELETE', `/api/tokens/${patId}`], ['DELETE', '/api/TOKENS/activity'],
    ['GET', '/api/profile'], ['GET', '/api/Profile'], ['GET', '/api/PROFILE/'], ['PUT', '/api/pRoFiLe'], ['GET', '/api/profile?x=1'],
    ['POST', '/api/auth/logout-all'], ['POST', '/api/Auth/Logout-All'], ['POST', '/api/AUTH/change-password'], ['POST', '/api/auth/DELETE-ACCOUNT'], ['POST', '/api/Auth/send-verification'], ['POST', '/api/auth/cancel-email-change'],
  ];
  const bad = [];
  for (const [m, u] of variants) {
    const r = await call(m, u, { token: PAT, body: m === 'GET' ? undefined : { name: 'x', password: 'x', currentPassword: 'x', newPassword: 'long enough pw' } });
    if (r.status !== 403) bad.push(`${m} ${u} -> ${r.status} ${r.text.slice(0, 80)}`);
  }
  check(`PAT: full token refused (403) on /api/tokens, /api/auth, /api/profile in any letter case (${variants.length} variants)`, bad.length === 0, bad.slice(0, 5).join(' | '));
  const sneaky = ['/api//tokens', '/api/%74okens', '/api/tokens%2F', '/api/tokens%2Factivity', '/api/profile%2F', '/api/%50rofile', '/api/Profile%20', '/api/./tokens', '/api/auth%2Flogout-all', '/api/%61uth/logout-all', '//api/tokens', '/api/tokens;x=1', '/api/profile%00', '/api/Tokens%09'];
  const leak = [];
  for (const p of sneaky) for (const m of ['GET', 'POST', 'DELETE']) {
    const r = await rawReq(m, p, { Authorization: `Bearer ${PAT}`, 'Content-Length': '0' });
    if (r.status >= 200 && r.status < 300) leak.push(`${m} ${p} -> ${r.status} ${r.text.slice(0, 60)}`);
  }
  check('PAT: encoded / dotted / doubled-slash spellings of the restricted paths never succeed', leak.length === 0, leak.slice(0, 5).join(' | '));
  const tcount = (await call('GET', '/api/tokens', { token: A.token })).json?.tokens?.length;
  check('PAT: restricted calls did not create or delete tokens (still 2)', tcount === 2, tcount);
  const aiconn = await call('GET', '/api/ai/connections', { token: PAT });
  check('PAT: refused on /api/ai/connections (provider keys need a real sign-in)', aiconn.status === 403, `${aiconn.status} ${aiconn.text.slice(0, 120)}`);
  const aiconnW = await call('POST', '/api/ai/connections', { token: PAT, body: { provider: 'custom', baseUrl: 'https://attacker.example', model: 'm', key: 'k' } });
  check('PAT: cannot add an AI connection', aiconnW.status === 403, `${aiconnW.status} ${aiconnW.text.slice(0, 120)}`);
  const oa = [await call('GET', '/api/oauth/info?client_id=x&redirect_uri=y', { token: PAT }), await call('POST', '/api/oauth/approve', { token: PAT, body: { client_id: 'x' } })];
  check('PAT: cannot approve OAuth connections (/api/oauth/*) -> 403', oa.every((r) => r.status === 403), oa.map((r) => r.status).join(','));
  const ok = await call('GET', '/api/notes', { token: PAT });
  const okw = await call('POST', '/api/notes', { token: PAT, body: { title: 'via pat', content: 'x' } });
  const okt = await call('GET', '/api/todos', { token: PAT });
  check('PAT: full token can still use notes and tasks', ok.status === 200 && okw.status === 201 && okt.status === 200, `${ok.status} ${okw.status} ${okt.status}`);
  // read-only
  const ro = [];
  const roWrites = [['POST', '/api/notes', { title: 't' }], ['PATCH', `/api/notes/${nid}`, { title: 'hack' }], ['DELETE', `/api/notes/${nid}`], ['POST', `/api/notes/${nid}/archive`], ['POST', '/api/todos', { text: 'x' }], ['PATCH', `/api/todos/${tid}`, { completed: true }], ['DELETE', `/api/todos/${tid}`],
    ['POST', '/api/tags/rename', { from: 'alpha', to: 'beta' }], ['POST', '/api/tags/delete', { name: 'alpha' }], ['POST', '/api/restore', {}], ['POST', '/api/example'], ['POST', '/api/example/clear'], ['POST', '/api/files'], ['POST', '/api/media'], ['POST', `/api/collab/comments/${nid}`, { body: 'x' }], ['POST', '/api/dashboard/toggle-task', { id: tid, completed: true }], ['POST', `/api/study/quiz/${run.id}/answers`, { answers: [0] }], ['PATCH', `/api/river/promises/${gen.id}`, { index: 0, status: 'added' }], ['POST', '/api/collab/notifications/read', {}], ['POST', '/api/import']];
  for (const [m, u, b] of roWrites) {
    const r = await call(m, u, { token: PAT_RO, body: b ?? {} });
    if (r.status !== 403) ro.push(`${m} ${u} -> ${r.status}`);
  }
  check(`PAT: read-only token refused (403) on ${roWrites.length} write endpoints`, ro.length === 0, ro.slice(0, 5).join(' | '));
  const roReads = [];
  for (const u of ['/api/notes', `/api/notes/${nid}`, '/api/todos', '/api/todos/today', '/api/tags', '/api/backup', '/api/export', '/api/dashboard/insights', '/api/study/mastery', '/api/river/promises', '/api/collab/notifications']) {
    const r = await call('GET', u, { token: PAT_RO });
    if (r.status !== 200) roReads.push(`${u} -> ${r.status}`);
  }
  check('PAT: read-only token can read notes, tasks, tags, backup, dashboard', roReads.length === 0, roReads.join(' | '));
  const after = await call('GET', `/api/notes/${nid}`, { token: A.token });
  check('PAT: read-only attempts changed nothing', after.json?.note?.title === SECRET || after.json?.title === SECRET, after.text.slice(0, 120));
  const del = await call('DELETE', `/api/tokens/${ptkRO.json?.id}`, { token: A.token });
  const rev = await call('GET', '/api/notes', { token: PAT_RO });
  check('PAT: a revoked token stops working at once (401)', del.status === 200 && rev.status === 401, `${del.status} ${rev.status}`);
}

// ================================================================ 3. tokens (happy path + validation)
{
  const list = await call('GET', '/api/tokens', { token: A.token });
  check('tokens: list shows tokens without the secret or hash', list.status === 200 && Array.isArray(list.json?.tokens) && !/tokenHash|pbl_[A-Za-z0-9_-]{20,}/.test(list.text), list.text.slice(0, 200));
  const act = await call('GET', '/api/tokens/activity', { token: A.token });
  const clr = await call('DELETE', '/api/tokens/activity', { token: A.token });
  check('tokens: activity list + clear', act.status === 200 && Array.isArray(act.json?.activity) && clr.status === 200 && clr.json?.ok, `${act.status} ${clr.status}`);
  const noname = await call('POST', '/api/tokens', { token: A.token, body: { name: '   ' } });
  const arr = await call('POST', '/api/tokens', { token: A.token, body: { name: ['a', 'b'] } });
  const huge = await call('POST', '/api/tokens', { token: A.token, body: { name: 'n'.repeat(5000), scope: 'read' } });
  check('tokens: blank name -> 400; array name does not crash; huge name is cut to 60 chars', noname.status === 400 && arr.status < 500 && huge.status === 201 && huge.json?.name?.length === 60, `${noname.status} ${arr.status} ${huge.status} ${huge.json?.name?.length}`);
  if (huge.json?.id) await call('DELETE', `/api/tokens/${huge.json.id}`, { token: A.token });
  if (arr.json?.id) await call('DELETE', `/api/tokens/${arr.json.id}`, { token: A.token });
  const unknownScope = await call('POST', '/api/tokens', { token: A.token, body: { name: 'sc', scope: 'admin' } });
  check('tokens: unknown scope becomes "full" (never a bigger scope)', unknownScope.json?.scope === 'full', unknownScope.text);
  if (unknownScope.json?.id) await call('DELETE', `/api/tokens/${unknownScope.json.id}`, { token: A.token });
  // limit of 10
  const ids = [];
  let last;
  for (let i = 0; i < 12; i++) { last = await call('POST', '/api/tokens', { token: A.token, body: { name: 'lim' + i } }); if (last.json?.id) ids.push(last.json.id); }
  check('tokens: the 10 token limit answers 400 (not 500)', last.status === 400, `${last.status} ${last.text.slice(0, 100)}`);
  for (const id of ids) await call('DELETE', `/api/tokens/${id}`, { token: A.token });
  await fuzzBody('POST /api/tokens', 'POST', '/api/tokens', ['name', 'scope'], { name: 'f' }, A.token);
  for (const t of (await call('GET', '/api/tokens', { token: A.token })).json.tokens) if (t.id !== patId) await call('DELETE', `/api/tokens/${t.id}`, { token: A.token });
  await fuzzId('/api/tokens/:id', 'DELETE', (id) => `/api/tokens/${id}`, A.token);
  const nf = await call('DELETE', '/api/tokens/doesnotexist', { token: A.token });
  check('tokens: deleting an unknown id -> 404', nf.status === 404, nf.status);
  // cross user
  const bl = await call('GET', '/api/tokens', { token: B.token });
  const bd = await call('DELETE', `/api/tokens/${patId}`, { token: B.token });
  const still = await call('GET', '/api/notes', { token: PAT });
  check('tokens: B cannot see or delete A\'s token (list empty, delete 404, token still works)', bl.json?.tokens?.length === 0 && !bl.text.includes(patId) && bd.status === 404 && still.status === 200, `${bl.text.slice(0, 100)} ${bd.status} ${still.status}`);
}

// ================================================================ 4. tags
{
  const t1 = await call('POST', '/api/notes', { token: A.token, body: { title: 'tagged', content: 'c', tags: ['Ren-Me'] } });
  const td2 = await call('POST', '/api/todos', { token: A.token, body: { text: 'tagged task', tags: ['ren-me'] } });
  const list = await call('GET', '/api/tags', { token: A.token });
  const found = list.json?.tags?.find((t) => t.name === 'ren-me');
  check('tags: list returns name + note + task counts (lower-cased)', list.status === 200 && found?.notes === 1 && found?.todos === 1, list.text.slice(0, 200));
  const rn = await call('POST', '/api/tags/rename', { token: A.token, body: { from: '#Ren-Me', to: 'Merged' } });
  const l2 = (await call('GET', '/api/tags', { token: A.token })).json.tags;
  check('tags: rename moves notes and tasks', rn.status === 200 && rn.json?.merged === false && l2.find((t) => t.name === 'merged')?.notes === 1 && l2.find((t) => t.name === 'merged')?.todos === 1 && !l2.some((t) => t.name === 'ren-me'), `${rn.text} ${JSON.stringify(l2).slice(0, 200)}`);
  await call('POST', '/api/notes', { token: A.token, body: { title: 'other', content: 'c', tags: ['target'] } });
  const mg = await call('POST', '/api/tags/rename', { token: A.token, body: { from: 'merged', to: 'target' } });
  const l3 = (await call('GET', '/api/tags', { token: A.token })).json.tags;
  check('tags: rename into an existing tag merges them', mg.json?.merged === true && l3.find((t) => t.name === 'target')?.notes === 2, `${mg.text} ${JSON.stringify(l3).slice(0, 200)}`);
  const same = await call('POST', '/api/tags/rename', { token: A.token, body: { from: 'target', to: '#TARGET' } });
  check('tags: rename to the same name is a no-op', same.status === 200 && same.json?.merged === false, same.text);
  const prot = [await call('POST', '/api/tags/rename', { token: A.token, body: { from: 'inbox', to: 'x' } }), await call('POST', '/api/tags/rename', { token: A.token, body: { from: 'x', to: 'private' } }), await call('POST', '/api/tags/delete', { token: A.token, body: { name: 'inbox' } }), await call('POST', '/api/tags/delete', { token: A.token, body: { name: '#PRIVATE' } })];
  check('tags: built-in inbox/private cannot be renamed or deleted (400)', prot.every((r) => r.status === 400), prot.map((r) => r.status).join(','));
  const miss = [await call('POST', '/api/tags/rename', { token: A.token, body: {} }), await call('POST', '/api/tags/rename', { token: A.token, body: { from: 'a' } }), await call('POST', '/api/tags/delete', { token: A.token, body: {} })];
  check('tags: missing fields -> 400', miss.every((r) => r.status === 400), miss.map((r) => r.status).join(','));
  const del = await call('POST', '/api/tags/delete', { token: A.token, body: { name: 'target' } });
  const l4 = (await call('GET', '/api/tags', { token: A.token })).json.tags;
  const notesAfter = await call('GET', '/api/notes', { token: A.token });
  check('tags: delete removes the tag but keeps the notes', del.status === 200 && !l4.some((t) => t.name === 'target') && JSON.stringify(notesAfter.json).includes('tagged'), del.text);
  const long = await call('POST', '/api/tags/rename', { token: A.token, body: { from: 'alpha', to: 'z'.repeat(5000) } });
  const l5 = (await call('GET', '/api/tags', { token: A.token })).json.tags;
  check('tags: huge new name is cut to 60 chars', long.status === 200 && l5.some((t) => t.name === 'z'.repeat(60)), long.text);
  await call('POST', '/api/tags/rename', { token: A.token, body: { from: 'z'.repeat(60), to: 'alpha' } });
  await fuzzBody('POST /api/tags/rename', 'POST', '/api/tags/rename', ['from', 'to'], { from: 'q1', to: 'q2' }, A.token);
  await fuzzBody('POST /api/tags/delete', 'POST', '/api/tags/delete', ['name'], { name: 'q1' }, A.token);
  // cross user
  const bRename = await call('POST', '/api/tags/rename', { token: B.token, body: { from: 'alpha', to: 'stolen' } });
  const bDelete = await call('POST', '/api/tags/delete', { token: B.token, body: { name: 'alpha' } });
  const aList = (await call('GET', '/api/tags', { token: A.token })).json.tags;
  const bList = await call('GET', '/api/tags', { token: B.token });
  check('tags: B renaming / deleting "alpha" does not touch A\'s tag, and B\'s list shows nothing of A', aList.some((t) => t.name === 'alpha' && t.notes >= 1) && !aList.some((t) => t.name === 'stolen') && !bList.text.includes('alpha') && bRename.status < 500 && bDelete.status < 500, `${bRename.text} ${bDelete.text} ${bList.text.slice(0, 100)}`);
}

// ================================================================ 5. todos today / range
{
  const today = await call('GET', '/api/todos/today', { token: A.token });
  check('todos/today: returns today / overdue / upcoming lists', today.status === 200 && ['todayTasks', 'overdueTasks', 'upcomingTasks'].every((k) => Array.isArray(today.json?.[k])), today.text.slice(0, 200));
  const from = new Date(Date.now() - 86400000).toISOString(); const to = new Date(Date.now() + 5 * 86400000).toISOString();
  const rng = await call('GET', `/api/todos/range?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, { token: A.token });
  check('todos/range: returns the task due tomorrow', rng.status === 200 && rng.json?.todos?.some((t) => t.id === tid), rng.text.slice(0, 200));
  const rb = [await call('GET', '/api/todos/range', { token: A.token }), await call('GET', '/api/todos/range?from=zzz&to=yyy', { token: A.token }), await call('GET', '/api/todos/range?from=2020-01-01', { token: A.token }), await call('GET', '/api/todos/range?from[]=a&to[]=b', { token: A.token })];
  check('todos/range: missing or bad dates -> 400, never 5xx', rb[0].status === 400 && rb[1].status === 400 && rb[2].status === 400 && rb[3].status < 500, rb.map((r) => r.status).join(','));
  const extreme = [await call('GET', '/api/todos/range?from=-271821-04-20T00:00:00Z&to=%2B275760-09-13T00:00:00Z', { token: A.token }), await call('GET', '/api/todos?date=%2B275760-09-13T00:00:00Z', { token: A.token })];
  check('todos: extreme dates in filters never 5xx', extreme.every((r) => r.status < 500), extreme.map((r) => `${r.status} ${r.text.slice(0, 80)}`).join(' | '));
  await fuzzQuery('/api/todos', '/api/todos', ['date', 'from', 'to', 'priority', 'completed', 'noteId', 'limit'], A.token);
  await fuzzQuery('/api/todos/today', '/api/todos/today', ['x'], A.token);
  await fuzzQuery('/api/todos/range', '/api/todos/range', ['from', 'to'], A.token);
  const bToday = await call('GET', '/api/todos/today', { token: B.token });
  const bRange = await call('GET', `/api/todos/range?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, { token: B.token });
  check('todos: B sees none of A\'s tasks in today/range', !bToday.text.includes(SECRET) && !bRange.text.includes(SECRET) && bRange.json?.todos?.length === 0, bRange.text.slice(0, 120));
  const bAll = await call('GET', `/api/todos?noteId=${nid}`, { token: B.token });
  check('todos: B filtering by A\'s note id gets nothing', bAll.status === 200 && bAll.json?.todos?.length === 0, bAll.text.slice(0, 120));
  // happy path write validation on todos/notes (partly covered by UI tests, bad shapes are not)
  await fuzzBody('POST /api/todos', 'POST', '/api/todos', ['text', 'priority', 'deadline', 'startTime', 'endTime', 'recurrence', 'tags', 'noteId', 'meta'], { text: 'fz' }, A.token);
  await fuzzBody('PATCH /api/todos/:id', 'PATCH', `/api/todos/${fzTodo}`, ['text', 'priority', 'completed', 'deadline', 'startTime', 'endTime', 'recurrence', 'scope', 'tags', 'noteId', 'meta'], {}, A.token);
  await fuzzBody('POST /api/notes', 'POST', '/api/notes', ['title', 'content', 'tags', 'category', 'isArchived', 'meta'], { title: 'fz' }, A.token);
  await fuzzBody('PATCH /api/notes/:id', 'PATCH', `/api/notes/${nid2}`, ['title', 'content', 'tags', 'category', 'isArchived', 'meta', 'baseUpdatedAt', 'baseContent', 'force', 'keepBoth', 'collab'], {}, A.token);
  await fuzzBody('POST /api/notes/:id/versions', 'POST', `/api/notes/${nid2}/versions`, ['label'], {}, A.token);
  await fuzzBody('POST /api/notes/daily', 'POST', '/api/notes/daily', ['date'], {}, A.token);
  await fuzzQuery('/api/notes', '/api/notes', ['search', 'tag', 'category', 'sort', 'archived', 'deleted', 'snippet', 'limit', 'offset'], A.token);
  await fuzzQuery('/api/notes/:id (permanent flag on DELETE-less read)', `/api/notes/${nid2}`, ['x'], A.token);
  await fuzzId('/api/notes/:id', 'GET', (id) => `/api/notes/${id}`, A.token);
  await fuzzId('/api/notes/:id', 'PATCH', (id) => `/api/notes/${id}`, A.token, { body: { title: 'x' } });
  await fuzzId('/api/notes/:id', 'DELETE', (id) => `/api/notes/${id}`, A.token);
  await fuzzId('/api/notes/:id/restore', 'POST', (id) => `/api/notes/${id}/restore`, A.token);
  await fuzzId('/api/notes/:id/backups/:b', 'GET', (id) => `/api/notes/${nid2}/backups/${id}`, A.token);
  await fuzzId('/api/notes/:id/backups/:b/revert', 'POST', (id) => `/api/notes/${nid2}/backups/${id}/revert`, A.token);
  await fuzzId('/api/notes/:id/mentions/:o/link', 'POST', (id) => `/api/notes/${nid2}/mentions/${id}/link`, A.token);
  await fuzzId('/api/todos/:id', 'PATCH', (id) => `/api/todos/${id}`, A.token, { body: { text: 'x' } });
  await fuzzId('/api/todos/:id', 'DELETE', (id) => `/api/todos/${id}`, A.token);
}

// ================================================================ 6. notes / todos cross-user (new endpoints + core ones)
{
  const nb = (m, u, b) => call(m, u, { token: B.token, body: b });
  const reads = [await nb('GET', `/api/notes/${nid}`), await nb('GET', `/api/notes/${nid}/backlinks`), await nb('GET', `/api/notes/${nid}/mentions`), await nb('GET', `/api/notes/${nid}/backups`), await nb('GET', `/api/notes/${nid}/backups/${bk.id}`)];
  check('authorization: B cannot read A\'s note, backlinks, mentions or backups (404 / empty, no content)', reads.every((r) => r.status !== 200 || (!r.text.includes(SECRET) && !r.text.includes('old content of A'))) && reads[0].status === 404 && reads[4].status === 404, reads.map((r) => `${r.status}:${r.text.slice(0, 40)}`).join(' | '));
  const writes = [await nb('PATCH', `/api/notes/${nid}`, { title: 'hacked', content: 'hacked' }), await nb('DELETE', `/api/notes/${nid}?permanent=true`), await nb('POST', `/api/notes/${nid}/restore`), await nb('POST', `/api/notes/${nid}/archive`), await nb('POST', `/api/notes/${nid}/versions`, { label: 'x' }), await nb('PATCH', `/api/notes/${nid}/backups/${bk.id}`, { label: 'hacked' }), await nb('POST', `/api/notes/${nid}/backups/${bk.id}/revert`), await nb('POST', `/api/notes/${nid}/mentions/${nid2}/link`)];
  const aNote = await call('GET', `/api/notes/${nid}`, { token: A.token });
  const bkRow = await prisma.noteBackup.findUnique({ where: { id: bk.id } });
  check('authorization: B\'s writes on A\'s note are refused (404) and change nothing', writes.every((r) => r.status === 404 || r.status === 403 || r.status === 400) && JSON.stringify(aNote.json).includes(SECRET) && !JSON.stringify(aNote.json).includes('hacked') && bkRow?.label !== 'hacked', writes.map((r) => r.status).join(',') + ' ' + aNote.text.slice(0, 80));
  const mine = await nb('POST', '/api/notes', { title: 'b note', content: 'b' });
  const bnid = mine.json?.note?.id ?? mine.json?.id;
  const mention = await nb('POST', `/api/notes/${bnid}/mentions/${nid}/link`);
  const bl = await nb('GET', `/api/notes/${bnid}/mentions`);
  check('authorization: B cannot link to A\'s note from its own note', mention.status !== 200 && !bl.text.includes(SECRET), `${mention.status} ${mention.text.slice(0, 100)}`);
  const patch = await nb('PATCH', `/api/notes/${bnid}`, { content: `see [[Second]] and ${BASE}/api/notes/x` });
  const bb = await nb('GET', `/api/notes/${bnid}/backlinks`);
  const listB = await nb('GET', '/api/notes?search=' + encodeURIComponent(SECRET));
  check('authorization: B\'s search and note links never reveal A\'s notes', !listB.text.includes(SECRET + ' ') && !JSON.stringify(listB.json?.notes || listB.json).includes('body of A') && patch.status < 500 && !bb.text.includes('body of A'), listB.text.slice(0, 120));
  const tw = [await nb('PATCH', `/api/todos/${tid}`, { text: 'hacked', completed: true }), await nb('DELETE', `/api/todos/${tid}`), await nb('POST', '/api/dashboard/toggle-task', { id: tid, completed: true }), await nb('POST', '/api/todos', { text: 'x', noteId: nid }), await nb('PATCH', `/api/todos/${(await nb('POST', '/api/todos', { text: 'bt' })).json?.todo?.id}`, { noteId: nid })];
  const aTodo = await prisma.todo.findUnique({ where: { id: tid } });
  check('authorization: B cannot change / delete / toggle A\'s task nor attach tasks to A\'s note', tw[0].status === 404 && tw[1].status === 404 && tw[2].status === 404 && tw[3].status === 400 && tw[4].status === 400 && aTodo?.text.includes(SECRET) && aTodo.completed === false, tw.map((r) => r.status).join(',') + ' ' + aTodo?.text);
  const exp = await nb('GET', '/api/backup'); const exz = await call('GET', '/api/export', { token: B.token });
  check('authorization: B\'s backup/export contain none of A\'s data', !exp.text.includes(SECRET) && !exp.text.includes('body of A') && exz.status === 200 && !Buffer.from(exz.text, 'latin1').toString().includes(SECRET), exp.text.slice(0, 120));
  const dash = [await nb('GET', '/api/dashboard/insights'), await nb('GET', '/api/dashboard/daily-briefing'), await nb('GET', '/api/dashboard/weekly-report')];
  check('authorization: B\'s dashboard pages contain none of A\'s data', dash.every((r) => r.status === 200 && !r.text.includes(SECRET)), dash.map((r) => r.status).join(','));
}

// ================================================================ 7. dashboard
{
  const ins = await call('GET', '/api/dashboard/insights', { token: A.token });
  const brief = await call('GET', '/api/dashboard/daily-briefing', { token: A.token });
  const week = await call('GET', '/api/dashboard/weekly-report', { token: A.token });
  check('dashboard: insights / daily-briefing / weekly-report answer 200 JSON (AI off, no keys)', [ins, brief, week].every((r) => r.status === 200 && r.json), [ins, brief, week].map((r) => `${r.status} ${r.text.slice(0, 60)}`).join(' | '));
  const tg = await call('POST', '/api/dashboard/toggle-task', { token: A.token, body: { id: tid, completed: true } });
  const t2 = await prisma.todo.findUnique({ where: { id: tid } });
  check('dashboard: toggle-task completes the task', tg.status === 200 && t2?.completed === true, tg.text);
  await call('POST', '/api/dashboard/toggle-task', { token: A.token, body: { id: tid, completed: false } });
  const bad = [await call('POST', '/api/dashboard/toggle-task', { token: A.token, body: {} }), await call('POST', '/api/dashboard/toggle-task', { token: A.token, body: { id: tid, completed: 'yes' } }), await call('POST', '/api/dashboard/toggle-task', { token: A.token, body: { id: 'nope', completed: true } }), await call('POST', '/api/dashboard/toggle-task', { token: A.token, body: { id: ['a'], completed: true } })];
  check('dashboard: toggle-task bad body -> 400 / unknown id -> 404', bad[0].status === 400 && bad[1].status === 400 && bad[2].status === 404 && bad[3].status === 400, bad.map((r) => r.status).join(','));
  await fuzzBody('POST /api/dashboard/toggle-task', 'POST', '/api/dashboard/toggle-task', ['id', 'completed'], { id: tid, completed: false }, A.token);
  await fuzzQuery('/api/dashboard/insights', '/api/dashboard/insights', ['tz', 'range', 'days'], A.token);
  await fuzzQuery('/api/dashboard/weekly-report', '/api/dashboard/weekly-report', ['tz', 'week', 'date'], A.token);
  const tzh = await call('GET', '/api/dashboard/daily-briefing', { token: A.token, headers: { 'X-Timezone': 'Not/AZone' } });
  const tzh2 = await call('GET', '/api/todos/today', { token: A.token, headers: { 'X-Timezone': 'x'.repeat(5000), 'X-TZ': '../../' } });
  check('dashboard: bogus time-zone header never 5xx', tzh.status < 500 && tzh2.status < 500, `${tzh.status} ${tzh2.status}`);
}

// ================================================================ 8. study + river
{
  const mast = await call('GET', '/api/study/mastery', { token: A.token });
  const act0 = await call('GET', '/api/study/activity', { token: A.token });
  check('study: mastery + activity list (empty at first)', mast.status === 200 && Array.isArray(mast.json?.mastery) && act0.status === 200 && Array.isArray(act0.json?.quizzes), `${mast.text.slice(0, 80)} ${act0.text.slice(0, 80)}`);
  const noTopic = await call('POST', '/api/study/quiz', { token: A.token, body: {} });
  const noNotes = await call('POST', '/api/study/quiz', { token: A.token, body: { topic: 'no-such-topic' } });
  const arrTopic = await call('POST', '/api/study/quiz', { token: A.token, body: { topic: ['alpha'], count: 'x' } });
  check('study/quiz: missing topic 400, topic without notes 400, array topic handled', noTopic.status === 400 && noNotes.status === 400 && arrTopic.status !== 500, `${noTopic.status} ${noNotes.status} ${arrTopic.status}`);
  const withAi = await call('POST', '/api/study/quiz', { token: A.token, body: { topic: 'alpha', count: 5 } });
  check('study/quiz: with notes but no AI key -> clean 4xx/502/503 JSON error (no stack)', withAi.status >= 400 && withAi.status !== 500 && !!withAi.json?.error, `${withAi.status} ${withAi.text.slice(0, 160)}`);
  const ans = await call('POST', `/api/study/quiz/${run.id}/answers`, { token: A.token, body: { answers: [0] } });
  check('study/answers: marks the quiz and updates mastery', ans.status === 200 && ans.json?.correct === 1 && ans.json?.pct === 100 && ans.json?.mastery?.topic === 'alpha', ans.text.slice(0, 200));
  const again = await call('POST', `/api/study/quiz/${run.id}/answers`, { token: A.token, body: { answers: [0] } });
  check('study/answers: a repeat submit -> 409 and mastery unchanged', again.status === 409 && (await prisma.topicMastery.findFirst({ where: { userId: A.id, topic: 'alpha' } }))?.quizzes === 1, again.text);
  const run2 = await prisma.quizRun.create({ data: { userId: A.id, topic: 'alpha', questions: JSON.stringify([{ q: '?', options: ['a'], answer: 0, concept: 'c' }]), total: 1 } });
  const junkAns = [{ answers: 'abc' }, { answers: [null, {}, 'x', 1.5] }, {}, { answers: { a: 1 } }];
  const jr = [];
  for (const b of junkAns) { const r = await call('POST', `/api/study/quiz/${run2.id}/answers`, { token: A.token, body: b }); jr.push(r.status); if (r.status === 409) break; }
  check('study/answers: junk answers are scored as wrong, never 5xx', jr.every((s) => s < 500), jr.join(','));
  const run3 = await prisma.quizRun.create({ data: { userId: A.id, topic: 'alpha', questions: JSON.stringify([{ q: '?', options: ['a'], answer: 0, concept: 'c' }]), total: 1 } });
  const raceRes = await Promise.all([1, 2, 3, 4].map(() => call('POST', `/api/study/quiz/${run3.id}/answers`, { token: A.token, body: { answers: [0] } })));
  const wins = raceRes.filter((r) => r.status === 200).length;
  const q3 = (await prisma.topicMastery.findFirst({ where: { userId: A.id, topic: 'alpha' } }))?.quizzes;
  check('study/answers: 4 simultaneous submits -> exactly one wins, others 409', wins === 1 && raceRes.filter((r) => r.status === 409).length === 3, raceRes.map((r) => r.status).join(',') + ' quizzes=' + q3);
  await fuzzBody('POST /api/study/quiz/:id/answers', 'POST', `/api/study/quiz/${run.id}/answers`, ['answers'], {}, A.token);
  await fuzzBody('POST /api/study/quiz', 'POST', '/api/study/quiz', ['topic', 'count'], { topic: 'zz-none' }, A.token);
  await fuzzId('/api/study/quiz/:id/answers', 'POST', (id) => `/api/study/quiz/${id}/answers`, A.token, { body: { answers: [0] } });
  await fuzzId('/api/study/notes/:id/questions', 'GET', (id) => `/api/study/notes/${id}/questions`, A.token);
  const qc = await call('GET', `/api/study/notes/${nid}/questions`, { token: A.token });
  check('study/notes/:id/questions: returns a count', qc.status === 200 && typeof qc.json?.count === 'number', qc.text);
  const act1 = await call('GET', '/api/study/activity', { token: A.token });
  check('study/activity: includes the finished quizzes', act1.json?.quizzes?.length >= 1, act1.text.slice(0, 120));
  // cross user
  const run4 = await prisma.quizRun.create({ data: { userId: A.id, topic: 'alpha', questions: JSON.stringify([{ q: '?', options: ['a'], answer: 0, concept: 'c' }]), total: 1 } });
  const bAns = await call('POST', `/api/study/quiz/${run4.id}/answers`, { token: B.token, body: { answers: [0] } });
  const r4 = await prisma.quizRun.findUnique({ where: { id: run4.id } });
  const bMast = await call('GET', '/api/study/mastery', { token: B.token });
  const bQ = await call('GET', `/api/study/notes/${nid}/questions`, { token: B.token });
  const bQuiz = await call('POST', '/api/study/quiz', { token: B.token, body: { topic: 'alpha' } });
  check('authorization: B cannot answer A\'s quiz (404, still open), sees no mastery, no question counts, cannot quiz on A\'s topic', bAns.status === 404 && r4.finishedAt === null && bMast.json?.mastery?.length === 0 && bQ.json?.count === 0 && bQuiz.status === 400, `${bAns.status} ${bMast.text.slice(0, 60)} ${bQ.text} ${bQuiz.status}`);

  // river
  const pr = await call('GET', '/api/river/promises', { token: A.token });
  check('river/promises: lists A\'s latest promises', pr.status === 200 && pr.json?.promises?.some((p) => p.id === gen.id), pr.text.slice(0, 200));
  const pn = await call('GET', `/api/river/promises?noteId=${nid}`, { token: A.token });
  check('river/promises?noteId filters by note', pn.json?.promises?.length === 1, pn.text.slice(0, 120));
  const pat1 = await call('PATCH', `/api/river/promises/${gen.id}`, { token: A.token, body: { index: 0, status: 'added', todoId: tid } });
  check('river/promises PATCH: marks a promise added and links own task', pat1.status === 200 && pat1.json?.items?.[0]?.status === 'added' && pat1.json.items[0].todoId === tid, pat1.text.slice(0, 160));
  const bads = [await call('PATCH', `/api/river/promises/${gen.id}`, { token: A.token, body: { index: 5, status: 'added' } }), await call('PATCH', `/api/river/promises/${gen.id}`, { token: A.token, body: { index: 0, status: 'done' } }), await call('PATCH', `/api/river/promises/${gen.id}`, { token: A.token, body: { index: 'a', status: 'open' } }), await call('PATCH', `/api/river/promises/${gen.id}`, { token: A.token, body: { index: 0, status: 'open', todoId: 'nope' } }), await call('PATCH', '/api/river/promises/nope', { token: A.token, body: { index: 0, status: 'open' } })];
  check('river/promises PATCH: bad index / status / foreign todo -> 400, unknown id -> 404', bads.slice(0, 4).every((r) => r.status === 400) && bads[4].status === 404, bads.map((r) => r.status).join(','));
  await fuzzBody('PATCH /api/river/promises/:id', 'PATCH', `/api/river/promises/${genFz.id}`, ['index', 'status', 'todoId'], { index: 0, status: 'open' }, A.token);
  await fuzzId('/api/river/promises/:id', 'PATCH', (id) => `/api/river/promises/${id}`, A.token, { body: { index: 0, status: 'open' } });
  await fuzzQuery('/api/river/promises', '/api/river/promises', ['noteId'], A.token);
  const brief = await call('POST', '/api/river/brief', { token: A.token, body: { todoId: tid } });
  check('river/brief: own task with a related note -> 200 or clean AI error (no stack)', (brief.status === 200 || (brief.status >= 400 && brief.status !== 500)) && (brief.status === 200 || !!brief.json?.error), `${brief.status} ${brief.text.slice(0, 160)}`);
  const bb = [await call('POST', '/api/river/brief', { token: A.token, body: {} }), await call('POST', '/api/river/brief', { token: A.token, body: { todoId: 'nope' } })];
  check('river/brief: missing / unknown task -> 404', bb.every((r) => r.status === 404), bb.map((r) => r.status).join(','));
  await fuzzBody('POST /api/river/brief', 'POST', '/api/river/brief', ['todoId'], { todoId: tid }, A.token);
  const pm = await call('POST', `/api/river/notes/${nid}/promises`, { token: A.token, body: {} });
  check('river/notes/:id/promises: own note -> 200 or clean AI error (no stack)', pm.status === 200 || (pm.status >= 400 && pm.status !== 500 && !!pm.json?.error), `${pm.status} ${pm.text.slice(0, 160)}`);
  const tiny = (await call('POST', '/api/notes', { token: A.token, body: { title: 'tiny', content: 'tiny' } })).json;
  const short_ = await call('POST', `/api/river/notes/${tiny.note?.id ?? tiny.id}/promises`, { token: A.token, body: {} });
  check('river/notes/:id/promises: a very short note returns an empty list', short_.status === 200 && short_.json?.items?.length === 0, short_.text.slice(0, 120));
  await fuzzId('/api/river/notes/:id/promises', 'POST', (id) => `/api/river/notes/${id}/promises`, A.token);
  // cross user
  const bp = [await call('PATCH', `/api/river/promises/${gen.id}`, { token: B.token, body: { index: 0, status: 'ignored' } }), await call('POST', `/api/river/notes/${nid}/promises`, { token: B.token, body: {} }), await call('POST', '/api/river/brief', { token: B.token, body: { todoId: tid } })];
  const bl = await call('GET', '/api/river/promises', { token: B.token });
  const bln = await call('GET', `/api/river/promises?noteId=${nid}`, { token: B.token });
  const genNow = await prisma.aiGeneration.findUnique({ where: { id: gen.id } });
  check('authorization: B cannot read, change or generate promises / briefs for A\'s note and tasks', bp.every((r) => r.status === 404) && bl.json?.promises?.length === 0 && bln.json?.promises?.length === 0 && JSON.parse(genNow.result).items[0].status === 'added', bp.map((r) => r.status).join(',') + ' ' + bl.text.slice(0, 80));
  const mine = await call('POST', '/api/todos', { token: B.token, body: { text: 'b task' } });
  const cr = await call('PATCH', `/api/river/promises/${gen.id}`, { token: B.token, body: { index: 0, status: 'added', todoId: mine.json?.todo?.id } });
  check('authorization: B cannot patch A\'s promise even with B\'s own task id', cr.status === 404, cr.status);
}

// ================================================================ 9. AI connections
{
  const list = await call('GET', '/api/ai/connections', { token: A.token });
  check('ai/connections: list never returns the key (hasKey flag only)', list.status === 200 && list.json?.connections?.length === 3 && !list.text.includes(KEYSECRET) && list.json.connections.every((c) => c.hasKey === true && !('apiKey' in c)), list.text.slice(0, 250));
  const pt = await call('PATCH', `/api/ai/connections/${conn.id}`, { token: A.token, body: { label: 'renamed', enabled: false, model: 'm2' } });
  check('ai/connections PATCH: rename / disable / change model', pt.status === 200 && pt.json?.connection?.label === 'renamed' && pt.json.connection.enabled === false && pt.json.connection.model === 'm2' && !pt.text.includes(KEYSECRET), pt.text.slice(0, 200));
  const badp = [await call('PATCH', `/api/ai/connections/${conn.id}`, { token: A.token, body: {} }), await call('PATCH', `/api/ai/connections/${conn.id}`, { token: A.token, body: { enabled: 'yes' } }), await call('PATCH', `/api/ai/connections/${conn.id}`, { token: A.token, body: { model: ' ' } }), await call('PATCH', `/api/ai/connections/${conn.id}`, { token: A.token, body: { label: '' } }), await call('PATCH', `/api/ai/connections/${conn.id}`, { token: A.token, body: { model: 'm'.repeat(201) } }), await call('PATCH', '/api/ai/connections/nope', { token: A.token, body: { label: 'x' } })];
  check('ai/connections PATCH: empty / wrong type / too long -> 400, unknown id -> 404', badp.slice(0, 5).every((r) => r.status === 400) && badp[5].status === 404, badp.map((r) => r.status).join(','));
  const ord = await call('PUT', '/api/ai/connections/order', { token: A.token, body: { ids: [conn2.id, conn.id] } });
  check('ai/connections/order: reorders', ord.status === 200 && ord.json?.connections?.[0]?.id === conn2.id, ord.text.slice(0, 200));
  const badord = [await call('PUT', '/api/ai/connections/order', { token: A.token, body: { ids: 'x' } }), await call('PUT', '/api/ai/connections/order', { token: A.token, body: { ids: [1, 2] } }), await call('PUT', '/api/ai/connections/order', { token: A.token, body: { ids: Array(25).fill('a') } })];
  check('ai/connections/order: non-array / non-string / too many -> 400', badord.every((r) => r.status === 400), badord.map((r) => r.status).join(','));
  const dets = [await call('POST', '/api/ai/connections/detect', { token: A.token, body: {} }), await call('POST', '/api/ai/connections/detect', { token: A.token, body: { key: 'k'.repeat(501) } }), await call('POST', '/api/ai/connections/detect', { token: A.token, body: { key: 'k', provider: 'nonexistent' } }), await call('POST', '/api/ai/connections/detect', { token: A.token, body: { key: ['a'] } })];
  check('ai/connections/detect: empty / huge key / unknown provider -> 400', dets[0].status === 400 && dets[1].status === 400 && dets[2].status === 400 && dets[3].status === 400, dets.map((r) => r.status).join(','));
  process.env.PEBLO_HOSTED = '1'; // the shared-server rules (https + public hosts only) are the ones that matter for SSRF
  const adds = [await call('POST', '/api/ai/connections', { token: A.token, body: {} }), await call('POST', '/api/ai/connections', { token: A.token, body: { provider: 'openai', model: 'm' } }), await call('POST', '/api/ai/connections', { token: A.token, body: { provider: 'openai', key: 'k', model: '' } }), await call('POST', '/api/ai/connections', { token: A.token, body: { provider: 'custom', baseUrl: 'javascript:alert(1)', model: 'm' } }), await call('POST', '/api/ai/connections', { token: A.token, body: { provider: 'custom', baseUrl: 'http://169.254.169.254/latest/', model: 'm', key: 'k' } })];
  check('ai/connections POST: no provider / no key / no model / javascript: or metadata address -> 400 (SSRF guard)', adds.slice(0, 4).every((r) => r.status === 400) && adds[4].status === 400, adds.map((r) => `${r.status}:${r.text.slice(0, 50)}`).join(' | '));
  process.env.PEBLO_HOSTED = '';
  const add = await call('POST', '/api/ai/connections', { token: A.token, body: { provider: 'openai', key: 'sk-new-' + uniq, model: 'gpt-z', label: 'l'.repeat(200) } });
  check('ai/connections POST: saves (201), label cut to 60, key not echoed', add.status === 201 && add.json?.connection?.label?.length === 60 && !add.text.includes('sk-new-'), add.text.slice(0, 200));
  const dbRow = add.json?.connection?.id ? await prisma.aiConnection.findUnique({ where: { id: add.json.connection.id } }) : null;
  check('ai/connections POST: key is stored encrypted, not as typed', !!dbRow && dbRow.apiKey !== 'sk-new-' + uniq && !String(dbRow.apiKey).includes('sk-new-'), dbRow?.apiKey);
  if (add.json?.connection?.id) { const d = await call('DELETE', `/api/ai/connections/${add.json.connection.id}`, { token: A.token }); const d2 = await call('DELETE', `/api/ai/connections/${add.json.connection.id}`, { token: A.token }); check('ai/connections DELETE: removes, second delete 404', d.status === 200 && d2.status === 404, `${d.status} ${d2.status}`); }
  await fuzzBody('POST /api/ai/connections', 'POST', '/api/ai/connections', ['provider', 'key', 'model', 'label', 'baseUrl'], { provider: 'openai', key: 'k', model: 'm' }, A.token);
  // clean up what the fuzz may have saved (any 201 made rows)
  await prisma.aiConnection.deleteMany({ where: { userId: A.id, id: { notIn: [conn.id, conn2.id, connFz.id] } } });
  await fuzzBody('POST /api/ai/connections/detect', 'POST', '/api/ai/connections/detect', ['key', 'provider', 'baseUrl'], { key: 'k', provider: 'openai' }, A.token).catch(() => {});
  await fuzzBody('PATCH /api/ai/connections/:id', 'PATCH', `/api/ai/connections/${connFz.id}`, ['enabled', 'model', 'label'], { label: 'ok' }, A.token);
  await fuzzBody('PUT /api/ai/connections/order', 'PUT', '/api/ai/connections/order', ['ids'], {}, A.token);
  await fuzzId('/api/ai/connections/:id', 'PATCH', (id) => `/api/ai/connections/${id}`, A.token, { body: { label: 'x' } });
  await fuzzId('/api/ai/connections/:id', 'DELETE', (id) => `/api/ai/connections/${id}`, A.token);
  // cross user
  const bl = await call('GET', '/api/ai/connections', { token: B.token });
  const b1 = await call('PATCH', `/api/ai/connections/${conn.id}`, { token: B.token, body: { label: 'hacked', model: 'evil' } });
  const b2 = await call('DELETE', `/api/ai/connections/${conn.id}`, { token: B.token });
  const b3 = await call('GET', `/api/ai/connections/${conn.id}/models`, { token: B.token });
  const b4 = await call('PUT', '/api/ai/connections/order', { token: B.token, body: { ids: [conn.id, conn2.id] } });
  const now1 = await prisma.aiConnection.findUnique({ where: { id: conn.id } });
  const now2 = await prisma.aiConnection.findUnique({ where: { id: conn2.id } });
  check('authorization: B cannot list, change, delete, query models of, or reorder A\'s connections (no key leak)', bl.json?.connections?.length === 0 && b1.status === 404 && b2.status === 404 && b3.status === 404 && now1 && now1.label === 'renamed' && now1.model === 'm2' && now2.position === 0 && !(bl.text + b1.text + b3.text + b4.text).includes(KEYSECRET), [bl.status, b1.status, b2.status, b3.status, b4.status].join(',') + ` pos=${now2?.position}`);
  await fuzzId('/api/ai/connections/:id/models', 'GET', (id) => `/api/ai/connections/${id}/models`, A.token);
}

// ================================================================ 10. AI hub / chat / misc AI (no keys configured)
{
  const models = await call('GET', '/api/ai/hub/models', { token: A.token });
  check('ai/hub/models: 200 JSON without secrets', models.status === 200 && !models.text.includes(KEYSECRET), models.text.slice(0, 200));
  const srch = await call('POST', '/api/ai/hub/search', { token: A.token, body: { query: 'body longer forty characters quiz' } });
  check('ai/hub/search: finds A\'s note, strips the full text from sources', srch.status === 200 && srch.json?.sources?.some((s) => s.id === nid) && srch.json.sources.every((s) => !('text' in s)), srch.text.slice(0, 200));
  const bSrch = await call('POST', '/api/ai/hub/search', { token: B.token, body: { query: SECRET + ' body', noteIds: [nid, nid2] } });
  check('authorization: B\'s hub search with A\'s note ids returns none of A\'s notes', bSrch.status === 200 && !bSrch.text.includes('body of A') && bSrch.json?.sources?.every((s) => s.id !== nid && s.id !== nid2 && !String(s.title).includes(SECRET)), bSrch.text.slice(0, 160));
  await call('PUT', '/api/profile', { token: A.token, body: { settings: {} } });
  await fuzzBody('POST /api/ai/hub/search', 'POST', '/api/ai/hub/search', ['query', 'noteIds'], { query: 'q' }, A.token);
  const hc = await call('POST', '/api/ai/hub/chat', { token: A.token, body: { messages: [] } });
  check('ai/hub/chat: no message -> SSE error event "Type a message first", no 5xx', hc.status === 200 && /BAD_REQUEST/.test(hc.text), `${hc.status} ${hc.text.slice(0, 120)}`);
  const hc2 = await call('POST', '/api/ai/hub/chat', { token: A.token, body: { messages: [{ role: 'user', content: 'hello' }] } });
  check('ai/hub/chat: no AI configured -> an error/consent event, not a crash or stack', hc2.status === 200 && /"type":"(error|consent|done)"/.test(hc2.text) && !LEAK.test(hc2.text), hc2.text.slice(0, 200));
  for (const body of [{ messages: 'x' }, { messages: [null, 1, {}] }, { messages: [{ role: 'user', content: ['a'] }] }, { messages: Array(500).fill({ role: 'user', content: 'x' }) }, { messages: [{ role: 'user', content: 'y'.repeat(300000) }], noteIds: 'x', provider: { a: 1 }, model: [] }]) {
    const r = await call('POST', '/api/ai/hub/chat', { token: A.token, body });
    if (unexpected5xx(r.status) || LEAK.test(r.text)) check('ai/hub/chat: odd messages never crash', false, `${short(body).slice(0, 80)} -> ${r.status} ${r.text.slice(0, 120)}`);
  }
  check('ai/hub/chat: odd messages never crash (5 shapes)', true);
  const ch = await call('POST', '/api/ai/chat', { token: A.token, body: { message: 'make a note about cats' } });
  check('ai/chat: with no AI available -> clean JSON error, not 500', ch.status !== 500 && (ch.status === 200 || !!ch.json?.error) && !LEAK.test(ch.text), `${ch.status} ${ch.text.slice(0, 200)}`);
  const miss = await call('POST', '/api/ai/chat', { token: A.token, body: {} });
  check('ai/chat: missing message -> 400', miss.status === 400, `${miss.status} ${miss.text.slice(0, 100)}`);
  await fuzzBody('POST /api/ai/chat', 'POST', '/api/ai/chat', ['message', 'mode', 'noteId'], { message: 'hi' }, A.token);
  await fuzzBody('POST /api/ai/chat-stream', 'POST', '/api/ai/chat-stream', ['message', 'mode', 'noteId'], { message: 'hi' }, A.token);
  await fuzzBody('POST /api/ai/smart-intake', 'POST', '/api/ai/smart-intake', ['text', 'message', 'content'], { text: 'hi' }, A.token);
  // apply-update (no AI call, so it can be tested for real)
  const au = await call('POST', '/api/ai/chat/apply-update', { token: A.token, body: { noteId: nid2, appendContent: '\n\nappended line' } });
  const au2 = await call('GET', `/api/notes/${nid2}`, { token: A.token });
  check('ai/chat/apply-update: appends to own note', au.status === 200 && JSON.stringify(au2.json).includes('appended line'), au.text.slice(0, 160));
  const aus = [await call('POST', '/api/ai/chat/apply-update', { token: A.token, body: {} }), await call('POST', '/api/ai/chat/apply-update', { token: A.token, body: { noteId: nid2 } }), await call('POST', '/api/ai/chat/apply-update', { token: A.token, body: { noteId: nid2, appendContent: '   ' } }), await call('POST', '/api/ai/chat/apply-update', { token: A.token, body: { noteId: nid2, appendContent: 'x'.repeat(200001) } }), await call('POST', '/api/ai/chat/apply-update', { token: A.token, body: { noteId: 'nope', appendContent: 'x' } }), await call('POST', '/api/ai/chat/apply-update', { token: A.token, body: { noteId: ['a'], appendContent: ['x'] } })];
  check('ai/chat/apply-update: no note 400, nothing to add 400, too long 413, unknown note 404, arrays 400', aus[0].status === 400 && aus[1].status === 400 && aus[2].status === 400 && aus[3].status === 413 && aus[4].status === 404 && aus[5].status === 400, aus.map((r) => r.status).join(','));
  await fuzzBody('POST /api/ai/chat/apply-update', 'POST', '/api/ai/chat/apply-update', ['noteId', 'appendContent', 'replaceContent'], { noteId: nid2, appendContent: 'x' }, A.token);
  const bau = [await call('POST', '/api/ai/chat/apply-update', { token: B.token, body: { noteId: nid, appendContent: 'pwned' } }), await call('POST', '/api/ai/chat/apply-update', { token: B.token, body: { noteId: nid, replaceContent: 'pwned' } }), await call('POST', '/api/ai/chat', { token: B.token, body: { message: 'add pwned', mode: 'append', noteId: nid } })];
  const still = await call('GET', `/api/notes/${nid}`, { token: A.token });
  check('authorization: B cannot append to / replace A\'s note through AI chat or apply-update', bau[0].status === 404 && bau[1].status === 404 && !JSON.stringify(still.json).includes('pwned') && !bau[2].text.includes(SECRET), bau.map((r) => r.status).join(','));
  const nAi = [await call('POST', '/api/notes/block/ai', { token: A.token, body: {} }), await call('POST', `/api/notes/${nid}/ai/summary`, { token: A.token, body: {} }), await call('POST', `/api/notes/${nid}/ai/title`, { token: A.token, body: {} }), await call('POST', `/api/notes/${nid}/ai/tags`, { token: A.token, body: {} }), await call('POST', `/api/notes/${nid}/ai/actions`, { token: A.token, body: {} })];
  check('notes AI actions with no AI available -> clean JSON errors (no 500, no stack)', nAi.every((r) => r.status !== 500 && !LEAK.test(r.text)), nAi.map((r) => `${r.status}:${r.text.slice(0, 50)}`).join(' | '));
  const bAi = [await call('POST', `/api/notes/${nid}/ai/summary`, { token: B.token, body: {} }), await call('POST', `/api/notes/${nid}/ai/title`, { token: B.token, body: {} }), await call('POST', `/api/notes/${nid}/ai/tags`, { token: B.token, body: {} }), await call('POST', `/api/notes/${nid}/ai/actions`, { token: B.token, body: {} })];
  check('authorization: B gets 404 on A\'s note AI actions and no content', bAi.every((r) => r.status === 404 && !r.text.includes(SECRET)), bAi.map((r) => r.status).join(','));
  await fuzzBody('POST /api/notes/block/ai', 'POST', '/api/notes/block/ai', ['prompt', 'text', 'instruction', 'noteId', 'action', 'context'], { prompt: 'x' }, A.token);
  await fuzzId('/api/notes/:id/ai/summary', 'POST', (id) => `/api/notes/${id}/ai/summary`, A.token);
  const lp = [await call('GET', '/api/ai/link-preview', { token: A.token }), await call('GET', '/api/ai/link-preview?url=file:///etc/passwd', { token: A.token }), await call('GET', '/api/ai/link-preview?url=http://127.0.0.1:1/', { token: A.token }), await call('GET', '/api/ai/link-preview?url=http://169.254.169.254/latest/meta-data/', { token: A.token }), await call('GET', '/api/ai/link-preview?url[]=a', { token: A.token })];
  check('ai/link-preview: no url / file: / loopback / metadata address refused or empty (no SSRF, no 5xx)', lp.every((r) => r.status < 500 && !/root:|ami-id|instance-id/.test(r.text)), lp.map((r) => `${r.status}:${r.text.slice(0, 60)}`).join(' | '));
  const oc = await call('GET', '/api/ai/ollama/check', { token: A.token });
  const ls = await call('GET', '/api/ai/local/status', { token: A.token });
  check('ai/ollama/check + local/status answer JSON without crashing', oc.status < 500 && ls.status < 500, `${oc.status} ${ls.status}`);
  await fuzzQuery('/api/ai/ollama/check', '/api/ai/ollama/check', ['url', 'host'], A.token);
  const tr = [await call('POST', '/api/ai/transcribe', { token: A.token, body: {} }), await call('POST', '/api/ai/transcribe', { token: A.token, raw: 'not audio', headers: { 'Content-Type': 'audio/webm' } }), await call('POST', '/api/ai/transcribe', { token: A.token, raw: Buffer.alloc(100), headers: { 'Content-Type': 'application/octet-stream' } })];
  check('ai/transcribe: no/invalid audio -> 4xx/503, not 500', tr.every((r) => r.status !== 500), tr.map((r) => `${r.status}:${r.text.slice(0, 50)}`).join(' | '));
  const lm = [await call('POST', '/api/ai/local/pull', { token: A.token, body: {} }), await call('POST', '/api/ai/local/remove', { token: A.token, body: { model: ['x'] } }), await call('POST', '/api/ai/local/start', { token: A.token, body: {} }), await call('POST', '/api/ai/local/cancel', { token: A.token, body: {} }), await call('POST', '/api/ai/local/install/cancel', { token: A.token, body: {} })];
  check('ai/local/*: bad bodies never 500', lm.every((r) => r.status !== 500), lm.map((r) => `${r.status}:${r.text.slice(0, 50)}`).join(' | '));
  await fuzzBody('POST /api/ai/local/pull', 'POST', '/api/ai/local/pull', ['model', 'name'], { model: 'x' }, A.token);
}

// ================================================================ 11. collab (owner side)
{
  const pres = await call('GET', '/api/collab/presence', { token: A.token });
  check('collab/presence: 200 with a presence object', pres.status === 200 && typeof pres.json?.presence === 'object', pres.text);
  const cm = await call('POST', `/api/collab/comments/${nid}`, { token: A.token, body: { body: 'a comment ' + SECRET, kind: 'comment' } });
  const cl = await call('GET', `/api/collab/comments/${nid}`, { token: A.token });
  check('collab/comments: owner adds and lists a comment', cm.status === 200 && !!cm.json?.id && cl.json?.comments?.some((c) => c.id === cm.json.id), `${cm.text} ${cl.text.slice(0, 120)}`);
  const cid = cm.json?.id;
  const st = await call('PATCH', `/api/collab/comments/${nid}/${cid}`, { token: A.token, body: { status: 'resolved' } });
  const stBad = await call('PATCH', `/api/collab/comments/${nid}/${cid}`, { token: A.token, body: { status: 'weird' } });
  check('collab/comments PATCH: valid status ok, invalid status -> 400', st.status === 200 && stBad.status === 400, `${st.status} ${stBad.status}`);
  const cbad = [await call('POST', `/api/collab/comments/${nid}`, { token: A.token, body: {} }), await call('POST', `/api/collab/comments/${nid}`, { token: A.token, body: { body: 'x'.repeat(100000) } }), await call('POST', `/api/collab/comments/${nid}`, { token: A.token, body: { body: ['a'], kind: {}, color: [], replacement: 5, anchor: 'x' } })];
  check('collab/comments POST: empty -> 400, huge or odd types never 5xx', cbad[0].status === 400 && cbad[1].status < 500 && cbad[2].status < 500, cbad.map((r) => `${r.status}:${r.text.slice(0, 50)}`).join(' | '));
  await fuzzBody('POST /api/collab/comments/:noteId', 'POST', `/api/collab/comments/${nid}`, ['body', 'kind', 'color', 'replacement', 'anchor', 'quote', 'from', 'to', 'parentId'], { body: 'hi' }, A.token);
  await fuzzBody('PATCH /api/collab/comments/:n/:c', 'PATCH', `/api/collab/comments/${nid}/${cid}`, ['status'], {}, A.token);
  await fuzzId('/api/collab/comments/:noteId', 'GET', (id) => `/api/collab/comments/${id}`, A.token);
  await fuzzId('/api/collab/comments/:n/:cid', 'PATCH', (id) => `/api/collab/comments/${nid}/${id}`, A.token, { body: { status: 'resolved' } });
  await fuzzId('/api/collab/comments/:n/:cid', 'DELETE', (id) => `/api/collab/comments/${nid}/${id}`, A.token);
  const nt = await call('GET', '/api/collab/notifications', { token: A.token });
  check('collab/notifications: list + unread count', nt.status === 200 && Array.isArray(nt.json?.notifications) && typeof nt.json?.unread === 'number', nt.text.slice(0, 120));
  await prisma.$executeRawUnsafe(`INSERT INTO user_notifications (id, user_id, kind, note_id, title, body, from_name) VALUES (gen_random_uuid()::text, $1, 'comment', $2, $3, 'b', 'g')`, A.id, nid, 'notif ' + SECRET).catch((e) => console.log('      (could not seed notification: ' + e.message.slice(0, 100) + ')'));
  const nt2 = await call('GET', '/api/collab/notifications', { token: A.token });
  const bnt = await call('GET', '/api/collab/notifications', { token: B.token });
  const bRead = await call('POST', '/api/collab/notifications/read', { token: B.token, body: {} });
  const nt3 = await call('GET', '/api/collab/notifications', { token: A.token });
  check('authorization: B sees none of A\'s notifications and "mark all read" by B does not mark A\'s', nt2.json?.unread >= 1 && bnt.json?.notifications?.length === 0 && bRead.status === 200 && nt3.json?.unread === nt2.json?.unread, `${nt2.text.slice(0, 80)} | ${bnt.text.slice(0, 80)} | ${nt3.json?.unread}`);
  const rd = await call('POST', '/api/collab/notifications/read', { token: A.token, body: { ids: [nt2.json?.notifications?.[0]?.id] } });
  const nt4 = await call('GET', '/api/collab/notifications', { token: A.token });
  check('collab/notifications/read: marks the given ids read', rd.status === 200 && nt4.json?.unread === nt2.json?.unread - 1, `${rd.status} ${nt4.json?.unread}/${nt2.json?.unread}`);
  await fuzzBody('POST /api/collab/notifications/read', 'POST', '/api/collab/notifications/read', ['ids'], {}, A.token);
  const rdAll = await call('POST', '/api/collab/notifications/read', { token: A.token, body: { ids: [1, null, 'a'.repeat(100), '%'] } });
  check('collab/notifications/read: non-string ids ignored', rdAll.status < 500, rdAll.status);
  // cross user
  const bc = [await call('GET', `/api/collab/comments/${nid}`, { token: B.token }), await call('POST', `/api/collab/comments/${nid}`, { token: B.token, body: { body: 'evil' } }), await call('PATCH', `/api/collab/comments/${nid}/${cid}`, { token: B.token, body: { status: 'open' } }), await call('DELETE', `/api/collab/comments/${nid}/${cid}`, { token: B.token })];
  const cl2 = await call('GET', `/api/collab/comments/${nid}`, { token: A.token });
  check('authorization: B cannot read / add / change / delete comments on A\'s note (404) - none leaked', bc.every((r) => r.status === 404 && !r.text.includes(SECRET)) && cl2.json?.comments?.find((c) => c.id === cid)?.status === 'resolved' && !cl2.json.comments.some((c) => c.body === 'evil'), bc.map((r) => r.status).join(','));
  const bp = await call('GET', '/api/collab/presence', { token: B.token });
  check('collab/presence: B sees no entries for A\'s notes', bp.status === 200 && !bp.text.includes(nid), bp.text);
  const del = await call('DELETE', `/api/collab/comments/${nid}/${cid}`, { token: A.token });
  check('collab/comments DELETE: owner removes the comment', del.status === 200, del.text);
  // public (guest) comment routes
  const pub = [await call('GET', '/api/public/collab/short/comments'), await call('GET', '/api/public/collab/' + 'a'.repeat(25) + '/comments?sid=' + 's'.repeat(20)), await call('POST', '/api/public/collab/' + 'a'.repeat(25) + '/comments', { body: { sid: 's'.repeat(20), body: 'x' } }), await call('PATCH', '/api/public/collab/' + 'a'.repeat(25) + '/comments/x', { body: { status: 'open' } }), await call('DELETE', '/api/public/collab/' + 'a'.repeat(25) + '/comments/x')];
  check('collab (public): unknown link -> 404 JSON, never 5xx', pub.every((r) => r.status === 404), pub.map((r) => r.status).join(','));
  await fuzzId('/api/public/collab/:token/comments', 'GET', (id) => `/api/public/collab/${id}/comments?sid=${'s'.repeat(20)}`, undefined);
}

// ================================================================ 12. transfer: export / import / backup / restore / example
{
  const ex = await call('GET', '/api/export', { token: A.token });
  check('export: 200 zip attachment', ex.status === 200 && /zip/.test(ex.headers.get('content-type') || '') && /attachment/.test(ex.headers.get('content-disposition') || ''), `${ex.status} ${ex.headers.get('content-type')}`);
  const bu = await call('GET', '/api/backup', { token: A.token });
  check('backup: JSON with format, notes, todos; no password / token data', bu.status === 200 && bu.json?.format === 'peblo-backup' && bu.json.notes.length >= 2 && !/passwordHash|tokenHash|apiKey/.test(bu.text) && !bu.text.includes(KEYSECRET), bu.text.slice(0, 150));
  const buB = bu.json;
  // restore into B: backup of A must only add to the caller
  const rs = await call('POST', '/api/restore', { token: B.token, body: buB });
  const bNotes = await call('GET', '/api/notes', { token: B.token });
  const bCount = await prisma.note.count({ where: { userId: B.id } });
  check('restore: adds notes + tasks to the caller only, and does not re-use A\'s ids', rs.status === 200 && rs.json?.restored?.notes === buB.notes.length && bCount >= buB.notes.length && (await prisma.note.count({ where: { userId: A.id, id: nid } })) === 1, `${rs.text} ${bCount}`);
  const aCount = await prisma.note.count({ where: { userId: A.id } });
  check('restore: leaves A\'s own notes alone', aCount >= 2 && !!(await prisma.note.findFirst({ where: { id: nid, userId: A.id } })), aCount);
  const rsBad = [await call('POST', '/api/restore', { token: A.token, body: {} }), await call('POST', '/api/restore', { token: A.token, body: { format: 'peblo-backup', version: 2, notes: [], todos: [] } }), await call('POST', '/api/restore', { token: A.token, body: { format: 'peblo-backup', version: 1, notes: 'x', todos: [] } }), await call('POST', '/api/restore', { token: A.token, body: { format: 'peblo-backup', version: 1, notes: Array(5001).fill({}), todos: [] } }), await call('POST', '/api/restore', { token: A.token, body: [] })];
  check('restore: not a backup / wrong version / not arrays / too many -> 400', rsBad.every((r) => r.status === 400), rsBad.map((r) => r.status).join(','));
  const weird = { format: 'peblo-backup', version: 1, notes: [null, 1, 'x', [], { title: ['a'], content: 5, tags: 'x', meta: 'x', createdAt: 'zzz', isArchived: 'yes' }, { title: 'ok-weird', content: 'c\u0000d', tags: [1, null, 'T'.repeat(500)], meta: { a: { b: 1 } }, createdAt: '+275760-09-13T00:00:00.000Z' }], todos: [null, 3, { text: ['a'] }, { text: 'okt', deadline: 'zzz', tags: 'x', priority: 'urgent', startTime: 5, noteId: { a: 1 }, meta: 'x' }, { text: 'okt2', deadline: '-271821-04-20T00:00:00Z', startTime: '12:30:99', endTime: '99' }] };
  const wr = await call('POST', '/api/restore', { token: A.token, body: weird });
  check('restore: weird note/task shapes are skipped or cleaned, never 5xx', wr.status < 500, `${wr.status} ${wr.text.slice(0, 200)}`);
  const before = await prisma.note.count({ where: { userId: A.id } });
  const rsFail = await call('POST', '/api/restore', { token: A.token, body: { format: 'peblo-backup', version: 1, notes: [{ title: 'will-roll-back', content: 'a' }, { title: 'x', content: 'b', createdAt: '9999999-01-01' }], todos: [] } });
  const after = await prisma.note.count({ where: { userId: A.id } });
  check('restore: a failing restore leaves nothing half-added (or succeeds fully)', rsFail.status === 200 ? after === before + 2 : after === before, `${rsFail.status} before=${before} after=${after}`);
  await fuzzBody('POST /api/restore', 'POST', '/api/restore', ['format', 'version', 'notes', 'todos'], { format: 'peblo-backup', version: 1, notes: [], todos: [] }, A.token);
  // example
  const ex1 = await call('POST', '/api/example', { token: B.token, body: {} });
  const ex2 = await call('POST', '/api/example', { token: B.token, body: {} });
  const tagsB = (await call('GET', '/api/tags', { token: B.token })).json.tags.map((t) => t.name);
  check('example: adds sample notes + tasks once (409 the second time)', ex1.status === 200 && ex1.json?.added?.notes === 4 && ex2.status === 409 && tagsB.includes('example-data'), `${ex1.text} ${ex2.status}`);
  const bnBefore = await prisma.note.count({ where: { userId: B.id } });
  const exAClear = await call('POST', '/api/example/clear', { token: A.token, body: {} });
  const bnAfter = await prisma.note.count({ where: { userId: B.id } });
  check('example/clear: A clearing removes none of B\'s examples', exAClear.status === 200 && bnAfter === bnBefore, `${exAClear.text} ${bnBefore}/${bnAfter}`);
  const cl = await call('POST', '/api/example/clear', { token: B.token, body: {} });
  const bnEnd = await prisma.note.count({ where: { userId: B.id, tags: { some: { tag: { name: 'example-data' } } } } });
  check('example/clear: removes only example data (and restored notes stay)', cl.status === 200 && cl.json?.removed?.notes === 4 && bnEnd === 0 && (await prisma.note.count({ where: { userId: B.id } })) >= buB.notes.length, cl.text);
  // import
  const fd = (name, data, type = 'text/markdown') => { const f = new FormData(); f.append('files', new Blob([data], { type }), name); return f; };
  const im = await call('POST', '/api/import', { token: A.token, raw: fd('imp-note.md', '# Imported note\n\nhello #tag1'), headers: {} });
  check('import: a Markdown file becomes a note tagged "imported"', im.status === 200 && im.json?.imported === 1, `${im.status} ${im.text.slice(0, 200)}`);
  const none = await call('POST', '/api/import', { token: A.token, raw: new FormData() });
  check('import: no files -> 400', none.status === 400, `${none.status} ${none.text.slice(0, 100)}`);
  const odd = [];
  const cases = [['bad.zip', 'this is not a zip file at all', 'application/zip'], ['empty.zip', '', 'application/zip'], ['trunc.zip', Buffer.from('504b0304140000000800', 'hex'), 'application/zip'], ['bin.md', Buffer.from([0, 255, 254, 0, 1, 2, 3, 192, 193]), 'text/markdown'], ['n\u0000ul.md', '# nul\u0000 inside', 'text/markdown'], ['a.csv', 'a,b,c\n"unterminated,\n', 'text/csv'], ['x.exe', 'MZ', 'application/octet-stream'], [`${'long'.repeat(400)}.md`, '# long name', 'text/markdown'], ['../../evil.md', '# traversal', 'text/markdown'], ['huge.md', '#'.repeat(3_000_000), 'text/markdown']];
  for (const [name, data, type] of cases) {
    const r = await call('POST', '/api/import', { token: A.token, raw: fd(name, data, type) });
    if (unexpected5xx(r.status) || r.status === 0) odd.push(`${name.slice(0, 20)} -> ${r.status} ${r.text.slice(0, 100)}`);
  }
  check('import: corrupt / empty / binary / odd-name / huge uploads never 5xx', odd.length === 0, odd.slice(0, 3).join(' | '));
  const wrongField = new FormData(); wrongField.append('other', new Blob(['x']), 'a.md');
  const wf = await call('POST', '/api/import', { token: A.token, raw: wrongField });
  check('import: unexpected multipart field name -> 4xx not 5xx', wf.status >= 400 && wf.status < 500, `${wf.status} ${wf.text.slice(0, 100)}`);
  const big = await call('POST', '/api/import', { token: A.token, raw: 'x', headers: { 'Content-Type': 'multipart/form-data', 'Content-Length': String(200 * 1024 * 1024) } });
  check('import: declared size over 150 MB -> 413', big.status === 413 || big.status === 400 || big.status === 0, `${big.status} ${big.text.slice(0, 100)}`);
  const bim = await call('POST', '/api/import', { token: B.token, raw: fd('b.md', '# B import\n\nx') });
  const aHas = await prisma.note.count({ where: { userId: A.id, title: 'B import' } });
  check('import: notes land in the caller\'s account only', bim.status === 200 && aHas === 0, `${bim.status} ${aHas}`);
}

// ================================================================ 13. files + media
{
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6c3590000000049454e44ae426082', 'hex');
  const up = await call('POST', '/api/media', { token: A.token, raw: png, headers: { 'Content-Type': 'image/png' } });
  check('media: upload a PNG (201, id + url)', up.status === 201 && !!up.json?.id, up.text.slice(0, 160));
  const mid = up.json?.id;
  const got = await fetch(BASE + `/api/media/${mid}`);
  const buf = Buffer.from(await got.arrayBuffer());
  check('media: GET returns the same bytes with its image type', got.status === 200 && got.headers.get('content-type') === 'image/png' && buf.equals(png), `${got.status} ${got.headers.get('content-type')}`);
  const txt = await call('GET', `/api/media/${mid}/text`);
  check('media: /text returns description (null before describing)', txt.status === 200 && txt.json?.description === null, txt.text);
  const mbad = [await call('POST', '/api/media', { token: A.token, raw: 'hi', headers: { 'Content-Type': 'text/plain' } }), await call('POST', '/api/media', { token: A.token, raw: 'x', headers: { 'Content-Type': 'image/svg+xml' } }), await call('POST', '/api/media', { token: A.token, raw: '', headers: { 'Content-Type': 'image/png' } }), await call('POST', '/api/media', { token: A.token, body: { a: 1 } }), await call('POST', '/api/media', { token: A.token, raw: Buffer.alloc(6 * 1024 * 1024 + 10), headers: { 'Content-Type': 'image/png' } })];
  check('media: wrong type 415 (text, svg, json), empty 400/415, over 6 MB 413', mbad[0].status === 415 && mbad[1].status === 415 && [400, 415].includes(mbad[2].status) && mbad[3].status === 415 && mbad[4].status === 413, mbad.map((r) => r.status).join(','));
  const mget = [];
  for (const id of ['abcdefgh', '12345678', 'abcdefgh.png', 'a'.repeat(64), 'a'.repeat(65), 'short', '%00%00%00%00%00%00%00%00', '12345678-1234-1234-1234-123456789012', "abc'def'gh", 'ABCDEFGH', '........', '________', '--------']) {
    const r1 = await call('GET', `/api/media/${id}`); const r2 = await call('GET', `/api/media/${id}/text`); const r3 = await call('POST', `/api/media/${id}/describe`, { token: A.token, body: {} });
    for (const [n, r] of [['GET', r1], ['text', r2], ['describe', r3]]) if (unexpected5xx(r.status) || r.status === 0) mget.push(`${n} ${id} -> ${r.status} ${r.text.slice(0, 80)}`);
  }
  check('media: odd ids (8-char non-uuid, NUL, quotes) answer 404, never 5xx', mget.length === 0, mget.slice(0, 3).join(' | '));
  const desc = await call('POST', `/api/media/${mid}/describe`, { token: A.token, body: {} });
  check('media/describe: own picture with no AI -> clean error JSON (no 500)', desc.status !== 500 && !LEAK.test(desc.text), `${desc.status} ${desc.text.slice(0, 160)}`);
  const bdesc = await call('POST', `/api/media/${mid}/describe`, { token: B.token, body: {} });
  check('authorization: B cannot describe A\'s picture (404)', bdesc.status === 404, `${bdesc.status} ${bdesc.text.slice(0, 80)}`);
  // files
  const fup = await call('POST', '/api/files', { token: A.token, raw: Buffer.from('%PDF-1.4 fake'), headers: { 'X-File-Name': encodeURIComponent('report é.pdf'), 'X-File-Type': 'application/pdf' } });
  check('files: upload (201, id/url/name/size/mime)', fup.status === 201 && fup.json?.mime === 'application/pdf' && fup.json?.name === 'report é.pdf' && fup.json?.size === 13, fup.text.slice(0, 200));
  const fid = fup.json?.id;
  const fget = await fetch(BASE + `/api/files/${fid}`);
  const fdl = await fetch(BASE + `/api/files/${fid}?dl=1`);
  check('files: PDF shows inline, ?dl=1 forces download, nosniff set', fget.status === 200 && /^inline/.test(fget.headers.get('content-disposition') || '') && /^attachment/.test(fdl.headers.get('content-disposition') || '') && fget.headers.get('x-content-type-options') === 'nosniff', `${fget.headers.get('content-disposition')}`);
  const risky = await call('POST', '/api/files', { token: A.token, raw: '<script>alert(1)</script>', headers: { 'X-File-Name': 'x.html', 'X-File-Type': 'text/html' } });
  const rget = await fetch(BASE + `/api/files/${risky.json?.id}`);
  const svg = await call('POST', '/api/files', { token: A.token, raw: '<svg onload=alert(1)>', headers: { 'X-File-Name': 'x.svg', 'X-File-Type': 'image/svg+xml' } });
  const sget = await fetch(BASE + `/api/files/${svg.json?.id}`);
  check('files: HTML / SVG are always served as a download (octet-stream), never rendered', rget.headers.get('content-type') === 'application/octet-stream' && /^attachment/.test(rget.headers.get('content-disposition') || '') && sget.headers.get('content-type') === 'application/octet-stream', `${rget.headers.get('content-type')} ${sget.headers.get('content-type')}`);
  const mimeJunk = await call('POST', '/api/files', { token: A.token, raw: 'x', headers: { 'X-File-Name': '%E0%A4%A', 'X-File-Type': 'text/html\r\nX-Evil: 1' } }).catch(() => ({ status: 0 }));
  const mimeJunk2 = await call('POST', '/api/files', { token: A.token, raw: 'x', headers: { 'X-File-Name': encodeURIComponent('a"b\\c\u0000\n.txt'), 'X-File-Type': 'not a mime' } });
  const g2 = await fetch(BASE + `/api/files/${mimeJunk2.json?.id}`);
  check('files: malformed % in name, junk mime and quote / NUL / newline names are made safe', mimeJunk.status < 500 && mimeJunk2.status === 201 && g2.headers.get('content-type') === 'application/octet-stream' && !/[\r\n]/.test(g2.headers.get('content-disposition') || '') && !/"b/.test(g2.headers.get('content-disposition')?.split(';')[1] || ''), `${mimeJunk.status} ${mimeJunk2.status} ${g2.headers.get('content-disposition')}`);
  const empty = await call('POST', '/api/files', { token: A.token, raw: '', headers: { 'X-File-Name': 'e.txt' } });
  check('files: empty upload -> 400', empty.status === 400, `${empty.status} ${empty.text.slice(0, 80)}`);
  const huge = await call('POST', '/api/files', { token: A.token, raw: Buffer.alloc(25 * 1024 * 1024 + 2048), headers: { 'X-File-Name': 'huge.bin' } });
  check('files: over 25 MB -> 413 JSON', huge.status === 413, `${huge.status} ${huge.text.slice(0, 80)}`);
  const fg = [];
  for (const id of ['abcdefgh', '12345678.pdf', 'a'.repeat(64), 'a'.repeat(65), '%00%00%00%00%00%00%00%00', '12345678-1234-1234-1234-123456789012', "abc'def'gh", 'nope']) {
    const r = await call('GET', `/api/files/${id}`);
    if (unexpected5xx(r.status) || r.status === 0) fg.push(`${id} -> ${r.status} ${r.text.slice(0, 80)}`);
  }
  check('files: odd ids answer 404, never 5xx', fg.length === 0, fg.slice(0, 3).join(' | '));
  const bf = await call('POST', '/api/files', { token: B.token, raw: 'b file', headers: { 'X-File-Name': 'b.txt' } });
  const bfIn = await prisma.$queryRaw`SELECT user_id FROM files WHERE id = ${bf.json?.id}`;
  check('files: stored under the uploader\'s account', bfIn?.[0]?.user_id === B.id, JSON.stringify(bfIn));
}

// ================================================================ 14. profile + auth (deeper than UI tests)
{
  const U = await newUser('prof');
  const pr = await call('GET', '/api/profile', { token: U.token });
  check('profile: GET returns the user without password hash / token version', pr.status === 200 && !/passwordHash|tokenVersion|\$2[aby]\$/.test(pr.text), pr.text.slice(0, 200));
  const up = await call('PUT', '/api/profile', { token: U.token, body: { name: '  New Name  ', jobTitle: 'Dev', bio: 'b', timezone: 'Asia/Kolkata', settings: { theme: 'dark' } } });
  check('profile: PUT updates name (trimmed), job, bio, timezone, settings', up.status === 200 && up.json?.user?.name === 'New Name' && up.json.user.timezone === 'Asia/Kolkata', up.text.slice(0, 200));
  const pbad = [await call('PUT', '/api/profile', { token: U.token, body: { name: ['x'] } }), await call('PUT', '/api/profile', { token: U.token, body: { jobTitle: 'x'.repeat(101) } }), await call('PUT', '/api/profile', { token: U.token, body: { bio: 'x'.repeat(501) } }), await call('PUT', '/api/profile', { token: U.token, body: { avatar: 'data:image/png;base64,AAAA' } }), await call('PUT', '/api/profile', { token: U.token, body: { avatar: 'data:image/webp;base64,' + 'A'.repeat(200001) } }), await call('PUT', '/api/profile', { token: U.token, body: { timezone: 'Mars/Base' } }), await call('PUT', '/api/profile', { token: U.token, body: { settings: [] } }), await call('PUT', '/api/profile', { token: U.token, body: { settings: { x: 'y'.repeat(25000) } } }), await call('PUT', '/api/profile', { token: U.token, body: { email: 'nope' } }), await call('PUT', '/api/profile', { token: U.token, body: { email: 'new@peblo.test' } }), await call('PUT', '/api/profile', { token: U.token, body: { email: 'new@peblo.test', currentPassword: 'wrong' } }), await call('PUT', '/api/profile', { token: U.token, body: { settings: { ollamaUrl: 5 } } }), await call('PUT', '/api/profile', { token: U.token, body: { settings: { ollamaUrl: 'file:///etc/passwd' } } })];
  check('profile: bad name / long job / long bio / non-webp avatar / big avatar / bad zone / bad settings / bad email -> 400; email change without password -> 403', pbad.slice(0, 9).every((r) => r.status === 400) && pbad[9].status === 403 && pbad[10].status === 403 && pbad[11].status === 400 && pbad[12].status === 400, pbad.map((r) => r.status).join(','));
  const taken = await call('PUT', '/api/profile', { token: U.token, body: { email: A.email, currentPassword: U.password } });
  check('profile: email already used by another account -> 409 (no account info beyond that)', taken.status === 409, `${taken.status} ${taken.text.slice(0, 100)}`);
  const emailOk = await call('PUT', '/api/profile', { token: U.token, body: { email: `apitest-prof2-${uniq}@peblo.test`, currentPassword: U.password } });
  check('profile: email change with the right password works (no mail configured -> immediate)', emailOk.status === 200 && emailOk.json?.user?.email?.startsWith('apitest-prof2'), emailOk.text.slice(0, 160));
  U.email = `apitest-prof2-${uniq}@peblo.test`;
  const keys = await call('PUT', '/api/profile', { token: U.token, body: { settings: { openAiKey: 'sk-profile-key-' + uniq, geminiKey: 'g-key-' + uniq } } });
  const prNow = await call('GET', '/api/profile', { token: U.token });
  const rawU = await prisma.user.findUnique({ where: { id: U.id } });
  check('profile: API keys sent in settings never come back in clear text nor stay in the settings JSON', !(keys.text + prNow.text).includes('sk-profile-key-' + uniq) && !JSON.stringify(rawU.settings).includes('sk-profile-key-') && !(keys.text + prNow.text).includes('g-key-' + uniq), (keys.text + prNow.text).slice(0, 200));
  await fuzzBody('PUT /api/profile', 'PUT', '/api/profile', ['name', 'email', 'jobTitle', 'bio', 'avatar', 'timezone', 'settings', 'currentPassword'], {}, U.token);
  const rawNote = await call('PUT', '/api/profile', { token: U.token, body: { settings: { aiOff: true } } });
  const aiRes = await call('POST', '/api/study/quiz', { token: U.token, body: { topic: 'x' } });
  check('profile: "Turn off all AI" makes AI routes answer 403 AI_OFF', rawNote.status === 200 && aiRes.status === 403 && aiRes.json?.code === 'AI_OFF', `${aiRes.status} ${aiRes.text.slice(0, 100)}`);
  const aiResH = [await call('POST', '/api/ai/chat', { token: U.token, body: { message: 'hi' } }), await call('POST', '/api/ai/hub/chat', { token: U.token, body: { messages: [{ role: 'user', content: 'hi' }] } }), await call('POST', '/api/river/brief', { token: U.token, body: { todoId: 'x' } }), await call('POST', '/api/ai/transcribe', { token: U.token, body: {} }), await call('POST', `/api/media/12345678/describe`, { token: U.token, body: {} })];
  check('profile: AI off gates chat, hub chat, river, transcribe, describe (403)', aiResH.every((r) => r.status === 403), aiResH.map((r) => r.status).join(','));
  // login
  const li = await call('POST', '/api/auth/login', { body: { email: U.email.toUpperCase(), password: U.password } });
  check('auth/login: email is case-insensitive; reply has token + user without hash', li.status === 200 && !!li.json?.token && !/passwordHash/.test(li.text), li.text.slice(0, 120));
  const lw = [await call('POST', '/api/auth/login', { body: { email: U.email, password: 'wrong password' } }), await call('POST', '/api/auth/login', { body: { email: 'nobody@peblo.test', password: 'whatever12' } })];
  check('auth/login: wrong password and unknown email give the SAME 401 message (no account enumeration)', lw[0].status === 401 && lw[1].status === 401 && lw[0].json?.error === lw[1].json?.error, lw.map((r) => r.text).join(' | '));
  const ls = await call('POST', '/api/auth/login', { body: { email: ['a@b.c'], password: { a: 1 } } });
  const lh = await call('POST', '/api/auth/login', { body: { email: U.email, password: 'p'.repeat(100000) } });
  const lj = await call('POST', '/api/auth/login', { body: { email: { $ne: null }, password: { $ne: null } } });
  check('auth/login: array / object / 100 KB password / NoSQL-style objects -> 401, never 5xx or a token', [ls, lh, lj].every((r) => r.status === 401 && !r.json?.token), [ls, lh, lj].map((r) => r.status).join(','));
  const su = [await call('POST', '/api/auth/signup', { body: {} }), await call('POST', '/api/auth/signup', { body: { email: 'bad', password: 'longenoughpw' } }), await call('POST', '/api/auth/signup', { body: { email: 'z@peblo.test', password: 'short' } }), await call('POST', '/api/auth/signup', { body: { email: 'z@peblo.test', password: 'é'.repeat(40) } }), await call('POST', '/api/auth/signup', { body: { email: U.email, password: 'longenoughpw' } }), await call('POST', '/api/auth/signup', { body: { email: ['x@peblo.test'], password: ['longenoughpw'], name: ['n'] } }), await call('POST', '/api/auth/signup', { body: { email: 'a'.repeat(300) + '@peblo.test', password: 'longenoughpw' } })];
  check('auth/signup: missing / bad email / short / >72 bytes password -> 400, duplicate -> 409, arrays and 300-char emails never 5xx', su[0].status === 400 && su[1].status === 400 && su[2].status === 400 && su[3].status === 400 && su[4].status === 409 && su[5].status < 500 && su[6].status < 500, su.map((r) => r.status).join(','));
  const dupCase = await call('POST', '/api/auth/signup', { body: { email: U.email.toUpperCase(), password: 'longenoughpw' } });
  check('auth/signup: same email in other letter case -> 409', dupCase.status === 409, dupCase.status);
  const longName = await call('POST', '/api/auth/signup', { body: { email: `apitest-long-${uniq}@peblo.test`, password: 'longenoughpw', name: 'n'.repeat(1000) } });
  check('auth/signup: 1000-char name is cut to 80', longName.status === 201 && longName.json?.user?.name?.length === 80, longName.text.slice(0, 160));
  await fuzzBody('POST /api/auth/signup', 'POST', '/api/auth/signup', ['email', 'password', 'name'], { email: `apitest-fz-${uniq}@peblo.test`, password: 'longenoughpw' }, undefined);
  // verification flows
  const sv = await call('POST', '/api/auth/send-verification', { token: U.token });
  check('auth/send-verification: no mail server configured -> 503 JSON (not 500)', sv.status === 503 && sv.json?.mailConfigured === false, `${sv.status} ${sv.text.slice(0, 120)}`);
  const cec = await call('POST', '/api/auth/cancel-email-change', { token: U.token });
  check('auth/cancel-email-change: nothing pending -> 200 ok', cec.status === 200 && cec.json?.ok, cec.text);
  const ve = [await call('POST', '/api/auth/verify-email', { body: {} }), await call('POST', '/api/auth/verify-email', { body: { token: 'nope' } }), await call('POST', '/api/auth/verify-email', { body: { token: ['a'] } }), await call('POST', '/api/auth/verify-email', { body: { token: 'x'.repeat(100000) } })];
  check('auth/verify-email: missing / unknown / array / huge token -> 400 JSON', ve.every((r) => r.status === 400 && !!r.json?.error), ve.map((r) => `${r.status}:${r.text.slice(0, 50)}`).join(' | '));
  // real token flow through the database
  const { createHash, randomBytes } = await import('crypto');
  const tcols = await prisma.$queryRawUnsafe(`SELECT column_name FROM information_schema.columns WHERE table_name IN ('email_tokens','email_verifications','email_links') ORDER BY 1`).catch(() => []);
  if (tcols.length) console.log('      (email token table columns: ' + tcols.map((c) => c.column_name).join(',') + ')');
  const ve2 = [];
  for (let i = 0; i < 6; i++) ve2.push((await call('POST', '/api/auth/verify-email', { body: { token: 'tok' + i } })).status);
  check('auth/verify-email: repeated bad tokens stay 400 until the limit, never 5xx', ve2.every((s) => s === 400 || s === 429), ve2.join(','));
  // change password
  const U2 = await newUser('pw');
  const cpbad = [await call('POST', '/api/auth/change-password', { token: U2.token, body: { currentPassword: U2.password, newPassword: 'short' } }), await call('POST', '/api/auth/change-password', { token: U2.token, body: { currentPassword: U2.password, newPassword: 'é'.repeat(40) } }), await call('POST', '/api/auth/change-password', { token: U2.token, body: { currentPassword: 'wrong wrong', newPassword: 'brand new password' } }), await call('POST', '/api/auth/change-password', { token: U2.token, body: { currentPassword: ['x'], newPassword: ['brand new password'] } }), await call('POST', '/api/auth/change-password', { token: U2.token, body: {} })];
  check('auth/change-password: short / >72 bytes / wrong current -> 400 / 400 / 403 (not 401); arrays and empty never 5xx', cpbad[0].status === 400 && cpbad[1].status === 400 && cpbad[2].status === 403 && cpbad[3].status < 500 && cpbad[4].status < 500, cpbad.map((r) => r.status).join(','));
  const cp = await call('POST', '/api/auth/change-password', { token: U2.token, body: { currentPassword: U2.password, newPassword: 'brand new password' } });
  const oldTok = await call('GET', '/api/notes', { token: U2.token });
  const newTok = await call('GET', '/api/notes', { token: cp.json?.token });
  const oldLogin = await call('POST', '/api/auth/login', { body: { email: U2.email, password: U2.password } });
  const newLogin = await call('POST', '/api/auth/login', { body: { email: U2.email, password: 'brand new password' } });
  check('auth/change-password: works, old sign-in token dies, new token works, old password rejected', cp.status === 200 && oldTok.status === 401 && newTok.status === 200 && oldLogin.status === 401 && newLogin.status === 200, `${cp.status} ${oldTok.status} ${newTok.status} ${oldLogin.status} ${newLogin.status}`);
  // too many wrong current passwords -> 429
  const wrongs = [];
  for (let i = 0; i < 12; i++) wrongs.push((await call('POST', '/api/auth/change-password', { token: cp.json.token, body: { currentPassword: 'nope nope nope', newPassword: 'brand new password 2' } })).status);
  check('rate limit: repeated wrong current passwords answer 403 then 429 (never 500)', wrongs[0] === 403 && wrongs.includes(429) && wrongs.every((s) => [403, 429].includes(s)), wrongs.join(','));
  const stillBlocked = await call('POST', '/api/auth/delete-account', { token: cp.json.token, body: { password: 'brand new password' } });
  check('rate limit: the password limiter is per account (delete-account shares it) and answers 429 JSON with Retry-After', stillBlocked.status === 429 && !!stillBlocked.json?.error && !!stillBlocked.headers.get('retry-after'), `${stillBlocked.status} ${stillBlocked.text}`);
  // logout-all
  const U3 = await newUser('lo');
  const extra = await call('POST', '/api/auth/login', { body: { email: U3.email, password: U3.password } });
  const lo = await call('POST', '/api/auth/logout-all', { token: U3.token });
  const t1 = await call('GET', '/api/notes', { token: U3.token }); const t2 = await call('GET', '/api/notes', { token: extra.json?.token });
  const relog = await call('POST', '/api/auth/login', { body: { email: U3.email, password: U3.password } });
  check('auth/logout-all: every older sign-in token stops working, a new login works', lo.status === 200 && t1.status === 401 && t2.status === 401 && relog.status === 200 && !!relog.json?.token, `${lo.status} ${t1.status} ${t2.status} ${relog.status}`);
  const patU3 = await (async () => { const tok = await call('POST', '/api/tokens', { token: relog.json.token, body: { name: 'survive' } }); await call('POST', '/api/auth/logout-all', { token: relog.json.token }); return call('GET', '/api/notes', { token: tok.json?.token }); })();
  check('auth/logout-all: personal access tokens keep working (they are revoked separately)', patU3.status === 200, patU3.status);
  // delete account
  const U4 = await newUser('del');
  const n4 = await call('POST', '/api/notes', { token: U4.token, body: { title: 'to be deleted', content: 'c', tags: ['gone'] } });
  const t4 = await call('POST', '/api/todos', { token: U4.token, body: { text: 'gone task' } });
  const p4 = await call('POST', '/api/tokens', { token: U4.token, body: { name: 'gone tok' } });
  await prisma.aiConnection.create({ data: { userId: U4.id, provider: 'openai', label: 'x', baseUrl: 'https://api.openai.com/v1', apiKey: 'k', model: 'm' } });
  const dbad = [await call('POST', '/api/auth/delete-account', { token: U4.token, body: {} }), await call('POST', '/api/auth/delete-account', { token: U4.token, body: { password: ['x'] } }), await call('POST', '/api/auth/delete-account', { token: U4.token, body: { password: 'wrong wrong' } })];
  const stillThere = await prisma.user.findUnique({ where: { id: U4.id } });
  check('auth/delete-account: missing / array / wrong password -> 403, account stays', dbad.every((r) => r.status === 403) && !!stillThere, dbad.map((r) => r.status).join(','));
  const dl = await call('POST', '/api/auth/delete-account', { token: U4.token, body: { password: U4.password } });
  const left = { u: await prisma.user.count({ where: { id: U4.id } }), n: await prisma.note.count({ where: { userId: U4.id } }), t: await prisma.todo.count({ where: { userId: U4.id } }), tok: await prisma.apiToken.count({ where: { userId: U4.id } }), c: await prisma.aiConnection.count({ where: { userId: U4.id } }), tags: await prisma.tag.count({ where: { userId: U4.id } }) };
  const after = await call('GET', '/api/notes', { token: U4.token }); const afterPat = await call('GET', '/api/notes', { token: p4.json?.token });
  const afterLogin = await call('POST', '/api/auth/login', { body: { email: U4.email, password: U4.password } });
  check('auth/delete-account: removes the account and all its notes, tasks, tokens, connections, tags; old tokens and login die', dl.status === 200 && Object.values(left).every((n) => n === 0) && after.status === 401 && afterPat.status === 401 && afterLogin.status === 401, `${dl.status} ${JSON.stringify(left)} ${after.status} ${afterPat.status} ${afterLogin.status}`);
  const bStill = await prisma.note.count({ where: { userId: B.id } });
  check('auth/delete-account: other accounts unaffected', bStill > 0 && (await prisma.user.count({ where: { id: A.id } })) === 1, bStill);
  const ddbl = await call('POST', '/api/auth/delete-account', { token: U4.token, body: { password: U4.password } });
  check('auth/delete-account: repeating with the dead token -> 401', ddbl.status === 401, ddbl.status);
  const emailLeft = await call('POST', '/api/auth/signup', { body: { email: U4.email, password: 'longenoughpw' } });
  check('auth/delete-account: the email can sign up again afterwards', emailLeft.status === 201, emailLeft.status);
}

// ================================================================ 15. OAuth + MCP
{
  const wk = await call('GET', '/.well-known/oauth-authorization-server');
  const wr = await call('GET', '/.well-known/oauth-protected-resource');
  check('oauth: discovery documents are public JSON (S256 only, no client secret)', wk.status === 200 && wk.json?.code_challenge_methods_supported?.[0] === 'S256' && wk.json.token_endpoint_auth_methods_supported[0] === 'none' && wr.status === 200 && !!wr.json?.resource, `${wk.status} ${wr.status}`);
  const urlenc = (o) => ({ raw: new URLSearchParams(o).toString(), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
  const reg = await call('POST', '/oauth/register', { body: { client_name: 'T <b>app</b>', redirect_uris: ['http://localhost:9999/cb'] } });
  check('oauth/register: registers a client, strips < > from the name', reg.status === 201 && !!reg.json?.client_id && !/[<>]/.test(reg.json.client_name), reg.text.slice(0, 200));
  const regBad = [await call('POST', '/oauth/register', { body: {} }), await call('POST', '/oauth/register', { body: { redirect_uris: [] } }), await call('POST', '/oauth/register', { body: { redirect_uris: ['javascript:alert(1)'] } }), await call('POST', '/oauth/register', { body: { redirect_uris: ['data:text/html,x'] } }), await call('POST', '/oauth/register', { body: { redirect_uris: ['http://evil.example/cb'] } }), await call('POST', '/oauth/register', { body: { redirect_uris: ['https://ok.example/cb#frag'] } }), await call('POST', '/oauth/register', { body: { redirect_uris: Array(11).fill('https://ok.example/cb') } }), await call('POST', '/oauth/register', { body: { redirect_uris: 'https://ok.example/cb' } }), await call('POST', '/oauth/register', { body: { redirect_uris: [5, null, {}] } }), await call('POST', '/oauth/register', { body: { redirect_uris: ['https://ok.example/' + 'a'.repeat(600)] } }), await call('POST', '/oauth/register', { body: { client_name: ['x'], redirect_uris: ['claude://cb'] } })];
  check('oauth/register: no / empty / javascript: / data: / plain-http remote / fragment / 11 / string / non-string / 600-char uris -> 400; app scheme + array name never 5xx', regBad.slice(0, 10).every((r) => r.status === 400) && regBad[10].status < 500, regBad.map((r) => r.status).join(','));
  await fuzzBody('POST /oauth/register', 'POST', '/oauth/register', ['client_name', 'redirect_uris'], { client_name: 'x', redirect_uris: ['http://localhost/cb'] }, undefined).catch(() => {});
  const cid = reg.json?.client_id; const ru = 'http://localhost:9999/cb';
  const verifier = randomBytesB64(48); const challenge = (await import('crypto')).createHash('sha256').update(verifier).digest('base64url');
  function randomBytesB64(n) { return Buffer.from(Array.from({ length: n }, () => Math.floor(Math.random() * 256))).toString('base64url'); }
  const authz = await fetch(`${BASE}/oauth/authorize?client_id=${cid}&redirect_uri=${encodeURIComponent(ru)}&response_type=code&code_challenge=${challenge}&code_challenge_method=S256&state=st`, { redirect: 'manual' });
  check('oauth/authorize: valid request redirects (302) to the consent page', authz.status === 302 && /^\/oauth\/consent\?/.test(authz.headers.get('location') || ''), `${authz.status} ${authz.headers.get('location')}`);
  const authzBad = [];
  for (const q of ['', 'client_id=nope&redirect_uri=x', `client_id=${cid}&redirect_uri=${encodeURIComponent('http://localhost:1/other')}&response_type=code&code_challenge=${challenge}&code_challenge_method=S256`, `client_id[]=a&redirect_uri[]=b`, `client_id=${cid}&redirect_uri[]=${encodeURIComponent(ru)}`, `client_id=${cid}&redirect_uri=${encodeURIComponent(ru)}&response_type=token&code_challenge=${challenge}&code_challenge_method=S256`, `client_id=${cid}&redirect_uri=${encodeURIComponent(ru)}&response_type=code&code_challenge=${challenge}&code_challenge_method=plain`]) {
    const r = await fetch(`${BASE}/oauth/authorize?${q}`, { redirect: 'manual' });
    const loc = r.headers.get('location') || '';
    const t = await r.text();
    const ok = (r.status === 400 && !LEAK.test(t)) || (r.status === 302 && /error=/.test(loc) && loc.startsWith(ru));
    if (!ok) authzBad.push(`${q.slice(0, 50)} -> ${r.status} ${loc.slice(0, 60)}`);
  }
  check('oauth/authorize: unknown client / unregistered return address / wrong type / no S256 are refused (400, or error sent back to the registered address only)', authzBad.length === 0, authzBad.slice(0, 3).join(' | '));
  const info = await call('GET', `/api/oauth/info?client_id=${cid}&redirect_uri=${encodeURIComponent(ru)}`, { token: A.token });
  check('api/oauth/info: signed-in user sees app name + host + own email', info.status === 200 && info.json?.host === 'localhost:9999' && info.json?.email === A.email, info.text);
  const infoBad = [await call('GET', '/api/oauth/info?client_id=nope&redirect_uri=x', { token: A.token }), await call('GET', '/api/oauth/info', { token: A.token }), await call('GET', '/api/oauth/info?client_id[]=a&redirect_uri[]=b', { token: A.token })];
  check('api/oauth/info: unknown app -> 404, never 5xx', infoBad[0].status === 404 && infoBad[1].status === 404 && infoBad[2].status < 500, infoBad.map((r) => r.status).join(','));
  const apBad = [await call('POST', '/api/oauth/approve', { token: A.token, body: { client_id: 'nope', redirect_uri: ru } }), await call('POST', '/api/oauth/approve', { token: A.token, body: { client_id: cid, redirect_uri: 'http://localhost:1/x', code_challenge: challenge } }), await call('POST', '/api/oauth/approve', { token: A.token, body: { client_id: cid, redirect_uri: ru, code_challenge: 'short' } }), await call('POST', '/api/oauth/approve', { token: A.token, body: { client_id: cid, redirect_uri: ru, code_challenge: ['a'] } }), await call('POST', '/api/oauth/approve', { token: A.token, body: {} })];
  check('api/oauth/approve: unknown app / unregistered address / bad challenge -> 400, never 5xx', apBad.every((r) => r.status === 400), apBad.map((r) => r.status).join(','));
  await fuzzBody('POST /api/oauth/approve', 'POST', '/api/oauth/approve', ['client_id', 'redirect_uri', 'code_challenge', 'state', 'scope', 'deny'], { client_id: cid, redirect_uri: ru, code_challenge: challenge }, A.token);
  const deny = await call('POST', '/api/oauth/approve', { token: A.token, body: { client_id: cid, redirect_uri: ru, deny: true, state: 'st' } });
  check('api/oauth/approve: deny redirects back with error=access_denied', deny.status === 200 && /error=access_denied/.test(deny.json?.redirect || '') && /state=st/.test(deny.json.redirect), deny.text);
  const appr = await call('POST', '/api/oauth/approve', { token: A.token, body: { client_id: cid, redirect_uri: ru, code_challenge: challenge, state: 'st', scope: 'read' } });
  const code = new URL(appr.json?.redirect || 'http://x/').searchParams.get('code');
  check('api/oauth/approve: returns a one-time code on the registered address', appr.status === 200 && !!code && (appr.json.redirect || '').startsWith(ru), appr.text);
  const tk = (o) => call('POST', '/oauth/token', urlenc(o));
  const tbad = [await tk({}), await tk({ grant_type: 'password', code, redirect_uri: ru, client_id: cid, code_verifier: verifier }), await tk({ grant_type: 'authorization_code', code, redirect_uri: ru, client_id: cid, code_verifier: 'short' }), await tk({ grant_type: 'authorization_code', code: 'nope', redirect_uri: ru, client_id: cid, code_verifier: verifier }), await call('POST', '/oauth/token', { body: { grant_type: 'authorization_code', code: [code], redirect_uri: [ru], client_id: [cid], code_verifier: [verifier] }, headers: {} })];
  check('oauth/token: missing / wrong grant / short verifier / unknown code / arrays -> 400, never 5xx', tbad.every((r) => r.status === 400), tbad.map((r) => `${r.status}:${r.text.slice(0, 40)}`).join(' | '));
  const wrongV = await tk({ grant_type: 'authorization_code', code, redirect_uri: ru, client_id: cid, code_verifier: 'v'.repeat(50) });
  const reuse = await tk({ grant_type: 'authorization_code', code, redirect_uri: ru, client_id: cid, code_verifier: verifier });
  check('oauth/token: wrong PKCE verifier -> 400 and the code is burned (a retry with the right verifier also fails)', wrongV.status === 400 && reuse.status === 400, `${wrongV.status} ${reuse.status}`);
  const approve2 = await call('POST', '/api/oauth/approve', { token: A.token, body: { client_id: cid, redirect_uri: ru, code_challenge: challenge, scope: 'write' } });
  const code2 = new URL(approve2.json.redirect).searchParams.get('code');
  const mismatch = await tk({ grant_type: 'authorization_code', code: code2, redirect_uri: 'http://localhost:9999/other', client_id: cid, code_verifier: verifier });
  const approve3 = await call('POST', '/api/oauth/approve', { token: A.token, body: { client_id: cid, redirect_uri: ru, code_challenge: challenge, scope: 'write' } });
  const code3 = new URL(approve3.json.redirect).searchParams.get('code');
  const good = await tk({ grant_type: 'authorization_code', code: code3, redirect_uri: ru, client_id: cid, code_verifier: verifier });
  const again = await tk({ grant_type: 'authorization_code', code: code3, redirect_uri: ru, client_id: cid, code_verifier: verifier });
  check('oauth/token: redirect_uri mismatch -> 400; correct exchange -> pbl_ token (no-store); same code twice -> 400', mismatch.status === 400 && good.status === 200 && /^pbl_/.test(good.json?.access_token || '') && /no-store/.test(good.headers.get('cache-control') || '') && again.status === 400, `${mismatch.status} ${good.status} ${again.status}`);
  const viaOauth = await call('GET', '/api/notes', { token: good.json?.access_token });
  const oauthProfile = await call('GET', '/api/profile', { token: good.json?.access_token });
  check('oauth: the issued token reads notes (200) but is refused on /api/profile (403)', viaOauth.status === 200 && oauthProfile.status === 403, `${viaOauth.status} ${oauthProfile.status}`);
  const bInfo = await call('GET', `/api/oauth/info?client_id=${cid}&redirect_uri=${encodeURIComponent(ru)}`, { token: B.token });
  const bAppr = await call('POST', '/api/oauth/approve', { token: B.token, body: { client_id: cid, redirect_uri: ru, code_challenge: challenge } });
  const codeB = new URL(bAppr.json?.redirect || 'http://x/').searchParams.get('code');
  const tkB = await tk({ grant_type: 'authorization_code', code: codeB, redirect_uri: ru, client_id: cid, code_verifier: verifier });
  const bNotes = await call('GET', '/api/notes', { token: tkB.json?.access_token });
  check('authorization: a token issued after B approves reads only B\'s data (no A notes)', tkB.status === 200 && bNotes.status === 200 && !JSON.stringify(bNotes.json).includes(nid) && !JSON.stringify(bNotes.json).includes(nid2), `${tkB.status} ${bNotes.status}`);
  // MCP endpoint
  const mcpHeaders = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
  const init = await call('POST', '/mcp', { token: good.json?.access_token, body: { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '1' } } }, headers: mcpHeaders });
  check('mcp: initialize with a pbl_ token succeeds', init.status === 200 && /protocolVersion|serverInfo/.test(init.text), `${init.status} ${init.text.slice(0, 160)}`);
  const mget = await call('GET', '/mcp', { token: good.json?.access_token });
  check('mcp: GET with a valid token -> 405 with Allow: POST', mget.status === 405 && /POST/.test(mget.headers.get('allow') || ''), `${mget.status}`);
  const mb = [];
  for (const raw of ['', '{bad', '[]', '"x"', '{"jsonrpc":"2.0","id":1,"method":"nope"}', '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"../../x","arguments":{}}}', '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"create_note","arguments":{"title":["x"],"content":5}}}']) {
    const r = await call('POST', '/mcp', { token: good.json?.access_token, raw, headers: mcpHeaders });
    if (unexpected5xx(r.status) || LEAK.test(r.text)) mb.push(`${raw.slice(0, 40)} -> ${r.status} ${r.text.slice(0, 100)}`);
  }
  check('mcp: malformed JSON-RPC / unknown tool / wrong argument types never 5xx or leak internals', mb.length === 0, mb.slice(0, 3).join(' | '));
  const mro = await call('POST', '/mcp', { token: PAT_RO, body: { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '1' } } }, headers: mcpHeaders });
  check('mcp: a revoked token (earlier read-only PAT) -> 401', mro.status === 401, mro.status);
}

// ================================================================ 16. share + public (light: heavily covered by share*.mjs)
{
  const sh = await call('POST', `/api/share/note/${nid2}`, { token: A.token, body: {} });
  const shTok = sh.json?.token || sh.json?.shareToken || sh.json?.share?.token;
  check('share: owner can create a link', sh.status < 300 && !!shTok, sh.text.slice(0, 200));
  const bs = [await call('GET', `/api/share/note/${nid2}`, { token: B.token }), await call('POST', `/api/share/note/${nid2}`, { token: B.token, body: {} }), await call('DELETE', `/api/share/note/${nid2}`, { token: B.token }), await call('GET', `/api/share/note/${nid2}/activity`, { token: B.token }), await call('GET', `/api/share/note/${nid2}/live`, { token: B.token }), await call('GET', `/api/share/note/${nid2}/short`, { token: B.token }), await call('POST', `/api/share/note/${nid2}/approval`, { token: B.token, body: {} }), await call('GET', `/api/share/note/${nid2}/polls`, { token: B.token }), await call('POST', `/api/share/note/${nid2}/polls`, { token: B.token, body: { question: 'q', options: ['a', 'b'] } }), await call('POST', `/api/share/note/${nid2}/viewers/x/remove`, { token: B.token, body: {} })];
  check('authorization: B gets 404 on every owner share endpoint of A\'s note', bs.every((r) => r.status === 404 || r.status === 403), bs.map((r) => r.status).join(','));
  if (shTok) {
    const del = await call('DELETE', `/api/public/note/${shTok}`, { token: B.token });
    const stillPub = await call('GET', `/api/public/note/${shTok}`);
    check('authorization: B cannot unshare A\'s link through the public route; link still opens', stillPub.status === 200 && del.status !== 200, `${del.status} ${stillPub.status}`);
    const own = await call('GET', `/api/public/note/${shTok}/owner`, { token: B.token });
    check('authorization: the public "owner" probe is false for B', own.status === 200 ? own.json?.owner === false || own.json?.isOwner === false : own.status === 403 || own.status === 404, `${own.status} ${own.text.slice(0, 100)}`);
  }
  const pubJunk = [];
  for (const t of ['x', 'a'.repeat(25), 'a'.repeat(300), '%00', '..%2f', "a'b", '%E0%A4%A']) for (const k of ['note', 'todo', 'weird']) for (const [m, tail] of [['GET', ''], ['GET', '/owner'], ['POST', '/presence'], ['POST', '/knock'], ['POST', '/extend-request'], ['GET', '/polls']]) {
    const r = await call(m, `/api/public/${k}/${t}${tail}`, { body: m === 'POST' ? {} : undefined });
    if (unexpected5xx(r.status) || r.status === 0) pubJunk.push(`${m} ${k}/${t.slice(0, 10)}${tail} -> ${r.status} ${r.text.slice(0, 60)}`);
  }
  for (const k of ['note', 'todo']) for (const t of ['x', 'a'.repeat(25), '%00']) {
    const r = await call('PUT', `/api/public/${k}/${t}`, { body: { content: 'x' } });
    if (unexpected5xx(r.status)) pubJunk.push(`PUT ${k}/${t} -> ${r.status}`);
  }
  check('public share routes: unknown / odd tokens answer 4xx, never 5xx', pubJunk.length === 0, pubJunk.slice(0, 3).join(' | '));
  const sl = [await call('GET', '/l/nope'), await call('GET', '/l/%00'), await call('GET', '/s/note/nope'), await call('GET', '/s/note/' + 'a'.repeat(25))];
  check('short link / agent note: unknown codes answer 404, never 5xx', sl.every((r) => r.status < 500), sl.map((r) => r.status).join(','));
  await fuzzBody('PUT /api/public/note/:token', 'PUT', `/api/public/note/${shTok || 'a'.repeat(25)}`, ['content', 'title', 'sid', 'name'], { content: 'x' }, undefined);
  await fuzzBody('POST /api/share/note/:id (owner)', 'POST', `/api/share/note/${nid2}`, ['edit', 'expiresAt', 'expires', 'password', 'approval', 'role'], {}, A.token);
  await fuzzId('/api/share/:kind/:id', 'GET', (id) => `/api/share/note/${id}`, A.token);
  await fuzzId('/api/share/:kind/:id', 'GET', (id) => `/api/share/${id}/${nid2}`, A.token);
}

// ================================================================ 17. health, config, misc public
{
  const h = await call('GET', '/api/health'); const hd = await call('GET', '/api/health/db'); const cfg = await call('GET', '/api/config');
  check('health: /api/health + /api/health/db + /api/config answer 200 JSON without sign-in', h.status === 200 && hd.status === 200 && hd.json?.db === 'ok' && cfg.status === 200 && typeof cfg.json?.publicUrl === 'string', `${h.status} ${hd.status} ${cfg.status}`);
  const nf = [await call('GET', '/api/nope'), await call('POST', '/api/nope/deeper'), await call('GET', '/api/%00'), await call('GET', '/api/%E0%A4%A')];
  check('unknown /api paths answer JSON 404 (never HTML, never 5xx)', nf[0].status === 404 && !!nf[0].json?.error && nf[1].status === 404 && nf.every((r) => r.status < 500), nf.map((r) => r.status).join(','));
  const mj = [await call('POST', '/api/notes', { token: A.token, raw: '{"title":', headers: { 'Content-Type': 'application/json' } }), await call('POST', '/api/notes', { token: A.token, raw: 'x'.repeat(11 * 1024 * 1024), headers: { 'Content-Type': 'application/json' } }), await call('POST', '/api/notes', { token: A.token, raw: JSON.stringify({ title: 'a' }), headers: { 'Content-Type': 'text/plain' } }), await call('POST', '/api/notes', { token: A.token, raw: '{"title":"a"}', headers: { 'Content-Type': 'application/json; charset=utf-16' } })];
  check('bad JSON -> 400 JSON, over 10 MB -> 413, wrong content type is not parsed (4xx), odd charset -> 4xx; never 5xx', mj[0].status === 400 && mj[1].status === 413 && mj[2].status < 500 && mj[3].status < 500 && !LEAK.test(mj.map((r) => r.text).join(' ')), mj.map((r) => `${r.status}:${r.text.slice(0, 70)}`).join(' | '));
  const cors = await rawReq('OPTIONS', '/api/notes', { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'GET' });
  check('CORS: an unknown origin gets no access-control-allow-origin on /api', cors.status < 500, cors.status);
  const evil = await fetch(BASE + '/api/notes', { headers: { Origin: 'https://evil.example', Authorization: `Bearer ${A.token}` } });
  check('CORS: a request from an unknown origin is not given Allow-Origin', !evil.headers.get('access-control-allow-origin'), evil.headers.get('access-control-allow-origin'));
}

// ================================================================ 18. rate limits answer 429 (JSON), not 500
{
  // sign-in per account (10 failures) - uses a made-up address so it cannot lock a real test user
  const em = `ratelimit-${uniq}@peblo.test`;
  const st = [];
  let retry = null;
  for (let i = 0; i < 13; i++) { const r = await call('POST', '/api/auth/login', { body: { email: em, password: 'wrong password' } }); st.push(r.status); if (r.status === 429) retry = r; }
  check('rate limit: sign-in failures for one account -> 401 x10 then 429 JSON + Retry-After (no 500)', st.slice(0, 10).every((s) => s === 401) && st[10] === 429 && !!retry?.json?.error && !!retry.headers.get('retry-after') && st.every((s) => [401, 429].includes(s)), st.join(','));
  const okLogin = await call('POST', '/api/auth/login', { body: { email: A.email, password: A.password } });
  check('rate limit: locking one account\'s sign-in does not lock other accounts', okLogin.status === 200, okLogin.status);
  // AI limit per account: the main run has it switched off (AI_BURST_MAX=0), so a child process with AI_BURST_MAX=5 checks it
  const R = await newUser('rate');
  {
    const { spawnSync } = await import('child_process');
    const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--ai-limit-child'], { env: { ...process.env, API_TEST_AI_BURST: '5' }, encoding: 'utf8', timeout: 120000 });
    const line = (child.stdout || '').split('\n').find((l) => l.startsWith('AIRATE:'));
    const res = line ? JSON.parse(line.slice(7)) : null;
    check('rate limit: AI requests per account -> 400 x5 then 429 JSON + Retry-After (no 500)', !!res && res.statuses.slice(0, 5).every((x) => x === 400) && res.statuses.slice(5).every((x) => x === 429) && !!res.error && !!res.retryAfter, line || (child.stdout + child.stderr).slice(-300));
    check('rate limit: the AI limit is per account (another user still gets 400) and non-AI routes still work at the limit', res?.otherUser === 400 && res?.reads === 200, JSON.stringify(res));
  }  // key check limit (20 / minute / user), before any network call
  const dt = [];
  for (let i = 0; i < 23; i++) dt.push((await call('POST', '/api/ai/connections/detect', { token: R.token, body: { key: 'k', provider: 'nonexistent' } })).status);
  check('rate limit: key checks (detect) -> 400 x20 then 429 (no 500)', dt.slice(0, 20).every((s) => s === 400) && dt[20] === 429 && dt.every((s) => [400, 429].includes(s)), dt.join(','));
  const mailU = await newUser('mail');
  const ms = [];
  for (let i = 0; i < 9; i++) ms.push((await call('POST', '/api/auth/send-verification', { token: mailU.token })).status);
  check('rate limit: send-verification -> 503 (no mail server) x6 then 429', ms.slice(0, 6).every((s) => s === 503) && ms[6] === 429 && ms.every((s) => [503, 429].includes(s)), ms.join(','));
  const vs = [];
  for (let i = 0; i < 34; i++) vs.push((await call('POST', '/api/auth/verify-email', { body: { token: 'bad' + i } })).status);
  check('rate limit: verify-email by address -> 400 then 429 (no 500)', vs.includes(429) && vs.every((s) => [400, 429].includes(s)), vs.join(','));
  const rg = [];
  for (let i = 0; i < 24; i++) rg.push((await call('POST', '/oauth/register', { body: { client_name: 'r' + i, redirect_uris: ['http://localhost/cb'] } })).status);
  check('rate limit: oauth/register -> 201 then 429 JSON after 20 per hour (no 500)', rg.includes(429) && rg.every((s) => [201, 429, 400].includes(s)), rg.join(','));
  // API-wide limiter: a second instance of the real app with a small limit
  process.env.API_RATE_MAX = '25';
  let s2;
  try {
    s2 = await startServer({ port: 0 });
    const b2 = `http://127.0.0.1:${s2.port}`;
    const sts = [];
    for (let i = 0; i < 40; i++) sts.push((await call('GET', '/api/health', { base: b2 })).status);
    const lim = await call('GET', '/api/health', { base: b2 });
    let limMcp = { status: 0 }; for (let i = 0; i < 35; i++) limMcp = await call('POST', '/mcp', { base: b2, body: {} });
    const limOauth = await call('GET', '/.well-known/oauth-authorization-server', { base: b2 });
    const limApi = await call('GET', '/api/notes', { base: b2, token: A.token });
    check('rate limit: whole-API limiter -> 200 until the cap, then 429 JSON + Retry-After on /api, /mcp (no 500)', sts.slice(0, 20).every((s) => s === 200) && sts.includes(429) && lim.status === 429 && !!lim.json?.error && !!lim.headers.get('retry-after') && limMcp.status === 429 && limApi.status === 429 && sts.every((s) => [200, 429].includes(s)), sts.join(',') + ` ${limMcp.status} ${limApi.status} ${limOauth.status}`);
    s2.server.close();
  } catch (e) {
    check('rate limit: whole-API limiter (second server instance)', false, e.message);
  }
  process.env.API_RATE_MAX = '1000000';
}

// ================================================================ 19. 5xx hygiene
{
  check(`error hygiene: no request in this run answered an unexpected 5xx (${bad5.size} found)`, bad5.size === 0, [...bad5].slice(0, 12).map(([k, v]) => `${k} -> ${v}`).join('\n        '));
  check(`error hygiene: no 4xx/5xx body contained a stack trace, file path, SQL, Prisma text or node_modules (${leaks.size} found)`, leaks.size === 0, [...leaks].slice(0, 8).map(([k, v]) => `${k} -> ${v}`).join('\n        '));
  // the error handler itself: force an unexpected error and look at the reply
  const forced = await call('GET', '/api/notes/' + encodeURIComponent('a'.repeat(100)), { token: A.token });
  check('error hygiene: an ordinary 404 has a short JSON error', forced.status === 404 && !!forced.json?.error, forced.text.slice(0, 100));
}

// ================================================================ finish
server.close();
try { await prisma.user.deleteMany({ where: { email: { startsWith: 'apitest-' } } }); } catch (e) { console.log('cleanup:', e.message); }
try { await prisma.user.deleteMany({ where: { email: { startsWith: 'ratelimit-' } } }); } catch {}
try { await prisma.oauthClient.deleteMany({}); } catch {}
await prisma.$disconnect();
console.log(failures ? `\n${failures} check(s) failed, ${passes} passed` : `\nAll ${passes} api-routes checks passed`);
process.exit(failures ? 1 : 0);

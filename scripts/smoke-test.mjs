// Starts the compiled server against the MySQL database in server/.env and exercises the main API routes
// with a throwaway account (created at the start, deleted at the end).
// Usage: npm test      (or: npm run build:server && node scripts/smoke-test.mjs)
import path from 'path';
import dotenv from 'dotenv';
import { pathToFileURL } from 'url';

dotenv.config({ path: path.resolve('server/.env') });
if (!process.env.DATABASE_URL) { console.error('DATABASE_URL is not set (server/.env).'); process.exit(1); }
process.env.PEBLO_SQL_DIR = path.resolve('server/prisma/sql');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'smoke-test-secret-smoke-test-secret';
process.env.TRUST_PROXY = '1'; // as behind a proxy: lets the test fake client addresses (PEB-63)
process.env.SIGNUP_RATE_MAX = '1000'; // the test makes several accounts; the sign-in limit is still tested
delete process.env.OPENAI_API_KEY;
delete process.env.GEMINI_API_KEY;
delete process.env.GEMINI_API_KEYS;

const { startServer } = await import(pathToFileURL(path.resolve('dist/server/index.js')).href);
const { server, port } = await startServer({ port: 0, staticDir: path.resolve('client/dist') });
const base = `http://127.0.0.1:${port}`;

let failures = 0;
let token = null;
const runId = Date.now();
const emailA = `smoke-a-${runId}@peblo.test`;
const emailB = `smoke-b-${runId}@peblo.test`;
const emailC = `smoke-c-${runId}@peblo.test`;
const emailD = `smoke-d-${runId}@peblo.test`;
// Requests to our own server carry the current account's sign-in token (also the raw fetch() calls below).
const rawFetch = globalThis.fetch;
globalThis.fetch = (u, o = {}) => (token && String(u).startsWith(base)
  ? rawFetch(u, { ...o, headers: { Authorization: `Bearer ${token}`, ...(o.headers || {}) } })
  : rawFetch(u, o));
async function call(method, url, body) {
  const res = await fetch(base + url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, json };
}
function check(name, cond, extra) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`);
  if (!cond) { failures++; if (extra !== undefined) console.log('      ', JSON.stringify(extra).slice(0, 400)); }
}

try {
  let r = await call('GET', '/api/health');
  check('health', r.status === 200, r.json);

  r = await call('GET', '/api/profile');
  check('profile needs a sign-in', r.status === 401, r);

  r = await call('POST', '/api/auth/signup', { email: emailA, password: 'correct horse battery', name: 'Smoke A' });
  check('sign up', r.status === 201 && !!r.json.token && r.json.user.email === emailA, r.json);
  token = r.json.token;
  const userAId = r.json.user?.id;

  r = await call('POST', '/api/auth/signup', { email: emailA.toUpperCase(), password: 'correct horse battery' });
  check('duplicate email is refused (any case)', r.status === 409, r.json);
  r = await call('POST', '/api/auth/signup', { email: 'nope', password: 'correct horse battery' });
  check('invalid email is refused', r.status === 400, r.json);
  r = await call('POST', '/api/auth/login', { email: emailA, password: 'wrong password' });
  check('wrong password is refused', r.status === 401, r.json);

  r = await call('GET', '/api/profile');
  check('profile loads when signed in', r.status === 200 && r.json.user?.id === userAId, r.json);

  r = await call('PUT', '/api/profile', { name: 'Tejas', settings: { fontSize: 'large', geminiKey: 'test-key' } });
  check('profile update + key saved', r.status === 200 && r.json.user.name === 'Tejas' && r.json.user.settings.fontSize === 'large' && !!r.json.user.settings.geminiKey, r.json);
  check('the saved key is returned masked, never in plain text (PEB-59)', r.json.user.settings.geminiKey.endsWith('-key') && !r.json.user.settings.geminiKey.includes('test') && r.json.user.settings.geminiKey.startsWith('•'), r.json.user.settings.geminiKey);
  const maskedKey = r.json.user.settings.geminiKey;
  r = await call('PUT', '/api/profile', { settings: { geminiKey: maskedKey, fontSize: 'large' } });
  const { default: prisma0 } = await import(pathToFileURL(path.resolve('dist/server/db.js')).href);
  const keptRow = await prisma0.userApiKeys.findUnique({ where: { userId: userAId } });
  check('saving the mask back keeps the stored key', r.status === 200 && !!keptRow?.geminiKey && keptRow.geminiKey.startsWith('enc:v1:'), keptRow);
  r = await call('GET', '/api/profile');
  check('GET /api/profile never contains the plain key', !JSON.stringify(r.json).includes('test-key'), r.json.user.settings);

  // API keys are encrypted at rest and kept out of the settings JSON.
  const { default: prisma } = await import(pathToFileURL(path.resolve('dist/server/db.js')).href);
  const keyRow = await prisma.userApiKeys.findUnique({ where: { userId: userAId } });
  const userRow = await prisma.user.findUnique({ where: { id: userAId } });
  check('API key is encrypted in the database', !!keyRow?.geminiKey && keyRow.geminiKey.startsWith('enc:v1:') && !keyRow.geminiKey.includes('test-key'), keyRow);
  check('API key is not duplicated in the settings JSON', userRow.settings.geminiKey === undefined && userRow.settings.fontSize === 'large', userRow.settings);

  // PEB-58: a key saved under another install's secret is reported, not silently treated as "no key"
  {
    process.env.KEY_ENCRYPTION_SECRET = 'another-install-secret-another-install-secret';
    try {
      const p = await call('GET', '/api/profile');
      check('unreadable key: profile lists it and sends no key', p.status === 200 && p.json.user.settings.unreadableKeys?.includes('geminiKey') && p.json.user.settings.geminiKey === undefined, p.json.user?.settings);
      const m = await call('GET', '/api/ai/hub/models');
      const g = (m.json.cloud || []).find((c) => c.provider === 'gemini');
      check('unreadable key: models endpoint flags it', m.status === 200 && g?.unreadable === true && g?.configured === false, m.json.cloud);
      const c = await call('POST', '/api/ai/chat', { message: 'make a note about tides' });
      check('unreadable key: AI says the key cannot be read (not "no AI set up")', c.status === 400 && /can't be read/.test(c.json?.error || '') && !/No AI set up/.test(c.json?.error || ''), c.json);
    } finally {
      delete process.env.KEY_ENCRYPTION_SECRET;
    }
    const ok = await call('GET', '/api/profile');
    check('with the right secret the key reads again and nothing is flagged', ok.json.user.settings.geminiKey?.startsWith('•') && !ok.json.user.settings.unreadableKeys, ok.json.user?.settings);
  }

  r = await call('PUT', '/api/profile', { email: 'not-an-email' });
  check('profile rejects an invalid email', r.status === 400, r.json);

  r = await call('POST', '/api/notes', { title: 'First note', content: 'Hello desktop', tags: ['Work', 'ideas'], category: 'Personal' });
  check('create note', r.status === 201 && r.json.note.tags.length === 2, r.json);
  const noteId = r.json.note?.id;

  r = await call('PATCH', `/api/notes/${noteId}`, { content: 'Hello desktop app', tags: ['work'] });
  check('update note', r.status === 200, r.json);

  r = await call('GET', '/api/notes?search=DESKTOP');
  check('search is case-insensitive', r.status === 200 && r.json.notes.length === 1, r.json);

  r = await call('GET', '/api/notes?tag=work');
  check('filter by tag', r.status === 200 && r.json.notes.length === 1, r.json);

  r = await call('GET', `/api/notes/${noteId}/backups`);
  check('backups list', r.status === 200 && Array.isArray(r.json.backups), r.json);

  const today = new Date(); today.setHours(12, 0, 0, 0);
  r = await call('POST', '/api/todos', { text: 'Ship desktop build', priority: 'high', deadline: today.toISOString(), tags: ['release'], noteId });
  check('create todo (json tags)', r.status === 201 && Array.isArray(r.json.todo.todoTags) && r.json.todo.todoTags[0] === 'release', r.json);
  const todoId = r.json.todo?.id;

  r = await call('POST', '/api/todos', { text: 'Daily standup', deadline: today.toISOString(), recurrence: 'daily' });
  check('create recurring todo', r.status === 201, r.json);

  r = await call('GET', '/api/todos/today');
  check('today todos', r.status === 200 && r.json.todayTasks.length >= 2, r.json);

  const from = new Date(today); from.setDate(1);
  const to = new Date(today); to.setMonth(to.getMonth() + 2);
  r = await call('GET', `/api/todos/range?from=${from.toISOString()}&to=${to.toISOString()}`);
  check('todo range (calendar)', r.status === 200 && r.json.todos.length > 5, r.json.todos?.length);

  r = await call('PATCH', `/api/todos/${todoId}`, { completed: true });
  check('complete todo', r.status === 200 && r.json.todo.completed === true, r.json);

  r = await call('GET', '/api/dashboard/insights');
  check('dashboard insights', r.status === 200 && r.json.totalNotes === 1 && r.json.openTasks >= 1 && r.json.topTags[0]?.name === 'work', r.json);

  r = await call('GET', '/api/dashboard/daily-briefing');
  check('daily briefing', r.status === 200 && typeof r.json.stats.totalActive === 'number', r.json);

  r = await call('GET', '/api/dashboard/weekly-report');
  check('weekly report', r.status === 200 && r.json.dailyBreakdown.length === 7 && r.json.stats.tasksCompleted === 1, r.json);

  r = await call('PUT', '/api/profile', { settings: { geminiKey: '', openAiKey: '' } });
  r = await call('POST', `/api/notes/${noteId}/ai/title`, { content: 'x' });
  check('AI without key gives a clear answer (no crash)', r.status < 500 || /Connections/.test(JSON.stringify(r.json)), r);

  r = await call('DELETE', `/api/notes/${noteId}`);
  check('move note to trash', r.status === 200, r.json);
  r = await call('POST', `/api/notes/${noteId}/restore`);
  check('restore note', r.status === 200, r.json);

  // ── More than 50 notes all come back (sidebar used to stop at 50) ──
  for (let i = 0; i < 55; i++) await call('POST', '/api/notes', { title: `Bulk ${i}`, content: 'x' });
  r = await call('GET', '/api/notes');
  check('notes list is not capped at 50', r.status === 200 && r.json.notes.length >= 56, r.json.notes?.length);

  // ── Notion import: nested zip, properties, CSV database with _all variant, image, page link ──
  const { default: AdmZip } = await import('adm-zip');
  const inner = new AdmZip();
  inner.addFile('Workspace/Trip plan 0123456789abcdef0123456789abcdef.md', Buffer.from(
    '# Trip plan\n\nTags: Travel, Summer\nCreated: March 3, 2025 10:00 AM\nStatus: Planning\n\nBook flights.\n\n![map](Trip%20plan/map.png)\n\nSee [Packing list](Packing%20list%20aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.md).\n'));
  inner.addFile('Workspace/Trip plan 0123456789abcdef0123456789abcdef/map.png', Buffer.from([1, 2, 3]));
  inner.addFile('Workspace/Reading list bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.csv', Buffer.from('Name,Author\nOnly view,X\n'));
  inner.addFile('Workspace/Reading list bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb_all.csv', Buffer.from('Name,Author,Notes\n"Dune","Herbert","Great, long"\nSapiens,Harari,""\n'));
  const outer = new AdmZip();
  outer.addFile('Export-123-Part-1.zip', inner.toBuffer());
  const form = new FormData();
  form.append('files', new Blob([outer.toBuffer()]), 'Export-123.zip');
  form.append('files', new Blob([Buffer.from('---\ntags: [obsidian, idea]\n---\n# Vault idea\n\nBody text')]), 'Vault idea.md');
  let res = await fetch(base + '/api/import', { method: 'POST', body: form });
  const imp = await res.json();
  check('import Notion zip + markdown', res.status === 200 && imp.imported === 3 && imp.skippedImages === 1, imp);

  // ── Link preview must not reach internal pages (PEB-24) ──
  const httpMod = await import('http');
  const internal = httpMod.createServer((q, s) => { s.setHeader('content-type', 'text/html'); s.end('<title>SECRET-INTERNAL-PAGE</title><meta property="og:description" content="internal data">'); });
  await new Promise((ok) => internal.listen(0, '127.0.0.1', ok));
  const internalUrl = `http://127.0.0.1:${internal.address().port}/`;
  r = await call('GET', '/api/ai/link-preview?url=' + encodeURIComponent(internalUrl));
  check('link preview refuses a loopback page (no title or description leaked)', !JSON.stringify(r.json).includes('SECRET-INTERNAL') && !JSON.stringify(r.json).includes('internal data'), r.json);
  r = await call('GET', '/api/ai/link-preview?url=' + encodeURIComponent('http://169.254.169.254/latest/meta-data/'));
  check('link preview refuses the cloud-metadata address', r.status === 200 && /Could not load/.test(r.json.description || ''), r.json);
  r = await call('GET', '/api/ai/link-preview?url=' + encodeURIComponent('file:///etc/passwd'));
  check('link preview refuses non-http links', /Could not load/.test(r.json.description || ''), r.json);
  internal.close();
  const { isPrivateIp } = await import(pathToFileURL(path.resolve('dist/server/utils/safeFetch.js')).href);
  const sample = { '10.1.2.3': true, '192.168.0.9': true, '172.20.0.1': true, '127.0.0.1': true, '169.254.169.254': true, '::1': true, '::ffff:10.0.0.1': true, 'fd00::1': true, '8.8.8.8': false, '93.184.216.34': false, '2606:4700:4700::1111': false };
  check('private/public address classification', Object.entries(sample).every(([ip, want]) => isPrivateIp(ip) === want), Object.entries(sample).filter(([ip, want]) => isPrivateIp(ip) !== want));

  // ── Upload limits (PEB-62): a small zip that unpacks to hundreds of MB, or to thousands of files, is refused ──
  const bomb = new AdmZip();
  bomb.addFile('big.md', Buffer.alloc(120 * 1024 * 1024, 97)); // ~120 KB zipped, 120 MB unpacked
  const bombZip = bomb.toBuffer();
  const fBomb = new FormData();
  fBomb.append('files', new Blob([bombZip]), 'bomb.zip');
  res = await fetch(base + '/api/import', { method: 'POST', body: fBomb });
  check(`zip bomb (${Math.round(bombZip.length / 1024)} KB zipped, 120 MB unpacked) is refused with 413`, res.status === 413, res.status);
  const many = new AdmZip();
  for (let i = 0; i < 5200; i++) many.addFile(`n/${i}.md`, Buffer.from('x'));
  const fMany = new FormData();
  fMany.append('files', new Blob([many.toBuffer()]), 'many.zip');
  res = await fetch(base + '/api/import', { method: 'POST', body: fMany });
  check('a zip with thousands of files is refused with 413', res.status === 413, res.status);
  const fBig = new FormData();
  fBig.append('file', new Blob([Buffer.alloc(11 * 1024 * 1024, 97)], { type: 'text/plain' }), 'huge.txt');
  res = await fetch(base + '/api/ai/smart-intake-upload', { method: 'POST', body: fBig });
  check('an 11 MB upload to the AI intake is refused with 413', res.status === 413, res.status);
  r = await call('GET', '/api/notes?tag=imported');
  check('refused imports created no notes', (r.json.notes || []).length === 3, (r.json.notes || []).length);

  r = await call('GET', '/api/notes?tag=imported');
  const byTitle = Object.fromEntries((r.json.notes || []).map((n) => [n.title, n]));
  const trip = byTitle['Trip plan'];
  check('Notion page: title, tags, properties, link text', !!trip && trip.tags.includes('travel') && trip.tags.includes('summer')
    && trip.content.includes('**Status:** Planning') && trip.content.includes('See Packing list.') && !trip.content.includes('map.png')
    && new Date(trip.createdAt).getFullYear() === 2025, trip);
  const table = byTitle['Reading list'];
  check('Notion database → table note (uses _all.csv)', !!table && table.content.includes('| Dune | Herbert | Great, long |') && !table.content.includes('Only view'), table);
  check('Obsidian front-matter tags', !!byTitle['Vault idea'] && byTitle['Vault idea'].tags.includes('obsidian'), byTitle['Vault idea']);

  // ── Export everything as a Markdown zip, and re-import it ──
  res = await fetch(base + '/api/export');
  const zipBuf = Buffer.from(await res.arrayBuffer());
  const exported = new AdmZip(zipBuf).getEntries().map((e) => e.entryName);
  check('export zip has every note as .md', res.status === 200 && exported.includes('Trip plan.md') && exported.length >= 59, exported.length);

  // ── Local AI (Ollama) connection check never crashes ──
  r = await call('GET', '/api/ai/ollama/check?url=' + encodeURIComponent('http://127.0.0.1:1'));
  check('Ollama check reports unreachable server cleanly', r.status === 200 && r.json.ok === false && /Could not reach/.test(r.json.error), r.json);

  // ── Local AI path, against a fake Ollama (OpenAI-compatible) server ──
  const http = await import('http');
  const seen = [];
  const fake = http.createServer(async (req, resp) => {
    let body = '';
    for await (const c of req) body += c;
    const json = body ? JSON.parse(body) : {};
    seen.push({ url: req.url, model: json.model, stream: !!json.stream });
    if (req.url === '/api/tags') {
      resp.writeHead(200, { 'Content-Type': 'application/json' });
      return resp.end(JSON.stringify({ models: [{ name: 'llama3.2:latest' }] }));
    }
    const answer = JSON.stringify({
      title: 'Local AI title',
      reply: 'Made it locally',
      notes: [{ title: 'From local AI', content: 'Hello from Ollama', category: 'Ideas', tags: ['local'] }],
      updateNote: null,
    });
    if (json.stream) {
      resp.writeHead(200, { 'Content-Type': 'text/event-stream' });
      for (const piece of [answer.slice(0, 20), answer.slice(20)]) {
        resp.write(`data: ${JSON.stringify({ id: 'x', object: 'chat.completion.chunk', created: 0, model: json.model, choices: [{ index: 0, delta: { content: piece }, finish_reason: null }] })}\n\n`);
      }
      resp.write('data: [DONE]\n\n');
      return resp.end();
    }
    resp.writeHead(200, { 'Content-Type': 'application/json' });
    resp.end(JSON.stringify({ id: 'x', object: 'chat.completion', created: 0, model: json.model,
      choices: [{ index: 0, message: { role: 'assistant', content: answer }, finish_reason: 'stop' }] }));
  });
  await new Promise((ok) => fake.listen(0, '127.0.0.1', ok));
  const fakeUrl = `http://127.0.0.1:${fake.address().port}`;

  r = await call('GET', '/api/ai/ollama/check?url=' + encodeURIComponent(fakeUrl));
  check('Ollama check lists installed models', r.json.ok === true && r.json.models[0] === 'llama3.2:latest', r.json);

  await call('PUT', '/api/profile', { settings: { ollamaEnabled: true, ollamaUrl: fakeUrl, ollamaModel: 'llama3.2', defaultAiModel: 'ollama' } });
  r = await call('POST', `/api/notes/${noteId}/ai/title`, { content: 'Some text about trips' });
  check('AI title via local model', r.status === 200 && r.json.title === 'Local AI title' && seen.some((x) => x.url === '/v1/chat/completions' && x.model === 'llama3.2'), { r: r.json, seen });

  res = await fetch(base + '/api/ai/chat-stream', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'make a note' }) });
  const sse = await res.text();
  const done = sse.split('\n').filter((l) => l.startsWith('data: ')).map((l) => JSON.parse(l.slice(6))).find((e) => e.done);
  check('streaming AI chat via local model creates notes', !!done && done.notes?.[0]?.title === 'From local AI' && seen.some((x) => x.stream), sse.slice(0, 300));

  // OpenAI key path (the SDK honours OPENAI_BASE_URL, so it talks to the fake server too)
  process.env.OPENAI_BASE_URL = `${fakeUrl}/v1`;
  await call('PUT', '/api/profile', { settings: { ollamaEnabled: false, defaultAiModel: 'openai', openAiKey: 'sk-test' } });
  seen.length = 0;
  r = await call('POST', `/api/notes/${noteId}/ai/title`, { content: 'Some text about trips' });
  check('AI title via an OpenAI key', r.status === 200 && r.json.title === 'Local AI title' && seen.some((x) => x.model === 'gpt-4o-mini'), { r: r.json, seen });

  // Local-only must never fall back to a cloud key, even when Ollama is down
  await call('PUT', '/api/profile', { settings: { ollamaEnabled: true, ollamaUrl: 'http://127.0.0.1:1', defaultAiModel: 'ollama' } });
  seen.length = 0;
  r = await call('POST', `/api/notes/${noteId}/ai/title`, { content: 'Private text' });
  check('Local AI choice never falls back to the cloud', seen.length === 0 && r.json.title !== 'Local AI title', { r: r.json, seen });
  // ── AI Hub: search, streamed answer with sources, and the "ask first" consent flow ──
  const hubEvents = async (body) => {
    const rr = await fetch(base + '/api/ai/hub/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return (await rr.text()).split('\n').filter((l) => l.startsWith('data: ')).map((l) => JSON.parse(l.slice(6)));
  };
  r = await call('POST', '/api/ai/hub/search', { query: 'book flights for the trip' });
  check('AI Hub search finds the imported trip note', r.status === 200 && r.json.sources.some((s) => s.title === 'Trip plan'), r.json);

  await call('PUT', '/api/profile', { settings: { ollamaEnabled: true, ollamaUrl: fakeUrl, defaultAiModel: 'ollama' } });
  r = await call('GET', '/api/ai/hub/models');
  check('AI Hub lists local models and routing', r.json.local?.ok === true && r.json.local.models.includes('llama3.2:latest') && r.json.routing === 'ollama', r.json);

  let evs = await hubEvents({ messages: [{ role: 'user', content: 'When should I book flights for the trip?' }] });
  let doneEv = evs.find((e) => e.type === 'done');
  check('AI Hub answers locally with sources', evs[0]?.type === 'sources' && evs[0].sources.some((s) => s.title === 'Trip plan') && evs.some((e) => e.type === 'delta') && doneEv?.local === true && doneEv.provider === 'ollama', evs.slice(0, 3));

  evs = await hubEvents({ messages: [{ role: 'user', content: 'hello' }], provider: 'openai', model: 'gpt-4o-mini' });
  check('AI Hub refuses cloud models under "Local only"', evs.some((e) => e.type === 'error' && e.code === 'LOCAL_ONLY'), evs);

  await call('PUT', '/api/profile', { settings: { ollamaUrl: 'http://127.0.0.1:1', defaultAiModel: 'ask' } });
  seen.length = 0;
  evs = await hubEvents({ messages: [{ role: 'user', content: 'What is due this week?' }] });
  check('"Ask first" asks before using the cloud when local AI is down', evs.some((e) => e.type === 'consent' && e.provider === 'openai') && !seen.some((x) => x.model === 'gpt-4o-mini'), evs);

  evs = await hubEvents({ messages: [{ role: 'user', content: 'What is due this week?' }], allowCloud: true });
  doneEv = evs.find((e) => e.type === 'done');
  check('after consent the cloud model answers', doneEv?.provider === 'openai' && doneEv.local === false && seen.some((x) => x.model === 'gpt-4o-mini'), evs.slice(-2));

  r = await call('POST', `/api/notes/${noteId}/ai/title`, { content: 'Private text' });
  check('"Ask first" never sends background AI to the cloud', !seen.some((x) => x.model === 'gpt-4o-mini' && !x.stream), seen);

  await call('PUT', '/api/profile', { settings: { openAiKey: '' } });
  delete process.env.OPENAI_BASE_URL;

  await call('PUT', '/api/profile', { settings: { ollamaEnabled: false, defaultAiModel: 'auto' } });
  res = await fetch(base + '/api/ai/chat-stream', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'hi' }) });
  const noKey = await res.text();
  check('chat without any AI explains how to set it up', /Connections/.test(noKey), noKey.slice(0, 200));
  fake.close();

  // ── Another account can't see or use this account's notes ──
  r = await call('POST', '/api/auth/signup', { email: emailB, password: 'another long password' });
  const tokenA = token;
  const tokenB = r.json.token;
  token = tokenB;
  r = await call('GET', `/api/notes/${noteId}`);
  check("another account can't read a note", r.status === 404, r);
  r = await call('GET', '/api/notes');
  check("another account's list is empty", r.status === 200 && r.json.notes.length === 0, r.json.notes?.length);
  r = await call('PUT', '/api/profile', { email: emailA });
  check('changing the email needs the current password', r.status === 403, r.json);
  r = await call('PUT', '/api/profile', { email: emailA, currentPassword: 'not my password' });
  check('a wrong password does not change the email either', r.status === 403, r.json);
  r = await call('PUT', '/api/profile', { email: emailA, currentPassword: 'another long password' });
  check("an email already in use can't be taken", r.status === 409, r.json);
  token = tokenA;

  // ── Search covers tags; snippet and paging options ──
  r = await call('GET', '/api/notes?search=obsidian');
  check('search finds notes by tag name', r.status === 200 && r.json.notes.some((n) => n.title === 'Vault idea'), r.json.notes?.length);
  await call('POST', '/api/notes', { title: 'Long one', content: 'y'.repeat(2000) });
  r = await call('GET', '/api/notes?snippet=1&search=Long%20one');
  check('snippet=1 shortens content', r.status === 200 && r.json.notes[0]?.content.length === 400 && r.json.notes[0].truncated === true, r.json.notes?.[0]?.content?.length);
  r = await call('GET', '/api/notes?limit=5&offset=0');
  check('limit/offset page the list', r.status === 200 && r.json.notes.length === 5, r.json.notes?.length);

  // ── Change password, and sign out everywhere ──
  r = await call('POST', '/api/auth/change-password', { currentPassword: 'nope nope nope', newPassword: 'a brand new password' });
  check('change password needs the current password (403, not 401)', r.status === 403, r.json);
  r = await call('POST', '/api/auth/change-password', { currentPassword: 'correct horse battery', newPassword: 'short' });
  check('new password must be 8+ characters', r.status === 400, r.json);
  r = await call('POST', '/api/auth/change-password', { currentPassword: 'correct horse battery', newPassword: 'a brand new password' });
  check('change password returns a fresh token', r.status === 200 && !!r.json.token && r.json.token !== tokenA, r.json);
  const tokenA2 = r.json.token;
  r = await call('GET', '/api/profile');
  check('the old token stops working after a password change', r.status === 401, r.status);
  token = tokenA2;
  r = await call('GET', '/api/profile');
  check('the new token works', r.status === 200, r.status);
  r = await call('POST', '/api/auth/login', { email: emailA, password: 'a brand new password' });
  check('login with the new password', r.status === 200 && !!r.json.token, r.json);
  const tokenA3 = r.json.token;
  r = await call('POST', '/api/auth/logout-all');
  check('sign out everywhere', r.status === 200, r.json);
  r = await call('GET', '/api/profile');
  check('every token stops working after "sign out everywhere"', r.status === 401, r.status);
  token = tokenA3;
  r = await call('GET', '/api/profile');
  check('(and that includes tokens from other devices)', r.status === 401, r.status);

  // ── Sign-in attempts are rate limited ──
  let limited = false;
  for (let i = 0; i < 14 && !limited; i++) {
    r = await call('POST', '/api/auth/login', { email: emailA, password: 'wrong wrong' });
    limited = r.status === 429;
  }
  check('repeated bad sign-ins are rate limited (429)', limited);

  // PEB-63: the limit holds when the client address is faked, and is per account
  {
    const target = `ratelimit-${runId}@peblo.test`;
    let blocked = false; let tries = 0;
    for (let i = 0; i < 14 && !blocked; i++) {
      tries++;
      const rr = await rawFetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': `203.0.113.${i + 1}` }, body: JSON.stringify({ email: target, password: 'wrong wrong' }) });
      blocked = rr.status === 429;
    }
    check('sign-in limit holds with a different faked address every time', blocked && tries <= 12, { tries });
    const other = await rawFetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '198.51.100.7' }, body: JSON.stringify({ email: emailB, password: 'correct horse battery' }) });
    check('another account is not locked out by that', other.status !== 429, other.status);
  }
  // PEB-63: unknown and known emails take about the same time to refuse
  {
    const time = async (email, n) => {
      let total = 0;
      for (let i = 0; i < n; i++) {
        const t0 = Date.now();
        await rawFetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': `192.0.2.${Math.floor(Math.random() * 200) + 1}` }, body: JSON.stringify({ email, password: 'wrong wrong' }) });
        total += Date.now() - t0;
      }
      return total / n;
    };
    const known = await time(emailB, 4);
    let unknownTotal = 0;
    for (let i = 0; i < 4; i++) unknownTotal += await time(`nobody-${runId}-${i}@peblo.test`, 1);
    const unknown = unknownTotal / 4;
    check('unknown and known emails take a similar time to refuse', unknown > known * 0.5, { known: Math.round(known), unknown: Math.round(unknown) });
  }

  // ── PEB-66: small hardening ──
  {
    // 1. unexpected errors do not leak their text; CORS refusals are 403
    const { errorHandler } = await import(pathToFileURL(path.resolve('dist/server/middleware/errorHandler.js')).href);
    const fake = () => { const o = { code: 0, body: null }; return { o, res: { status(c) { o.code = c; return this; }, json(b) { o.body = b; return this; } } }; };
    const quiet = console.error; console.error = () => {};
    const a = fake(); errorHandler(new Error('connect ECONNREFUSED 10.0.0.5:3306 table `users`'), { method: 'GET', originalUrl: '/x' }, a.res, () => {});
    const b = fake(); errorHandler(Object.assign(new Error('Local AI is off.'), { statusCode: 400 }), { method: 'GET', originalUrl: '/x' }, b.res, () => {});
    console.error = quiet;
    check('an unexpected error shows no internal text and gives a reference', a.o.code === 500 && !/ECONNREFUSED|users/.test(JSON.stringify(a.o.body)) && /reference [0-9a-f]{8}/.test(a.o.body.error), a.o);
    check('an error the server raised on purpose keeps its message', b.o.code === 400 && b.o.body.error === 'Local AI is off.', b.o);
    const cors = await rawFetch(base + '/api/health', { headers: { Origin: 'https://evil.example' } });
    check('a request from a foreign origin is refused with 403 (not 500)', cors.status === 403, cors.status);

    // 2. sockets are dropped on sign out everywhere
    const fr = await call('POST', '/api/auth/signup', { email: `smoke-f-${runId}@peblo.test`, password: 'correct horse battery' });
    const tokenF = fr.json.token;
    const { io: ioClient } = await import(pathToFileURL(path.resolve('client/node_modules/socket.io-client/build/esm/index.js')).href);
    const sk = ioClient(base, { auth: { token: tokenF }, transports: ['websocket'], reconnection: false });
    await new Promise((ok) => { sk.on('connect', ok); setTimeout(ok, 4000); });
    let dropped = false; sk.on('disconnect', () => { dropped = true; });
    await rawFetch(base + '/api/auth/logout-all', { method: 'POST', headers: { Authorization: `Bearer ${tokenF}` } });
    await new Promise((ok) => setTimeout(ok, 1500));
    check('"sign out everywhere" drops the account\'s open sockets', sk.connected === false && dropped, { connected: sk.connected, dropped });
    sk.close();

    // 3. profile fields are checked (with a fresh account, since the one above is signed out)
    const savedToken = token;
    const hr = await call('POST', '/api/auth/signup', { email: `smoke-h-${runId}@peblo.test`, password: 'correct horse battery' });
    token = hr.json.token;
    const put = (body) => call('PUT', '/api/profile', body);
    r = await put({ bio: 'x'.repeat(600) }); check('a 600-character bio is refused', r.status === 400, r.json);
    r = await put({ jobTitle: 12345 }); check('a non-text job title is refused', r.status === 400, r.json);
    r = await put({ timezone: 'Mars/Olympus' }); check('an unknown time zone is refused', r.status === 400, r.json);
    r = await put({ settings: { big: 'y'.repeat(25000) } }); check('settings over 20 KB are refused', r.status === 400, r.json);
    r = await put({ jobTitle: 'Engineer', bio: 'Short bio', timezone: 'Asia/Kolkata' }); check('normal profile fields still save', r.status === 200, r.json);

    // 4. long passwords
    r = await call('POST', '/api/auth/signup', { email: `smoke-g-${runId}@peblo.test`, password: 'a'.repeat(73) });
    check('a password over 72 bytes is refused (bcrypt would cut it)', r.status === 400, r.json);

    // 5 + 6. AI routes exist once; unknown API paths answer JSON
    r = await call('POST', '/api/notes/voice-command', { transcript: 'hi' });
    check('the AI router is no longer also mounted under /api/notes', r.status === 404, r.status);
    r = await call('POST', '/api/ai/voice-command', { transcript: 'hi' });
    check('voice commands are served under /api/ai (where the app calls them)', r.status !== 404, r.status);
    const nf = await rawFetch(base + '/api/this-does-not-exist');
    check('an unknown API path answers JSON 404 even without signing in', nf.status === 404 && /json/.test(nf.headers.get('content-type') || ''), nf.status);
    token = savedToken;
  }


  r = await call('GET', '/notes/some-id');
  check('SPA route serves index.html', r.status === 200 && String(r.json).includes('<div id="root">'));

  // ── Regressions: bad input must give 400, never 500; toggle-task must need an id (PEB-68, PEB-69) ──
  r = await call('POST', '/api/auth/signup', { email: emailC, password: 'correct horse battery', name: 'Smoke C' });
  token = r.json.token;
  r = await call('POST', '/api/notes', { title: 123, tags: 'not-an-array' });
  check('invalid note input gives 400 (not 500)', r.status === 400 && Array.isArray(r.json.details), r);
  r = await call('POST', '/api/todos', { priority: 'urgent' });
  check('invalid todo input gives 400 (not 500)', r.status === 400, r);
  r = await call('POST', '/api/todos', { text: 'bad date', deadline: 'not-a-date' });
  check('invalid deadline gives 400 (not 500)', r.status === 400, r);
  const t1 = await call('POST', '/api/todos', { text: 'regression one' });
  const t2 = await call('POST', '/api/todos', { text: 'regression two' });
  r = await call('POST', '/api/dashboard/toggle-task', { completed: true });
  check('toggle-task without an id is refused', r.status === 400, r);
  r = await call('POST', '/api/dashboard/toggle-task', { id: t1.json.todo.id, completed: 'yes' });
  check('toggle-task needs a boolean', r.status === 400, r);
  r = await call('GET', '/api/todos');
  const list = r.json.todos || r.json;
  check('no task was completed by the refused calls', list.length >= 2 && list.every(t => !t.completed), list.map(t => t.completed));
  r = await call('POST', '/api/dashboard/toggle-task', { id: t2.json.todo.id, completed: true });
  check('toggle-task completes only the given task', r.status === 200, r);
  r = await call('GET', '/api/todos');
  const list2 = r.json.todos || r.json;
  check('exactly one task is completed', list2.filter(t => t.completed).length === 1, list2.map(t => t.completed));
  // PEB-74: "today" is the person's today, whatever zone the server runs in
  {
    const ut = await import(pathToFileURL(path.resolve('dist/server/utils/userTime.js')).href);
    const iso = (d) => d.toISOString();
    let b = ut.dayBounds('Asia/Kolkata', new Date('2026-10-08T20:30:00Z')); // 02:00 IST on 9 Oct
    check('tz: 02:00 IST belongs to 9 Oct IST', iso(b.start) === '2026-10-08T18:30:00.000Z' && iso(b.end) === '2026-10-09T18:29:59.999Z', [iso(b.start), iso(b.end)]);
    b = ut.dayBounds('Asia/Kolkata', new Date('2026-10-08T19:00:00Z')); // 00:30 IST
    check('tz: 00:30 IST is already the new day', iso(b.start) === '2026-10-08T18:30:00.000Z', iso(b.start));
    b = ut.dayBounds('Asia/Kolkata', new Date('2026-10-09T18:00:00Z')); // 23:30 IST
    check('tz: 23:30 IST is still the same day', iso(b.start) === '2026-10-08T18:30:00.000Z' && iso(b.end) === '2026-10-09T18:29:59.999Z', [iso(b.start), iso(b.end)]);
    b = ut.dayBounds('America/New_York', new Date('2026-11-01T12:00:00Z')); // 25-hour day (clocks go back)
    check('tz: a 25-hour day in New York', iso(b.start) === '2026-11-01T04:00:00.000Z' && iso(b.end) === '2026-11-02T04:59:59.999Z', [iso(b.start), iso(b.end)]);
    b = ut.dayBounds('America/New_York', new Date('2026-03-08T18:00:00Z')); // 23-hour day (clocks go forward)
    check('tz: a 23-hour day in New York', iso(b.start) === '2026-03-08T05:00:00.000Z' && iso(b.end) === '2026-03-09T03:59:59.999Z', [iso(b.start), iso(b.end)]);
    check('tz: hour, key and long date in the persons zone', ut.hourIn('Asia/Kolkata', new Date('2026-10-08T20:30:00Z')) === 2 && ut.dayKey(new Date('2026-10-08T20:30:00Z'), 'Asia/Kolkata') === '2026-10-09' && ut.longDate('Asia/Kolkata', new Date('2026-10-08T20:30:00Z')).startsWith('Friday, October 9'), ut.longDate('Asia/Kolkata', new Date('2026-10-08T20:30:00Z')));
    check('tz: bad zone names are rejected', ut.validZone('Mars/Base') === null && ut.validZone('Asia/Kolkata') === 'Asia/Kolkata' && ut.validZone('') === null);

    const withZone = (zone, method, url, body) => fetch(base + url, { method, headers: { 'X-Timezone': zone, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined }).then(async (res) => ({ status: res.status, json: await res.json().catch(() => null) }));
    for (const zone of ['Pacific/Kiritimati', 'Pacific/Pago_Pago']) {
      const day = ut.dayBounds(zone);
      const inToday = await call('POST', '/api/todos', { text: 'tz today ' + zone, deadline: new Date(day.start.getTime() + 3600e3).toISOString() });
      const justBefore = await call('POST', '/api/todos', { text: 'tz yesterday ' + zone, deadline: new Date(day.start.getTime() - 3600e3).toISOString() });
      const rz = await withZone(zone, 'GET', '/api/todos/today');
      const todayIds = (rz.json.todayTasks || []).map(x => x.id), overdueIds = (rz.json.overdueTasks || []).map(x => x.id);
      check(`tz: ${zone}: a task due 1h into the user's day is "today"`, todayIds.includes(inToday.json.todo.id) && !overdueIds.includes(inToday.json.todo.id), { todayIds, overdueIds });
      check(`tz: ${zone}: a task due 1h before the user's day is overdue, not today`, overdueIds.includes(justBefore.json.todo.id) && !todayIds.includes(justBefore.json.todo.id), { todayIds, overdueIds });
      const key = ut.dayKey(day.start, zone);
      const rd = await withZone(zone, 'GET', '/api/todos?date=' + key);
      check(`tz: ${zone}: ?date= lists exactly that local day`, (rd.json.todos || []).some(x => x.id === inToday.json.todo.id) && !(rd.json.todos || []).some(x => x.id === justBefore.json.todo.id), (rd.json.todos || []).map(x => x.text));
      const br = await withZone(zone, 'GET', '/api/dashboard/daily-briefing');
      const hr = Number(new Date().toLocaleString('en-US', { timeZone: zone, hour: 'numeric', hourCycle: 'h23' }));
      const greet = hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening';
      check(`tz: ${zone}: greeting and date follow the user's clock`, br.json.greeting === greet && br.json.date === new Date().toLocaleDateString('en-US', { timeZone: zone, weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }), [br.json.greeting, greet, br.json.date]);
    }
    r = await call('GET', '/api/todos?date=not-a-date');
    check('tz: a nonsense ?date= is a 400, not a 500', r.status === 400, r);
  }
  // PEB-73: streak and heatmap count the person's days and never invent activity
  {
    const as = await import(pathToFileURL(path.resolve('dist/server/utils/activityStats.js')).href);
    // Monday 9 Nov 2026, 09:00 IST = 03:30 UTC. One edit, nothing else.
    const edit = new Date('2026-11-09T03:30:00Z');
    const map = (tz) => as.buildDailyActivity([{ createdAt: edit, updatedAt: edit }], tz);
    check('stats: 09:00 IST Monday lands on Monday in Asia/Kolkata', Object.keys(map('Asia/Kolkata')).join() === '2026-11-09', Object.keys(map('Asia/Kolkata')));
    // 00:30 IST Monday = 19:00 UTC Sunday: the day is Monday for the user, Sunday on a UTC server
    const early = new Date('2026-11-08T19:00:00Z');
    check('stats: 00:30 IST is Monday for the user (was Sunday)', as.toDateKey(early, 'Asia/Kolkata') === '2026-11-09' && as.toDateKey(early, 'UTC') === '2026-11-08');
    const tue = new Date('2026-11-10T04:00:00Z'); // Tuesday 09:30 IST, nothing done yet today
    let s = as.calculateStreakStats(map('Asia/Kolkata'), 'Asia/Kolkata', tue);
    check('stats: Tuesday morning, Monday active: streak is 1 and still alive', s.current === 1 && s.activeDays === 1 && s.mostActiveDay === 'Monday', s);
    const wed = new Date('2026-11-11T04:00:00Z');
    s = as.calculateStreakStats(map('Asia/Kolkata'), 'Asia/Kolkata', wed);
    check('stats: a whole day with no edits breaks the streak', s.current === 0 && s.longest === 1, s);
    const week = as.buildYearHeatmap(map('Asia/Kolkata'), 'Asia/Kolkata', tue).flat();
    const mon = week.find(d => d.date === '2026-11-09'), tuesday = week.find(d => d.date === '2026-11-10');
    check('heatmap: Monday has 1, Tuesday (today) has 0, last cell is today', mon.total === 1 && tuesday.total === 0 && week[week.length - 1].date === '2026-11-10' && week[0].dayOfWeek === 0, [mon, tuesday, week[week.length - 1]]);
    check('stats: edits this month counts only real edits', as.getEditsThisMonth(map('Asia/Kolkata'), 'Asia/Kolkata', tue) === 1 && as.getEditsThisMonth(map('Asia/Kolkata'), 'Asia/Kolkata', new Date('2026-12-02T00:00:00Z')) === 0);
    const utcMap = as.buildDailyActivity([{ createdAt: early, updatedAt: early }], 'UTC');
    check('stats: same checks work in UTC', Object.keys(utcMap).join() === '2026-11-08' && as.calculateStreakStats(utcMap, 'UTC', new Date('2026-11-08T20:00:00Z')).current === 1);
    const run = ['2026-11-05', '2026-11-06', '2026-11-07', '2026-11-09'].map(d => new Date(d + 'T06:00:00Z'));
    s = as.calculateStreakStats(as.buildDailyActivity(run.map(d => ({ createdAt: d, updatedAt: d })), 'UTC'), 'UTC', new Date('2026-11-09T12:00:00Z'));
    check('stats: longest run and current run are separate', s.longest === 3 && s.current === 1, s);

    // API: 12 overdue tasks are all counted; a brand-new account has no fake activity today
    for (let i = 0; i < 12; i++) await call('POST', '/api/todos', { text: 'overdue ' + i, deadline: '2020-01-01T10:00:00Z' });
    r = await call('GET', '/api/dashboard/daily-briefing');
    check('briefing: overdue count is not capped at 10', r.json.stats.overdue >= 12 && r.json.overdueTasks.length <= 10, [r.json.stats.overdue, r.json.overdueTasks.length]);
    const nu = await call('POST', '/api/auth/signup', { email: emailD, password: 'correct horse battery', name: 'Smoke D' });
    const prevToken = token; token = nu.json.token;
    r = await call('GET', '/api/dashboard/insights');
    const cells = r.json.activityHeatmap.flat();
    check('insights: a new account shows no invented activity', r.json.streakStats.current === 0 && r.json.streakStats.activeDays === 0 && r.json.editsThisMonth === 0 && cells.every(c => c.total === 0), [r.json.streakStats, r.json.editsThisMonth]);
    const nn = await call('POST', '/api/notes', { title: 'trash me', content: 'x' });
    await call('DELETE', `/api/notes/${nn.json.note.id}`);
    r = await call('GET', '/api/dashboard/insights');
    check('insights: a note in Trash is not counted as activity', r.json.editsThisMonth === 0 && r.json.streakStats.activeDays === 0, r.json.streakStats);
    token = prevToken;
  }
  // PEB-85: River promises keep their state, parallel updates are not lost, and a task id must be yours
  {
    const { default: prisma } = await import(pathToFileURL(path.resolve('dist/server/db.js')).href);
    const { carryOverPromiseState } = await import(pathToFileURL(path.resolve('dist/server/services/promiseState.js')).href);
    const prev = [{ text: 'Send the deck to Rohit', status: 'added', todoId: 't1' }, { text: 'Book the room', status: 'ignored', todoId: null }, { text: 'Call Mia', status: 'open', todoId: null }];
    const found = [{ text: 'send the deck to rohit!', owner: 'you' }, { text: 'Book the room', owner: 'Sam' }, { text: 'Call Mia', owner: 'you' }, { text: 'A new one', owner: 'you' }];
    const out = carryOverPromiseState(prev, found);
    check('promises: reading again keeps added/ignored state (matched by wording)', out[0].status === 'added' && out[0].todoId === 't1' && out[1].status === 'ignored' && out[2].status === 'open' && out[3].status === 'open', out.map(x => x.status));

    const uC = await prisma.user.findUnique({ where: { email: emailC } });
    const note = await prisma.note.create({ data: { userId: uC.id, title: 'meeting', content: 'x'.repeat(40) } });
    const items = [0, 1, 2, 3].map(i => ({ text: 'promise ' + i, owner: 'you', due: null, status: 'open', todoId: null }));
    const gen = await prisma.aiGeneration.create({ data: { userId: uC.id, noteId: note.id, type: 'promises', result: JSON.stringify({ items }) } });
    const mine = await call('POST', '/api/todos', { text: 'my task' });
    const rs = await Promise.all([0, 1, 2, 3].map(i => call('PATCH', '/api/river/promises/' + gen.id, { index: i, status: i % 2 ? 'ignored' : 'added', ...(i % 2 ? {} : { todoId: mine.json.todo.id }) })));
    check('promises: four quick updates all succeed', rs.every(x => x.status === 200), rs.map(x => x.status));
    const row = await prisma.aiGeneration.findUnique({ where: { id: gen.id } });
    const saved = JSON.parse(row.result).items.map(x => x.status).join();
    check('promises: none of the four updates was lost', saved === 'added,ignored,added,ignored', saved);
    // someone else's task id is refused
    const other = await prisma.user.findUnique({ where: { email: emailA } });
    const theirs = await prisma.todo.create({ data: { userId: other.id, text: 'not yours', todoTags: [] } });
    r = await call('PATCH', '/api/river/promises/' + gen.id, { index: 0, status: 'added', todoId: theirs.id });
    check('promises: a todoId that belongs to someone else is refused', r.status === 400, r);
    r = await call('PATCH', '/api/river/promises/' + gen.id, { index: 9, status: 'added' });
    check('promises: an index that does not exist is a 400', r.status === 400, r);
  }
  // PEB-75: with no AI configured every AI button gets the same clear error, and nothing is written
  {
    const { default: prisma } = await import(pathToFileURL(path.resolve('dist/server/db.js')).href);
    const uC = await prisma.user.findUnique({ where: { email: emailC } });
    // make sure user C really has no AI: no keys, Ollama off, and no environment keys
    const keep = { o: process.env.OPENAI_API_KEY, g: process.env.GEMINI_API_KEY, gs: process.env.GEMINI_API_KEYS };
    delete process.env.OPENAI_API_KEY; delete process.env.GEMINI_API_KEY; delete process.env.GEMINI_API_KEYS;
    await call('PUT', '/api/profile', { settings: { defaultAiModel: 'auto', ollamaEnabled: false } });
    const n = await call('POST', '/api/notes', { title: 'ai off', content: 'Some real text to summarise, long enough to matter.' });
    const noteId = n.json.note.id;
    const notesBefore = await prisma.note.count({ where: { userId: uC.id } });
    const gensBefore = await prisma.aiGeneration.count({ where: { userId: uC.id } });
    const tries = [
      ['summary', 'POST', `/api/notes/${noteId}/ai/summary`, {}],
      ['action items', 'POST', `/api/notes/${noteId}/ai/actions`, {}],
      ['title', 'POST', `/api/notes/${noteId}/ai/title`, {}],
      ['selection command', 'POST', '/api/notes/block/ai', { text: 'hello world, summarise me please', command: 'summarize' }],
      ['AI chat', 'POST', '/api/ai/chat', { message: 'make a note about tides' }],
    ];
    const msgs = new Set();
    for (const [name, m, url, body] of tries) {
      const rr = await call(m, url, body);
      const msg = rr.json?.error || '';
      msgs.add(msg);
      check(`ai off: ${name} is an error with a helpful message (not fake content)`, rr.status === 400 && /No AI set up|AI Hub/.test(msg) && !/placeholder|Fallback|Task 1/i.test(JSON.stringify(rr.json)), rr);
    }
    check('ai off: every button says the same thing', msgs.size === 1, [...msgs]);
    check('ai off: no note was created and nothing was saved as an AI result', (await prisma.note.count({ where: { userId: uC.id } })) === notesBefore && (await prisma.aiGeneration.count({ where: { userId: uC.id } })) === gensBefore);
    const row = await prisma.note.findUnique({ where: { id: noteId }, include: { aiGenerations: true } });
    check('ai off: the note is not marked as having a summary', row.aiGenerations.length === 0, row.aiGenerations.length);
    Object.assign(process.env, { OPENAI_API_KEY: keep.o, GEMINI_API_KEY: keep.g, GEMINI_API_KEYS: keep.gs });
    for (const k of Object.keys(keep)) if (keep[k] === undefined) { /* leave unset */ }
  }
  // PEB-84: a quiz can be marked once; a replay changes nothing and reports the score before
  {
    const { default: prisma } = await import(pathToFileURL(path.resolve('dist/server/db.js')).href);
    const uC = await prisma.user.findUnique({ where: { email: emailC } });
    const qs = [0, 1].map(i => ({ q: `q${i}`, options: ['a', 'b', 'c'], answer: 1, concept: `c${i}`, explain: '' }));
    const run = await prisma.quizRun.create({ data: { userId: uC.id, topic: 'smoke-topic', questions: JSON.stringify(qs), total: 2 } });
    const url = `/api/study/quiz/${run.id}/answers`;
    // fire three at once, like a double click on the last question
    const rs = await Promise.all([1, 2, 3].map(() => call('POST', url, { answers: [1, 1] })));
    const codes = rs.map(x => x.status).sort();
    check('quiz: exactly one of three simultaneous submissions is accepted, the rest get 409', codes.join() === '200,409,409', codes);
    const ok = rs.find(x => x.status === 200);
    check('quiz: the accepted result reports the score before (null on a first quiz)', ok.json.before === null && ok.json.pct === 100, ok.json);
    r = await call('POST', url, { answers: [0, 0] });
    check('quiz: a later replay is refused', r.status === 409, r);
    const m = await prisma.topicMastery.findUnique({ where: { userId_topic: { userId: uC.id, topic: 'smoke-topic' } } });
    check('quiz: mastery was applied once (score 100, quizzes 1)', m.score === 100 && m.quizzes === 1, m);
    r = await call('POST', '/api/study/quiz/does-not-exist/answers', { answers: [] });
    check('quiz: unknown id is 404', r.status === 404, r);
  }
  // PEB-77: every write path tells the signed-in user's other screens to refetch
  {
    const { io: ioClient } = await import(pathToFileURL(path.resolve('client/node_modules/socket.io-client/build/esm-debug/index.js')).href).catch(() => import(pathToFileURL(path.resolve('client/node_modules/socket.io-client/build/esm/index.js')).href));
    const sock = ioClient(base, { auth: { token }, transports: ['websocket'] });
    await new Promise((res, rej) => { sock.on('connect', res); sock.on('connect_error', rej); setTimeout(() => rej(new Error('socket connect timeout')), 5000); });
    const seen = [];
    sock.on('todos_changed', () => seen.push('todos_changed'));
    sock.on('notes_changed', () => seen.push('notes_changed'));
    const expectEvent = async (label, ev, fn) => {
      seen.length = 0;
      await fn();
      const t0 = Date.now();
      while (!seen.includes(ev) && Date.now() - t0 < 2000) await new Promise(r => setTimeout(r, 25));
      check(`socket: ${label} emits ${ev}`, seen.includes(ev), seen);
    };
    const n = await call('POST', '/api/notes', { title: 'sock', content: 'x' });
    const nid = n.json.note.id;
    await expectEvent('note update', 'notes_changed', () => call('PATCH', `/api/notes/${nid}`, { title: 'sock2' }));
    await expectEvent('note archive', 'notes_changed', () => call('POST', `/api/notes/${nid}/archive`));
    await expectEvent('note delete', 'notes_changed', () => call('DELETE', `/api/notes/${nid}`));
    await expectEvent('note restore', 'notes_changed', () => call('POST', `/api/notes/${nid}/restore`));
    const tt = await call('POST', '/api/todos', { text: 'sock todo' });
    await expectEvent('toggle-task', 'todos_changed', () => call('POST', '/api/dashboard/toggle-task', { id: tt.json.todo.id, completed: true }));
    sock.disconnect();
  }
  // ---- PEB-76: repeating tasks are one series that never runs out ----
  {
    const ser = await import(pathToFileURL(path.resolve('dist/server/services/todoSeries.js')).href);
    const { default: prismaS } = await import(pathToFileURL(path.resolve('dist/server/db.js')).href);
    const at = (s) => new Date(s);
    const iso = (d) => d.toISOString();
    // monthly on the 31st falls back to the last day of a shorter month, and does not drift
    const anchor = at('2026-01-31T09:00:00Z');
    let cur = anchor; const seq = [];
    for (let i = 0; i < 5; i++) { cur = ser.nextOccurrence('monthly', anchor, cur, 'UTC'); seq.push(iso(cur).slice(0, 10)); }
    check('series: monthly on the 31st -> Feb 28, Mar 31, Apr 30, May 31, Jun 30', seq.join() === '2026-02-28,2026-03-31,2026-04-30,2026-05-31,2026-06-30', seq);
    check('series: yearly on Feb 29 -> Feb 28, then Feb 29 in a leap year', iso(ser.nextOccurrence('yearly', at('2024-02-29T09:00:00Z'), at('2024-02-29T09:00:00Z'), 'UTC')).startsWith('2025-02-28') && iso(ser.nextOccurrence('yearly', at('2024-02-29T09:00:00Z'), at('2027-02-28T09:00:00Z'), 'UTC')).startsWith('2028-02-29'));
    check('series: weekdays skip the weekend (Fri -> Mon)', iso(ser.nextOccurrence('weekdays', at('2026-10-09T09:00:00Z'), at('2026-10-09T09:00:00Z'), 'UTC')).startsWith('2026-10-12'));
    const ny = ser.nextOccurrence('daily', at('2026-10-31T13:00:00Z'), at('2026-10-31T13:00:00Z'), 'America/New_York'); // 9:00 EDT -> next day 9:00 EST
    check('series: daily keeps 9:00 local across the clock change', iso(ny) === '2026-11-01T14:00:00.000Z', iso(ny));

    const DAY = 86400e3;
    const base0 = new Date(); base0.setUTCHours(12, 0, 0, 0);
    const rangeUrl = (a, b) => `/api/todos/range?from=${new Date(a).toISOString()}&to=${new Date(b).toISOString()}`;
    const rowsOf = async (sid) => (await prismaS.todo.findMany({ where: { seriesId: sid }, orderBy: { deadline: 'asc' } }));

    // a daily task is one series with ~60 days ready, not 30 loose copies
    let r1 = await call('POST', '/api/todos', { text: 'series daily', deadline: new Date(base0.getTime() + DAY).toISOString(), recurrence: 'daily' });
    const sid = r1.json.todo?.seriesId;
    check('series: creating a daily task makes a series', r1.status === 201 && !!sid, r1.json);
    let rows = await rowsOf(sid);
    check('series: about 60 days of occurrences are ready (not the old 30)', rows.length >= 59 && rows.length <= 62, rows.length);

    // it never runs out: 40 days later the list tops it up again
    await prismaS.$executeRawUnsafe('UPDATE todos SET deadline = DATE_SUB(deadline, INTERVAL 40 DAY) WHERE series_id = ?', sid);
    await prismaS.$executeRawUnsafe('UPDATE todo_series SET anchor = DATE_SUB(anchor, INTERVAL 40 DAY), last_generated = DATE_SUB(last_generated, INTERVAL 40 DAY) WHERE id = ?', sid);
    await call('GET', rangeUrl(base0, base0.getTime() + 3 * DAY));
    rows = await rowsOf(sid);
    const lastAt = rows[rows.length - 1].deadline.getTime();
    check('series: after 40 days pass it is topped up and never runs out', lastAt >= Date.now() + 55 * DAY, new Date(lastAt).toISOString());
    check('series: top-up added each day once (no duplicates)', new Set(rows.map((x) => x.deadline.toISOString())).size === rows.length);

    // edit scopes
    rows = await rowsOf(sid);
    const future = rows.filter((x) => x.deadline.getTime() > Date.now() + DAY);
    const [a, b, c] = [future[0], future[1], future[2]];
    let r = await call('PATCH', `/api/todos/${a.id}`, { text: 'only this one', scope: 'this' });
    let after = await rowsOf(sid);
    check('series: edit "this one" changes only that task', after.filter((x) => x.text === 'only this one').length === 1 && after.find((x) => x.id === b.id).text === 'series daily', r.json);
    r = await call('PATCH', `/api/todos/${b.id}`, { text: 'from here on', priority: 'high', scope: 'following' });
    after = await rowsOf(sid);
    const early = after.filter((x) => x.deadline < b.deadline), late = after.filter((x) => x.deadline >= b.deadline);
    check('series: edit "this and following" changes this and later ones, not earlier ones', late.every((x) => x.text === 'from here on' && x.priority === 'high') && early.every((x) => x.text !== 'from here on'), { early: early.length, late: late.length });
    r = await call('PATCH', `/api/todos/${c.id}`, { priority: 'low', scope: 'bogus' });
    check('series: an unknown scope is refused', r.status === 400, r.json);

    // delete scopes
    const total = (await rowsOf(sid)).length;
    r = await call('DELETE', `/api/todos/${c.id}?scope=this`);
    await call('GET', rangeUrl(base0, base0.getTime() + 3 * DAY));
    check('series: delete "this one" removes just that task and it does not come back', r.status === 200 && (await rowsOf(sid)).length === total - 1);
    const mid = (await rowsOf(sid)).filter((x) => x.deadline.getTime() > Date.now() + 5 * DAY)[0];
    const keep = (await rowsOf(sid)).filter((x) => x.deadline < mid.deadline).length;
    r = await call('DELETE', `/api/todos/${mid.id}?scope=following`);
    await call('GET', rangeUrl(base0, base0.getTime() + 3 * DAY));
    check('series: delete "this and following" stops the series for good', r.status === 200 && (await rowsOf(sid)).length === keep, { keep, now: (await rowsOf(sid)).length });

    // changing "repeat" starts a new series from that task
    const r2 = await call('POST', '/api/todos', { text: 'series switch', deadline: new Date(base0.getTime() + 2 * DAY).toISOString(), recurrence: 'daily' });
    const sid2 = r2.json.todo.seriesId;
    const second = (await rowsOf(sid2))[1];
    r = await call('PATCH', `/api/todos/${second.id}`, { recurrence: 'weekly' });
    const sw = (await prismaS.todo.findMany({ where: { text: 'series switch' }, orderBy: { deadline: 'asc' } }));
    const gaps = sw.slice(1).map((x, i) => Math.round((x.deadline - sw[i].deadline) / DAY));
    check('series: changing daily -> weekly keeps the earlier days and then repeats weekly', r.status === 200 && sw.length >= 4 && gaps[0] === 1 && gaps.slice(1).every((g) => g === 7), gaps);
    r = await call('DELETE', `/api/todos/${second.id}?scope=all`);
    check('series: delete "all" removes the whole (new) series', r.status === 200 && (await prismaS.todo.count({ where: { seriesId: sw[sw.length - 1].seriesId } })) === 0);

    // weekdays, and monthly with the 31st (property: every row is on the 31st or the last day of its month)
    const r3 = await call('POST', '/api/todos', { text: 'series weekdays', deadline: new Date(base0.getTime() + 3 * DAY).toISOString(), recurrence: 'weekdays' });
    const wd = await rowsOf(r3.json.todo.seriesId);
    check('series: "every weekday" has no Saturdays or Sundays after the first', wd.slice(1).every((x) => ![0, 6].includes(x.deadline.getUTCDay())) && wd.length > 30, wd.length);
    let past31 = new Date(base0); past31.setUTCDate(past31.getUTCDate() - 1);
    while (past31.getUTCDate() !== 31) past31.setUTCDate(past31.getUTCDate() - 1);
    const r4 = await fetch(base + '/api/todos', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Timezone': 'UTC' }, body: JSON.stringify({ text: 'series monthly 31', deadline: past31.toISOString(), recurrence: 'monthly' }) }).then((x) => x.json());
    const mo = await rowsOf(r4.todo.seriesId);
    const dim = (d) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    check('series: monthly on the 31st lands on the last day of shorter months', mo.length >= 3 && mo.every((x) => x.deadline.getUTCDate() === Math.min(31, dim(x.deadline))), mo.map((x) => x.deadline.toISOString().slice(0, 10)));
    // old copied tasks are left alone
    const legacy = (await call('POST', '/api/todos', { text: 'legacy copy', recurrence: 'daily' })).json.todo; // a repeat label with no date is a plain task, like the old copies
    check('series: a repeat label without a date makes no series', !legacy.seriesId);
    r = await call('PATCH', `/api/todos/${legacy.id}`, { text: 'legacy edited', scope: 'all' });
    const del = await call('DELETE', `/api/todos/${legacy.id}?scope=all`);
    check('series: an old copied task (no series) still edits and deletes on its own', r.status === 200 && del.status === 200, [r.status, r.json, del.status, del.json]);
  }
  // ---- PEB-24: custom Ollama addresses on a shared server ----
  {
    const pol = await import(pathToFileURL(path.resolve('dist/server/utils/ollamaPolicy.js')).href);
    const keep = { h: process.env.PEBLO_HOSTED, a: process.env.OLLAMA_ALLOWED_HOSTS, u: process.env.OLLAMA_URL };
    const restore = () => { for (const [k, v] of [['PEBLO_HOSTED', keep.h], ['OLLAMA_ALLOWED_HOSTS', keep.a], ['OLLAMA_URL', keep.u]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } };
    const DEF = 'http://127.0.0.1:11434';
    try {
      delete process.env.PEBLO_HOSTED; delete process.env.OLLAMA_ALLOWED_HOSTS; delete process.env.OLLAMA_URL;
      check('ollama: the desktop app accepts a LAN or localhost address', pol.ollamaUrlProblem('http://192.168.1.20:11434') === null && pol.effectiveOllamaUrl('http://192.168.1.20:11434/', DEF) === 'http://192.168.1.20:11434' && pol.effectiveOllamaUrl('', DEF) === DEF);
      check('ollama: only http(s) addresses, no embedded passwords', !!pol.ollamaUrlProblem('file:///etc/passwd') && !!pol.ollamaUrlProblem('javascript:alert(1)') && !!pol.ollamaUrlProblem('http://user:pw@host:11434') && !!pol.ollamaUrlProblem('nonsense'));
      let r = await call('PUT', '/api/profile', { settings: { ollamaUrl: 'file:///etc/passwd' } });
      check('ollama: saving a non-http address is refused (400)', r.status === 400, r.json);

      process.env.PEBLO_HOSTED = '1';
      for (const bad of ['http://169.254.169.254/latest/meta-data', 'http://localhost:11434', 'http://10.0.0.5:11434', 'http://127.0.0.1:6379']) {
        check(`ollama: a shared server refuses ${bad}`, !!pol.ollamaUrlProblem(bad) && pol.effectiveOllamaUrl(bad, DEF) === null, pol.ollamaUrlProblem(bad));
      }
      r = await call('PUT', '/api/profile', { settings: { ollamaUrl: 'http://169.254.169.254/latest' } });
      check('ollama: a shared server refuses to save an internal address (400)', r.status === 400 && /does not allow/.test(r.json?.error || ''), r.json);
      r = await call('GET', '/api/ai/ollama/check?url=' + encodeURIComponent('http://10.0.0.5:11434'));
      check('ollama: the connection test does not call an internal address', r.status === 200 && r.json.ok === false && /does not allow/.test(r.json.error || ''), r.json);
      r = await call('GET', '/api/ai/ollama/check');
      check('ollama: no local AI on a shared server unless the owner sets one', r.json.ok === false && /not available/.test(r.json.error || ''), r.json);

      process.env.OLLAMA_ALLOWED_HOSTS = 'ollama.corp.example:11434, gpu-box.example';
      check('ollama: addresses on the owner\'s allow-list are accepted', pol.ollamaUrlProblem('http://ollama.corp.example:11434') === null && pol.ollamaUrlProblem('https://gpu-box.example/') === null && !!pol.ollamaUrlProblem('http://ollama.corp.example:9999'));
      r = await call('PUT', '/api/profile', { settings: { ollamaUrl: 'http://ollama.corp.example:11434' } });
      check('ollama: saving an allow-listed address works', r.status === 200, r.json);
      r = await call('PUT', '/api/profile', { settings: { ollamaUrl: '' } });

      process.env.OLLAMA_URL = 'http://ollama.internal:11434';
      check('ollama: with an owner address everyone else uses it', pol.effectiveOllamaUrl('http://10.0.0.5:11434', DEF) === 'http://ollama.internal:11434');
    } finally { restore(); await call('PUT', '/api/profile', { settings: { ollamaUrl: '' } }); }
  }
  // ---- PEB-72: migrations take a lock and can be re-run ----
  {
    const dbm = await import(pathToFileURL(path.resolve('dist/server/db.js')).href);
    const P = dbm.default;
    const fsm = await import('node:fs'); const osm = await import('node:os');
    const dir = fsm.mkdtempSync(path.join(osm.tmpdir(), 'peblo-mig-'));
    const put = (name, sql) => fsm.writeFileSync(path.join(dir, name), sql);
    const cols = async () => (await P.$queryRawUnsafe("SELECT COLUMN_NAME AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'mig_t1'")).map((x) => x.c).sort();
    const versions = async () => (await P.$queryRawUnsafe('SELECT version AS v FROM `_peblo_migrations` WHERE version >= 9000 ORDER BY version')).map((x) => Number(x.v));
    const cleanup = async () => { await P.$executeRawUnsafe('DROP TABLE IF EXISTS mig_t1'); await P.$executeRawUnsafe('DELETE FROM `_peblo_migrations` WHERE version >= 9000'); };
    try {
      await cleanup();
      put('9001_a.sql', 'CREATE TABLE mig_t1 (id INT PRIMARY KEY, a INT);\nALTER TABLE mig_t1 ADD COLUMN b INT;\n');
      const rs = await Promise.allSettled([1, 2, 3, 4].map(() => dbm.runMigrations(dir, 30)));
      check('migrations: four apps starting together on an old database all succeed', rs.every((x) => x.status === 'fulfilled'), rs.map((x) => x.reason?.message));
      check('migrations: the change was applied exactly once', JSON.stringify(await cols()) === '["a","b","id"]' && JSON.stringify(await versions()) === '[9001]', [await cols(), await versions()]);

      put('9002_b.sql', 'ALTER TABLE mig_t1 ADD COLUMN c INT;\nALTER TABLE mig_t1 ADD COLUMN d INT;\n');
      await P.$executeRawUnsafe('ALTER TABLE mig_t1 ADD COLUMN c INT'); // the first step ran before the app died
      let err2 = null; try { await dbm.runMigrations(dir, 30); } catch (e) { err2 = e; }
      check('migrations: a migration that died halfway can be run again', !err2 && (await cols()).join() === 'a,b,c,d,id' && (await versions()).join() === '9001,9002', [err2?.message, await cols()]);

      put('9003_c.sql', 'ALTER TABLE mig_t1 ADD COLUMN e INT;\nALTER TABLE nope_missing ADD COLUMN x INT;\n');
      let failed = false; try { await dbm.runMigrations(dir, 30); } catch { failed = true; }
      check('migrations: a real error still stops the start and is not recorded', failed && !(await versions()).includes(9003));
      put('9003_c.sql', 'ALTER TABLE mig_t1 ADD COLUMN e INT;\nALTER TABLE mig_t1 ADD COLUMN f INT;\n');
      let err3 = null; try { await dbm.runMigrations(dir, 30); } catch (e) { err3 = e; }
      check('migrations: after the file is fixed the rest runs (the finished step is skipped)', !err3 && (await cols()).includes('f') && (await versions()).includes(9003), [err3?.message, await cols()]);

      const lock = await P.$queryRawUnsafe("SELECT GET_LOCK('peblo_migrate', 1) AS got");
      check('migrations: the lock is released when done', Number(lock[0].got) === 1);
      await P.$queryRawUnsafe("SELECT RELEASE_LOCK('peblo_migrate')");
    } finally { await cleanup(); fsm.rmSync(dir, { recursive: true, force: true }); }
  }
} catch (err) {
  failures++;
  console.error(err);
} finally {
  server.close();
  const { default: prisma } = await import(pathToFileURL(path.resolve('dist/server/db.js')).href);
  try { await prisma.user.deleteMany({ where: { email: { in: [emailA, emailB, emailC, emailD] } } }); } catch {} // cascades to everything they created
  await prisma.$disconnect();
  console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
  process.exit(failures ? 1 : 0);
}

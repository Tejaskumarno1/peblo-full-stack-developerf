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
  check('profile update + key saved', r.status === 200 && r.json.user.name === 'Tejas' && r.json.user.settings.fontSize === 'large' && r.json.user.settings.geminiKey === 'test-key', r.json);

  // API keys are encrypted at rest and kept out of the settings JSON.
  const { default: prisma } = await import(pathToFileURL(path.resolve('dist/server/db.js')).href);
  const keyRow = await prisma.userApiKeys.findUnique({ where: { userId: userAId } });
  const userRow = await prisma.user.findUnique({ where: { id: userAId } });
  check('API key is encrypted in the database', !!keyRow?.geminiKey && keyRow.geminiKey.startsWith('enc:v1:') && !keyRow.geminiKey.includes('test-key'), keyRow);
  check('API key is not duplicated in the settings JSON', userRow.settings.geminiKey === undefined && userRow.settings.fontSize === 'large', userRow.settings);

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


  r = await call('GET', '/notes/some-id');
  check('SPA route serves index.html', r.status === 200 && String(r.json).includes('<div id="root">'));
} catch (err) {
  failures++;
  console.error(err);
} finally {
  server.close();
  const { default: prisma } = await import(pathToFileURL(path.resolve('dist/server/db.js')).href);
  try { await prisma.user.deleteMany({ where: { email: { in: [emailA, emailB] } } }); } catch {} // cascades to everything they created
  await prisma.$disconnect();
  console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
  process.exit(failures ? 1 : 0);
}

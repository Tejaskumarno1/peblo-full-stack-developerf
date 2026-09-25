// Starts the compiled server against a throwaway SQLite file and exercises the main API routes.
// Usage: npm run build:server && node scripts/smoke-test.mjs
import { mkdtempSync, rmSync } from 'fs';
import os from 'os';
import path from 'path';
import { pathToFileURL } from 'url';

const tmp = mkdtempSync(path.join(os.tmpdir(), 'peblo-smoke-'));
process.env.DATABASE_URL = 'file:' + path.join(tmp, 'test.db').replace(/\\/g, '/');
process.env.PEBLO_SQL_DIR = path.resolve('server/prisma/sql');
delete process.env.OPENAI_API_KEY;
delete process.env.GEMINI_API_KEY;
delete process.env.GEMINI_API_KEYS;

const { startServer } = await import(pathToFileURL(path.resolve('dist/server/index.js')).href);
const { server, port } = await startServer({ port: 0, staticDir: path.resolve('client/dist') });
const base = `http://127.0.0.1:${port}`;

let failures = 0;
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
  check('profile loads without login', r.status === 200 && r.json.user?.id === 'local-user', r.json);

  r = await call('PUT', '/api/profile', { name: 'Tejas', settings: { fontSize: 'large', geminiKey: 'test-key' } });
  check('profile update + key saved', r.status === 200 && r.json.user.name === 'Tejas' && r.json.user.settings.fontSize === 'large', r.json);

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
  check('dashboard insights', r.status === 200 && r.json.totalNotes === 1 && r.json.topTags[0]?.name === 'work', r.json);

  r = await call('GET', '/api/dashboard/daily-briefing');
  check('daily briefing', r.status === 200 && typeof r.json.stats.totalActive === 'number', r.json);

  r = await call('GET', '/api/dashboard/weekly-report');
  check('weekly report', r.status === 200 && r.json.dailyBreakdown.length === 7 && r.json.stats.tasksCompleted === 1, r.json);

  r = await call('PUT', '/api/profile', { settings: { geminiKey: '', openAiKey: '' } });
  r = await call('POST', `/api/notes/${noteId}/ai/title`, { content: 'x' });
  check('AI without key gives a clear answer (no crash)', r.status < 500 || /AI Providers/.test(JSON.stringify(r.json)), r);

  r = await call('DELETE', `/api/notes/${noteId}`);
  check('move note to trash', r.status === 200, r.json);
  r = await call('POST', `/api/notes/${noteId}/restore`);
  check('restore note', r.status === 200, r.json);

  r = await call('GET', '/notes/some-id');
  check('SPA route serves index.html', r.status === 200 && String(r.json).includes('<div id="root">'));
} catch (err) {
  failures++;
  console.error(err);
} finally {
  server.close();
  const { default: prisma } = await import(pathToFileURL(path.resolve('dist/server/db.js')).href);
  await prisma.$disconnect();
  try { rmSync(tmp, { recursive: true, force: true }); } catch {}
  console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
  process.exit(failures ? 1 : 0);
}

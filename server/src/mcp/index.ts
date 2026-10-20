/*
 * Peblo MCP server (PEB-95): lets Claude Desktop, Cursor and other MCP clients read and write your notes and tasks.
 * It is a thin client of the Peblo REST API, so every rule the app enforces (ownership, validation) still applies.
 *
 *   PEBLO_URL    where Peblo's server runs, e.g. http://localhost:4000  (the desktop app picks a random port, so use `npm run serve`
 *                or your hosted server)
 *   PEBLO_TOKEN  a personal access token made in Settings > Data > Access tokens (starts with pbl_)
 *
 * It never deletes anything: no tool removes a note or a task.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const BASE = (process.env.PEBLO_URL || '').replace(/\/+$/, '');
const TOKEN = process.env.PEBLO_TOKEN || '';
if (!BASE || !TOKEN) {
  console.error('Set PEBLO_URL (for example http://localhost:4000) and PEBLO_TOKEN (made in Peblo: Settings > Data > Access tokens).');
  process.exit(1);
}

async function api(method: string, path: string, body?: unknown): Promise<any> {
  const res = await fetch(BASE + '/api' + path, {
    method,
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data: any = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { error: text.slice(0, 200) }; }
  if (!res.ok) throw new Error(data?.error || `Peblo answered ${res.status}`);
  return data;
}

const ok = (value: unknown) => ({ content: [{ type: 'text' as const, text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }] });
const fail = (e: unknown) => ({ isError: true, content: [{ type: 'text' as const, text: e instanceof Error ? e.message : String(e) }] });
const run = (fn: () => Promise<unknown>) => fn().then(ok, fail);

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** Plain text becomes paragraphs; anything that already looks like HTML is kept. */
const toHtml = (s: string) => (/^\s*</.test(s) ? s : s.split(/\n{2,}/).map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`).join(''));
const strip = (html: string) => String(html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

const server = new McpServer({ name: 'peblo', version: '1.0.0' });
const readOnly = { readOnlyHint: true, openWorldHint: false };
const writes = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };

server.registerTool('search_notes', {
  description: 'Search the user\'s Peblo notes by text, optionally by tag. Returns titles, tags and a short preview.',
  inputSchema: { query: z.string().optional().describe('Words to look for'), tag: z.string().optional(), limit: z.number().int().min(1).max(50).optional() },
  annotations: readOnly,
}, ({ query, tag, limit }) => run(async () => {
  const q = new URLSearchParams({ limit: String(limit ?? 20), snippet: '1' });
  if (query) q.set('search', query);
  if (tag) q.set('tag', tag);
  const { notes } = await api('GET', '/notes?' + q);
  return (notes || []).map((n: any) => ({ id: n.id, title: n.title, tags: n.tags, updatedAt: n.updatedAt, preview: n.snippet ?? strip(n.content).slice(0, 200) }));
}));

server.registerTool('get_note', {
  description: 'Read one note in full by id.',
  inputSchema: { id: z.string() },
  annotations: readOnly,
}, ({ id }) => run(async () => {
  const { note } = await api('GET', '/notes/' + encodeURIComponent(id));
  return { id: note.id, title: note.title, tags: note.tags, updatedAt: note.updatedAt, text: strip(note.content), html: note.content };
}));

server.registerTool('create_note', {
  description: 'Create a new note. Plain text is fine; blank lines make paragraphs.',
  inputSchema: { title: z.string().min(1), content: z.string().optional(), tags: z.array(z.string()).optional() },
  annotations: writes,
}, ({ title, content, tags }) => run(async () => {
  const { note } = await api('POST', '/notes', { title, content: toHtml(content ?? ''), tags: tags ?? [] });
  return { id: note.id, title: note.title };
}));

server.registerTool('append_to_note', {
  description: 'Add text to the end of an existing note without changing what is already there.',
  inputSchema: { id: z.string(), text: z.string().min(1) },
  annotations: writes,
}, ({ id, text }) => run(async () => {
  const { note } = await api('GET', '/notes/' + encodeURIComponent(id));
  await api('PATCH', '/notes/' + encodeURIComponent(id), { content: (note.content || '') + toHtml(text) });
  return `Added to "${note.title}".`;
}));

server.registerTool('list_tasks', {
  description: 'List the user\'s tasks. With a date (YYYY-MM-DD) it lists that day; without one it lists what is due today, overdue and upcoming.',
  inputSchema: { date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), includeDone: z.boolean().optional() },
  annotations: readOnly,
}, ({ date, includeDone }) => run(async () => {
  const slim = (t: any) => ({ id: t.id, text: t.text, completed: t.completed, priority: t.priority, deadline: t.deadline, tags: t.tags });
  if (date) {
    const { todos } = await api('GET', '/todos?date=' + date);
    return (todos || []).filter((t: any) => includeDone || !t.completed).map(slim);
  }
  const d = await api('GET', '/todos/today');
  const keep = (a: any[]) => (a || []).filter((t) => includeDone || !t.completed).map(slim);
  return { today: keep(d.todayTasks), overdue: keep(d.overdueTasks), upcoming: keep(d.upcomingTasks) };
}));

server.registerTool('create_task', {
  description: 'Add a task. deadline is an ISO date or date-time; priority is low, medium or high.',
  inputSchema: { text: z.string().min(1), deadline: z.string().optional(), priority: z.enum(['low', 'medium', 'high']).optional(), tags: z.array(z.string()).optional() },
  annotations: writes,
}, (args) => run(async () => {
  const { todo } = await api('POST', '/todos', args);
  return { id: todo.id, text: todo.text, deadline: todo.deadline };
}));

server.registerTool('complete_task', {
  description: 'Mark a task done (or not done again).',
  inputSchema: { id: z.string(), completed: z.boolean().optional().describe('Defaults to true') },
  annotations: { ...writes, idempotentHint: true },
}, ({ id, completed }) => run(async () => {
  const { todo } = await api('PATCH', '/todos/' + encodeURIComponent(id), { completed: completed ?? true });
  return { id: todo.id, text: todo.text, completed: todo.completed };
}));

server.registerTool('list_tags', {
  description: 'List the tags (topics) the user has, with how many notes use each.',
  inputSchema: {},
  annotations: readOnly,
}, () => run(() => api('GET', '/tags')));

await server.connect(new StdioServerTransport());

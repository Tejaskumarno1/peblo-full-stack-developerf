/*
 * The Peblo MCP tools. One place builds the server so the local (stdio) program and the hosted /mcp endpoint offer exactly the same tools.
 * It is a thin client of the Peblo REST API (base + bearer token), so every rule the app enforces (ownership, validation, read-only tokens) still applies.
 * It never permanently deletes anything: notes can be moved to the trash (and restored), but no tool empties it or removes a task.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

export type ToolLog = (tool: string, summary: string, ok: boolean) => void;

export function createPebloMcp(BASE: string, TOKEN: string, log?: ToolLog): McpServer {
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
const toHtml = (s: string) => s.trim(); // notes are stored as Markdown now, so plain text and Markdown go in as they are
const strip = (md: string) => String(md || '').replace(/<figure>[\s\S]*?<\/figure>/g, ' [attachment] ').replace(/!\[[^\]]*\]\([^)]*\)/g, ' [picture] ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

const server = new McpServer({ name: 'peblo', version: '1.1.0' });
// every tool call is noted (what, and whether it worked) so the person can see it in Settings > Connect apps
const summaryOf = (a: any) => String(a?.title ?? a?.text ?? a?.query ?? a?.tag ?? a?.date ?? a?.from ?? a?.id ?? '').replace(/\s+/g, ' ').trim();
const register = server.registerTool.bind(server) as any;
(server as any).registerTool = (name: string, cfg: any, handler: any) => register(name, cfg, async (args: any, extra: any) => {
  const r = await handler(args, extra);
  try { log?.(name, summaryOf(args), !r?.isError); } catch { /* logging never breaks a tool */ }
  return r;
});
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
  return { id: note.id, title: note.title, tags: note.tags, updatedAt: note.updatedAt, text: strip(note.content), markdown: note.content };
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
  await api('PATCH', '/notes/' + encodeURIComponent(id), { content: (note.content || '').replace(/\s+$/, '') + '\n\n' + toHtml(text) });
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
  inputSchema: {
    text: z.string().min(1), deadline: z.string().optional(), priority: z.enum(['low', 'medium', 'high']).optional(), tags: z.array(z.string()).optional(),
    startTime: z.string().optional().describe('Start time of day, HH:MM, to make it a calendar event'), endTime: z.string().optional().describe('End time, HH:MM'),
    recurrence: z.enum(['none', 'daily', 'weekdays', 'weekly', 'monthly', 'yearly']).optional(), noteId: z.string().optional().describe('Link the task to a note'),
  },
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

server.registerTool('update_note', {
  description: 'Change a note: rename it, replace its text (Markdown) or set its tags. Only the fields you give are changed. To add text without replacing, use append_to_note.',
  inputSchema: { id: z.string(), title: z.string().min(1).optional(), content: z.string().optional().describe('The whole new text. Replaces what is there.'), tags: z.array(z.string()).optional().describe('The full list of tags the note should have') },
  annotations: { ...writes, idempotentHint: true },
}, ({ id, title, content, tags }) => run(async () => {
  const patch: Record<string, unknown> = {};
  if (title !== undefined) patch.title = title;
  if (content !== undefined) patch.content = toHtml(content);
  if (tags !== undefined) patch.tags = tags;
  if (!Object.keys(patch).length) throw new Error('Give a title, content or tags to change.');
  await api('PATCH', '/notes/' + encodeURIComponent(id), patch);
  const { note } = await api('GET', '/notes/' + encodeURIComponent(id));
  return { id: note.id, title: note.title, tags: note.tags };
}));

server.registerTool('update_task', {
  description: 'Change a task: its text, deadline (ISO date or date-time), priority, or the note it is linked to (noteId, or null to unlink).',
  inputSchema: {
    id: z.string(), text: z.string().min(1).optional(), deadline: z.string().nullable().optional(), priority: z.enum(['low', 'medium', 'high']).optional(), noteId: z.string().nullable().optional(),
    startTime: z.string().nullable().optional(), endTime: z.string().nullable().optional(), recurrence: z.enum(['none', 'daily', 'weekdays', 'weekly', 'monthly', 'yearly']).optional(),
    tags: z.array(z.string()).optional(), scope: z.enum(['this', 'following', 'all']).optional().describe('For repeating tasks: which occurrences to change'),
  },
  annotations: { ...writes, idempotentHint: true },
}, ({ id, ...patch }) => run(async () => {
  const body = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
  if (!Object.keys(body).length) throw new Error('Give something to change.');
  const { todo } = await api('PATCH', '/todos/' + encodeURIComponent(id), body);
  return { id: todo.id, text: todo.text, deadline: todo.deadline, priority: todo.priority, noteId: todo.noteId };
}));

server.registerTool('get_calendar', {
  description: 'Tasks and events with a deadline between two dates (YYYY-MM-DD, inclusive), for planning a week or a month.',
  inputSchema: { from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), includeDone: z.boolean().optional() },
  annotations: readOnly,
}, ({ from, to, includeDone }) => run(async () => {
  const { todos } = await api('GET', `/todos?from=${from}T00:00:00.000Z&to=${to}T23:59:59.999Z`);
  return (todos || []).filter((t: any) => includeDone || !t.completed).map((t: any) => ({ id: t.id, text: t.text, deadline: t.deadline, startTime: t.startTime, endTime: t.endTime, priority: t.priority, completed: t.completed }));
}));

server.registerTool('create_share_link', {
  description: 'Make a public link to one note or task, so anyone with the link can open it. edit=true lets them edit too. The link is returned.',
  inputSchema: { kind: z.enum(['note', 'todo']), id: z.string(), edit: z.boolean().optional() },
  annotations: { ...writes, idempotentHint: true },
}, ({ kind, id, edit }) => run(async () => {
  const { token, edit: canEdit } = await api('POST', `/share/${kind}/${encodeURIComponent(id)}`, { edit: !!edit });
  const cfg = await api('GET', '/config').catch(() => ({}));
  const base = (cfg as any)?.publicUrl || BASE;
  return { url: `${base}/s/${kind}/${token}`, canEdit: !!canEdit };
}));

server.registerTool('stop_sharing', {
  description: 'Turn off the public link of a note or task. The old link stops working straight away.',
  inputSchema: { kind: z.enum(['note', 'todo']), id: z.string() },
  annotations: { ...writes, idempotentHint: true },
}, ({ kind, id }) => run(async () => { await api('DELETE', `/share/${kind}/${encodeURIComponent(id)}`); return 'The link is off.'; }));

server.registerTool('archive_note', {
  description: 'Archive a note (hide it from the main list) or bring it back (archived=false). Nothing is lost.',
  inputSchema: { id: z.string(), archived: z.boolean().optional().describe('Defaults to true') },
  annotations: { ...writes, idempotentHint: true },
}, ({ id, archived }) => run(async () => {
  await api('PATCH', '/notes/' + encodeURIComponent(id), { isArchived: archived ?? true });
  return (archived ?? true) ? 'Archived.' : 'Back in the main list.';
}));

server.registerTool('pin_note', {
  description: 'Pin a note to the top of the list, or unpin it (pinned=false).',
  inputSchema: { id: z.string(), pinned: z.boolean().optional().describe('Defaults to true') },
  annotations: { ...writes, idempotentHint: true },
}, ({ id, pinned }) => run(async () => {
  const { note } = await api('GET', '/notes/' + encodeURIComponent(id));
  await api('PATCH', '/notes/' + encodeURIComponent(id), { meta: { ...(note.meta || {}), pinned: pinned ?? true } });
  return (pinned ?? true) ? 'Pinned.' : 'Unpinned.';
}));

server.registerTool('trash_note', {
  description: 'Move a note to the trash. It is NOT deleted: it stays in the trash and restore_note brings it back.',
  inputSchema: { id: z.string() },
  annotations: { ...writes, idempotentHint: true },
}, ({ id }) => run(async () => { await api('DELETE', '/notes/' + encodeURIComponent(id)); return 'Moved to the trash. restore_note brings it back.'; }));

server.registerTool('restore_note', {
  description: 'Bring a note back from the trash.',
  inputSchema: { id: z.string() },
  annotations: { ...writes, idempotentHint: true },
}, ({ id }) => run(async () => { await api('POST', '/notes/' + encodeURIComponent(id) + '/restore'); return 'Restored.'; }));

server.registerTool('list_trash', {
  description: 'List notes in the trash (title and id), so one can be restored.',
  inputSchema: {},
  annotations: readOnly,
}, () => run(async () => {
  const { notes } = await api('GET', '/notes?deleted=true&limit=50');
  return (notes || []).map((n: any) => ({ id: n.id, title: n.title, updatedAt: n.updatedAt }));
}));

server.registerTool('get_backlinks', {
  description: 'Which notes link to this note.',
  inputSchema: { id: z.string() },
  annotations: readOnly,
}, ({ id }) => run(async () => (await api('GET', '/notes/' + encodeURIComponent(id) + '/backlinks')).backlinks));

server.registerTool('list_note_history', {
  description: 'Saved earlier versions of a note (newest first), with their ids.',
  inputSchema: { id: z.string() },
  annotations: readOnly,
}, ({ id }) => run(async () => (await api('GET', '/notes/' + encodeURIComponent(id) + '/backups')).backups));

server.registerTool('restore_note_version', {
  description: 'Put a note back to one of its earlier versions (from list_note_history). The current text is saved as a version first, so this can be undone.',
  inputSchema: { id: z.string(), versionId: z.string() },
  annotations: { ...writes, idempotentHint: true },
}, ({ id, versionId }) => run(async () => { await api('POST', '/notes/' + encodeURIComponent(id) + '/backups/' + encodeURIComponent(versionId) + '/revert'); return 'Restored that version.'; }));

server.registerTool('rename_tag', {
  description: 'Rename a tag everywhere. If the new name already exists the two are merged.',
  inputSchema: { from: z.string().min(1), to: z.string().min(1) },
  annotations: writes,
}, ({ from, to }) => run(() => api('POST', '/tags/rename', { from, to })));

server.registerTool('list_tags', {
  description: 'List the tags (topics) the user has, with how many notes use each.',
  inputSchema: {},
  annotations: readOnly,
}, () => run(() => api('GET', '/tags')));
  return server;
}

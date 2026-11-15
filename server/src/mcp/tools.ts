/*
 * The Peblo MCP tools. One place builds the server so the local (stdio) program and the hosted /mcp endpoint offer exactly the same tools.
 * It is a thin client of the Peblo REST API (base + bearer token), so every rule the app enforces (ownership, validation, read-only tokens) still applies.
 * It never permanently deletes anything: notes can be moved to the trash (and restored), but no tool empties it or removes a task.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

/** Bump when a tool is added or its answer changes. A tool is never renamed or removed, and a new required input is never added to an existing tool. */
export const MCP_VERSION = '1.2.0';

export type ToolLog = (tool: string, summary: string, ok: boolean) => void;

/** What went wrong, in words the person (and the model) can act on. */
export function explainFailure(status: number, serverMessage: string | undefined): { message: string; retryable: boolean } {
  const m = serverMessage || '';
  if (status === 401) return { message: 'Peblo does not accept this connection any more (the token was removed, or it is wrong). Connect again in Peblo: Settings > Connect apps.', retryable: false };
  if (status === 403) return { message: m || 'Peblo refused this. The token may be read-only, or the note is #private.', retryable: false };
  if (status === 404) return { message: m || 'Peblo could not find that. Check the id (use search_notes or list_tasks to find it).', retryable: false };
  if (status === 408 || status === 425) return { message: 'Peblo took too long. Try again.', retryable: true };
  if (status === 429) return { message: 'Peblo is rate limiting this connection. Wait a minute, then try again.', retryable: true };
  if (status >= 500) return { message: m || `Peblo had a problem (${status}). If it was asleep it is waking up: try again in a minute.`, retryable: true };
  return { message: m || `Peblo answered ${status}.`, retryable: false };
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function createPebloMcp(BASE: string, TOKEN: string, log?: ToolLog): McpServer {
/** One call to Peblo. Reads (GET) are retried a few times when the server is waking up, busy or briefly unreachable; writes never are, so nothing is saved twice. */
async function api(method: string, path: string, body?: unknown): Promise<any> {
  const reads = method === 'GET';
  const tries = reads ? 4 : 1;
  let last: Error = new Error('Peblo could not be reached.');
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(BASE + '/api' + path, {
        method,
        headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', 'User-Agent': 'peblo-mcp/' + MCP_VERSION },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(reads ? 45_000 : 60_000),
      });
      const text = await res.text();
      let data: any = {};
      try { data = text ? JSON.parse(text) : {}; } catch { data = { error: text.slice(0, 200) }; }
      if (res.ok) return data;
      const f = explainFailure(res.status, data?.error);
      last = new Error(f.message);
      if (!(reads && f.retryable) || i === tries - 1) throw last;
      const wait = Number(res.headers.get('retry-after'));
      await sleep(Math.min(Number.isFinite(wait) && wait > 0 ? wait * 1000 : 1500 * 2 ** i, 15_000));
    } catch (e: any) {
      if (e === last) throw e;
      // network error or timeout (a sleeping host often shows up this way)
      last = new Error(e?.name === 'TimeoutError' ? 'Peblo did not answer in time. It may be waking up: try again in a minute.' : 'Peblo could not be reached. Check that it is running and the address is right.');
      if (i === tries - 1) throw last;
      await sleep(Math.min(1500 * 2 ** i, 15_000));
    }
  }
  throw last;
}

const ok = (value: unknown) => ({ content: [{ type: 'text' as const, text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }] });
const fail = (e: unknown) => ({ isError: true, content: [{ type: 'text' as const, text: e instanceof Error ? e.message : String(e) }] });
const run = (fn: () => Promise<unknown>) => fn().then(ok, fail);

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** Plain text becomes paragraphs; anything that already looks like HTML is kept. */
const toHtml = (s: string) => s.trim(); // notes are stored as Markdown now, so plain text and Markdown go in as they are
const strip = (md: string) => String(md || '').replace(/<figure>[\s\S]*?<\/figure>/g, ' [attachment] ').replace(/!\[[^\]]*\]\([^)]*\)/g, ' [picture] ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

/** What an AI should see of a note: embedded files become a short marker, broken characters are dropped, nothing is huge. */
const cleanContent = (md: string) => {
  let embedded = 0; let corrupt = 0;
  const text = String(md || '')
    .replace(/data:([a-z]+\/[\w.+-]+)(?:;[\w=.+-]+)*;base64,[A-Za-z0-9+/=\s]{200,}/gi, (m, mime) => { embedded += 1; return `[embedded ${mime}, about ${Math.max(1, Math.round((m.length * 0.75) / 1024))} KB, not shown]`; })
    .replace(/\uFFFD+/g, () => { corrupt += 1; return ' '; });
  return { text, embedded, corrupt };
};
/** The same create asked twice within a minute (a client retry, a repeated message) is done once. */
const recent = (() => {
  const seen = new Map<string, { at: number; out: any }>();
  const keyOf = (kind: string, a: any) => kind + ':' + JSON.stringify(a, Object.keys(a || {}).sort());
  return {
    find(kind: string, a: any) { const e = seen.get(keyOf(kind, a)); return e && Date.now() - e.at < 60_000 ? e.out : null; },
    add(kind: string, a: any, out: any) { seen.set(keyOf(kind, a), { at: Date.now(), out }); if (seen.size > 200) for (const [k, v] of seen) if (Date.now() - v.at > 60_000) seen.delete(k); },
  };
})();
/** Reminders (minutes before) and travel time live in the task's meta. */
const taskMeta = (a: { reminders?: number[]; travelMin?: number | null }) => {
  const m: Record<string, unknown> = {};
  if (a.reminders !== undefined) { m.reminders = a.reminders; m.remindMin = a.reminders.length ? Math.min(...a.reminders) : null; }
  if (a.travelMin !== undefined) m.travelMin = a.travelMin;
  return m;
};
const norm = (s: string) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();

const server = new McpServer({ name: 'peblo', version: MCP_VERSION });
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

server.registerTool('get_status', {
  description: 'Check the connection: Peblo\'s version, the person\'s time zone and today\'s date there, whether this connection can change things (read-only or not), and that #private notes are hidden from it. Call this first when dates matter.',
  inputSchema: {},
  annotations: readOnly,
}, () => run(async () => {
  const me = await api('GET', '/whoami');
  return { connector: 'peblo', version: MCP_VERSION, ...me, canWrite: !me.readOnly };
}));

server.registerTool('search_all', {
  description: 'Search everything at once and get results grouped: notes, tasks, tags and calendar events that match the words. Good first step when the person says "find everything about X". #private notes are never included.',
  inputSchema: { query: z.string().min(2), limit: z.number().int().min(1).max(10).optional().describe('Most results per group (default 5)') },
  annotations: readOnly,
}, ({ query, limit }) => run(async () => {
  const per = limit ?? 5; const q = norm(query);
  const [{ notes }, { todos }, tags] = await Promise.all([
    api('GET', '/notes?' + new URLSearchParams({ search: query, limit: String(per), snippet: '1' })),
    api('GET', '/todos'),
    api('GET', '/tags').catch(() => ({ tags: [] })),
  ]);
  const hit = (t: any) => !t.completed && norm(t.text).includes(q);
  const tasks = (todos || []).filter((t: any) => hit(t) && !t.startTime);
  const events = (todos || []).filter((t: any) => hit(t) && t.startTime);
  const tagList = ((tags as any).tags || tags || []).filter((g: any) => norm(g.name ?? g).includes(q.replace(/^#/, '')));
  const slim = (t: any) => ({ id: t.id, text: t.text, deadline: t.deadline, ...(t.startTime ? { startTime: t.startTime, endTime: t.endTime } : {}), priority: t.priority });
  return {
    notes: (notes || []).map((n: any) => ({ id: n.id, title: n.title, tags: n.tags, preview: strip(cleanContent(n.snippet ?? n.content).text).slice(0, 160) })),
    tasks: { count: tasks.length, items: tasks.slice(0, per).map(slim) },
    tags: tagList.slice(0, per),
    events: { count: events.length, items: events.slice(0, per).map(slim) },
  };
}));

server.registerTool('search_notes', {
  description: 'Search the user\'s Peblo notes by text, optionally by tag. Returns titles, tags and a short preview. Empty notes are left out and near-identical results are merged (the count is reported); pass include_empty or include_duplicates to see them.',
  inputSchema: { query: z.string().optional().describe('Words to look for'), tag: z.string().optional(), limit: z.number().int().min(1).max(50).optional(), offset: z.number().int().min(0).max(5000).optional().describe('Skip this many results (to read the next page)'), include_empty: z.boolean().optional(), include_duplicates: z.boolean().optional() },
  annotations: readOnly,
}, ({ query, tag, limit, offset, include_empty, include_duplicates }) => run(async () => {
  const q = new URLSearchParams({ limit: String(limit ?? 20), snippet: '1' });
  if (offset) q.set('offset', String(offset));
  if (query) q.set('search', query);
  if (tag) q.set('tag', tag);
  const { notes } = await api('GET', '/notes?' + q);
  let skippedEmpty = 0; let merged = 0;
  const seen = new Map<string, any>();
  const out: any[] = [];
  for (const n of notes || []) {
    const clean = cleanContent(n.snippet ?? n.content);
    const preview = strip(clean.text).slice(0, 200);
    const untitled = !n.title || /^untitled$/i.test(String(n.title).trim());
    if (!include_empty && untitled && !preview) { skippedEmpty += 1; continue; }
    const row = { id: n.id, title: n.title, tags: n.tags, updatedAt: n.updatedAt, preview, ...(clean.corrupt ? { damagedCharacters: true } : {}) };
    const key = norm(n.title) + '|' + norm(preview);
    if (!include_duplicates && seen.has(key)) { seen.get(key).duplicates = (seen.get(key).duplicates || 0) + 1; merged += 1; continue; }
    seen.set(key, row); out.push(row);
  }
  const more = (notes || []).length >= (limit ?? 20) ? { nextOffset: (offset ?? 0) + (notes || []).length } : {};
  return skippedEmpty || merged || more.nextOffset !== undefined ? { notes: out, ...(skippedEmpty ? { skippedEmpty } : {}), ...(merged ? { mergedDuplicates: merged } : {}), ...more } : out;
}));

server.registerTool('get_note', {
  description: 'Read one note by id. Long notes come back in parts: pass offset (the nextOffset of the last answer) to continue. Embedded audio, video and files are replaced by a short marker, so the answer stays small.',
  inputSchema: { id: z.string(), offset: z.number().int().min(0).optional().describe('Character to start from (default 0)'), max_chars: z.number().int().min(1000).max(60000).optional().describe('Most characters to return (default 20000)') },
  annotations: readOnly,
}, ({ id, offset, max_chars }) => run(async () => {
  const { note } = await api('GET', '/notes/' + encodeURIComponent(id));
  const clean = cleanContent(note.content);
  const from = offset ?? 0; const size = max_chars ?? 20000;
  const part = clean.text.slice(from, from + size);
  const next = from + size < clean.text.length ? from + size : null;
  return {
    id: note.id, title: note.title, tags: note.tags, updatedAt: note.updatedAt,
    totalChars: clean.text.length, offset: from, nextOffset: next, truncated: next !== null,
    ...(clean.embedded ? { embeddedFilesHidden: clean.embedded } : {}),
    ...(clean.corrupt ? { note: 'Some characters in this note were damaged when it was saved and were dropped.' } : {}),
    ...(clean.text.trim() === '' ? { empty: true } : {}),
    markdown: part,
    ...(part.length <= 6000 ? { text: strip(part) } : {}),
  };
}));

// Pictures. A picture comes back as a real image result, so the AI sees it instead of only reading its address.
const MAX_PICTURE = 5 * 1024 * 1024;
const mediaIdOf = (v: string) => (/\/api\/media\/([\w-]{8,64})/.exec(v) || /^([\w-]{8,64})$/.exec(v.trim()) || [])[1];
async function fetchPicture(id: string) {
  const res = await fetch(`${BASE}/api/media/${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${TOKEN}` }, signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`That picture could not be read (${res.status}).`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_PICTURE) throw new Error('That picture is larger than 5 MB.');
  const mimeType = (res.headers.get('content-type') || 'image/webp').split(';')[0];
  return { type: 'image' as const, data: buf.toString('base64'), mimeType };
}

server.registerTool('get_image', {
  description: 'Look at one picture from a note. Give the picture address (https://.../api/media/<id>) or just its id; the picture comes back as an image you can see.',
  inputSchema: { image: z.string().describe('Picture address or id') },
  annotations: readOnly,
}, async ({ image }) => {
  try {
    const id = mediaIdOf(image); if (!id) throw new Error('That is not a Peblo picture address.');
    return { content: [await fetchPicture(id)] };
  } catch (e) { return fail(e); }
});

server.registerTool('read_shared_link', {
  description: 'Read a Peblo share link (https://.../s/note/<token>): its text, and the pictures on it as images you can see. Use this when someone pastes a share link.',
  inputSchema: { url: z.string().describe('The share link'), pictures: z.boolean().optional().describe('Return the pictures too (default true, at most 6)') },
  annotations: readOnly,
}, async ({ url, pictures }) => {
  try {
    const m = /\/s\/note\/([A-Za-z0-9_-]{20,40})/.exec(url); if (!m) throw new Error('That is not a Peblo note share link.');
    const res = await fetch(`${BASE}/s/note/${m[1]}.md`, { headers: { Accept: 'text/markdown' }, signal: AbortSignal.timeout(60_000) });
    const text = await res.text();
    if (!res.ok) throw new Error(text.slice(0, 200) || `The link answered ${res.status}.`);
    const out: any[] = [{ type: 'text' as const, text }];
    if (pictures !== false) {
      const ids = [...new Set([...text.matchAll(/\/api\/media\/([\w-]{8,64})/g)].map((x) => x[1]))].slice(0, 6);
      for (const id of ids) { try { out.push(await fetchPicture(id)); } catch { /* the address stays in the text */ } }
    }
    return { content: out };
  } catch (e) { return fail(e); }
});

server.registerTool('create_note', {
  description: 'Create a new note. Plain text is fine; blank lines make paragraphs.',
  inputSchema: { title: z.string().min(1), content: z.string().optional(), tags: z.array(z.string()).optional() },
  annotations: writes,
}, ({ title, content, tags }) => run(async () => {
  const dup = recent.find('note', { title, content, tags });
  if (dup) return { ...dup, duplicate: 'You created this a moment ago, so it was not created again.' };
  const { note } = await api('POST', '/notes', { title, content: toHtml(content ?? ''), tags: tags ?? [] });
  const out = { id: note.id, title: note.title };
  recent.add('note', { title, content, tags }, out);
  return out;
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
    recurrence: z.union([z.enum(['none', 'daily', 'weekdays', 'weekly', 'monthly', 'yearly']), z.string().regex(/^every:[1-9]\d{0,2}:(day|week|month|year)$/)]).describe('none, daily, weekdays, weekly, monthly, yearly, or every:<n>:<day|week|month|year> such as every:3:day').optional(), noteId: z.string().optional().describe('Link the task to a note'),
    reminders: z.array(z.number().int().min(0).max(43200)).max(6).optional().describe('Minutes before it starts to remind, e.g. [10, 1440]'), travelMin: z.number().int().min(1).max(600).optional().describe('Minutes it takes to get there; Peblo says when to leave'),
  },
  annotations: writes,
}, (args) => run(async () => {
  // When the person asked to approve what Claude adds (Plan my day), Peblo's server holds the task in their approval inbox.
  const dup = recent.find('task', args);
  if (dup) return { ...dup, duplicate: 'You added this a moment ago, so it was not added again.' };
  const { reminders, travelMin, ...rest } = args as any;
  const meta = taskMeta({ reminders, travelMin });
  const { todo } = await api('POST', '/todos', Object.keys(meta).length ? { ...rest, meta } : rest);
  const out = { id: todo.id, text: todo.text, deadline: todo.deadline, ...(todo.meta?.proposal ? { status: 'waiting for the person to approve it' } : {}) };
  recent.add('task', args, out);
  return out;
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
  inputSchema: { id: z.string(), title: z.string().min(1).optional(), content: z.string().optional().describe('The whole new text. Replaces what is there.'), if_updated_at: z.string().optional().describe('Safety check: the updatedAt you last saw. If the note changed since, nothing is written.'), tags: z.array(z.string()).optional().describe('The full list of tags the note should have') },
  annotations: { ...writes, idempotentHint: true },
}, ({ id, title, content, tags, if_updated_at }) => run(async () => {
  const patch: Record<string, unknown> = {};
  if (title !== undefined) patch.title = title;
  if (content !== undefined) patch.content = toHtml(content);
  if (tags !== undefined) patch.tags = tags;
  if (!Object.keys(patch).length) throw new Error('Give a title, content or tags to change.');
  if (if_updated_at) {
    const cur = (await api('GET', '/notes/' + encodeURIComponent(id))).note;
    if (new Date(cur.updatedAt).getTime() !== new Date(if_updated_at).getTime()) throw new Error('This note changed since you read it (now ' + new Date(cur.updatedAt).toISOString() + '). Read it again, merge, then retry. Nothing was written.');
  }
  await api('PATCH', '/notes/' + encodeURIComponent(id), patch);
  const { note } = await api('GET', '/notes/' + encodeURIComponent(id));
  return { id: note.id, title: note.title, tags: note.tags, updatedAt: note.updatedAt };
}));

server.registerTool('update_task', {
  description: 'Change a task: its text, deadline (ISO date or date-time), priority, or the note it is linked to (noteId, or null to unlink).',
  inputSchema: {
    id: z.string(), text: z.string().min(1).optional(), deadline: z.string().nullable().optional(), priority: z.enum(['low', 'medium', 'high']).optional(), noteId: z.string().nullable().optional(),
    startTime: z.string().nullable().optional(), endTime: z.string().nullable().optional(), recurrence: z.union([z.enum(['none', 'daily', 'weekdays', 'weekly', 'monthly', 'yearly']), z.string().regex(/^every:[1-9]\d{0,2}:(day|week|month|year)$/)]).describe('none, daily, weekdays, weekly, monthly, yearly, or every:<n>:<day|week|month|year> such as every:3:day').optional(),
    tags: z.array(z.string()).optional(), scope: z.enum(['this', 'following', 'all']).optional().describe('For repeating tasks: which occurrences to change'),
    reminders: z.array(z.number().int().min(0).max(43200)).max(6).optional().describe('Minutes before it starts to remind; [] clears them'), travelMin: z.number().int().min(1).max(600).nullable().optional().describe('Minutes it takes to get there; null clears it'),
  },
  annotations: { ...writes, idempotentHint: true },
}, ({ id, reminders, travelMin, ...patch }) => run(async () => {
  const body: Record<string, unknown> = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
  const meta = taskMeta({ reminders, travelMin: travelMin === null ? (null as any) : travelMin });
  if (Object.keys(meta).length) body.meta = meta;
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
  annotations: { ...writes, idempotentHint: true, openWorldHint: true }, // makes content public: clients should ask first, so text inside a note cannot trigger it silently
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

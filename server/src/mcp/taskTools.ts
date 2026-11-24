/*
 * MCP 1.4.0: the Kanban and task tools Soft Studio has and the MCP lacked (docs/memory/09-mcp-gaps.md, items 1-20).
 * Thin clients of the REST API, so every server rule still applies. Two rules matter here:
 *  - An access token changes only Personal tasks (utils/scope.ts), so create/update/bulk on a team board answer "not found". Comments and review requests on a team task do work: the server checks team membership itself.
 *  - Nothing here deletes. A task the AI proposes can be listed but only the person can approve it, so the approval inbox keeps its meaning.
 */
import { z } from 'zod';

type Api = (method: string, path: string, body?: unknown, space?: string) => Promise<any>;
const enc = encodeURIComponent;
const norm = (s: string) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
const KEY = z.string().regex(/^[a-z][a-z0-9_]{0,31}$/);

// ---- plain-words parsing, the same words the app's quick-add bar understands (today, tonight, tomorrow, a weekday, at 5pm, !high, #tag)
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const addDays = (ymd: string, n: number) => { const d = new Date(`${ymd}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
/** A local date and time in a named time zone, as an ISO instant. */
export function zonedIso(ymd: string, hhmm: string, tz: string): string {
  const guess = new Date(`${ymd}T${hhmm}:00Z`);
  try {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(guess).map((x) => [x.type, x.value]));
    const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
    return new Date(guess.getTime() - (asUtc - guess.getTime())).toISOString();
  } catch { return guess.toISOString(); }
}
export function parseTaskWords(input: string, today: string): { text: string; priority?: 'high' | 'low'; tags: string[]; date?: string; time?: string } {
  let t = ` ${String(input || '').trim()} `;
  const out: { text: string; priority?: 'high' | 'low'; tags: string[]; date?: string; time?: string } = { text: '', tags: [] };
  const take = (re: RegExp, fn: (m: RegExpExecArray) => void) => { const m = re.exec(t); if (!m) return false; fn(m); t = t.slice(0, m.index) + ' ' + t.slice(m.index + m[0].length); return true; };
  take(/\s!(high|urgent|low)\s/i, (m) => { out.priority = /low/i.test(m[1]) ? 'low' : 'high'; });
  while (take(/\s#([a-z0-9][\w-]*)\s/i, (m) => { out.tags.push(m[1].toLowerCase()); }));
  take(/\s(tomorrow|tmrw|tmr)\s/i, () => { out.date = addDays(today, 1); });
  if (!out.date) take(/\s(today|tonight)\s/i, (m) => { out.date = today; if (/tonight/i.test(m[1])) out.time = '18:30'; });
  if (!out.date) {
    take(/\s(?:on\s+)?(next\s+)?(sun(?:day)?|mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:r|rs|rsday)?|fri(?:day)?|sat(?:urday)?)\s/i, (m) => {
      const want = DAYS.indexOf(m[2].slice(0, 3).toLowerCase());
      const have = new Date(`${today}T00:00:00Z`).getUTCDay();
      let add = (want - have + 7) % 7;
      if (m[1] && add === 0) add = 7;
      out.date = addDays(today, add);
    });
  }
  take(/\s(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\s/i, (m) => {
    let h = Number(m[1]); const mi = m[2] ? Number(m[2]) : 0;
    if (h >= 1 && h <= 12 && mi < 60) { if (/pm/i.test(m[3]) && h < 12) h += 12; if (/am/i.test(m[3]) && h === 12) h = 0; out.time = `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`; }
  });
  if (!out.time) take(/\s(?:at\s+)?([01]?\d|2[0-3]):([0-5]\d)\s/, (m) => { out.time = `${m[1].padStart(2, '0')}:${m[2]}`; });
  out.text = t.replace(/\s+/g, ' ').trim();
  if (out.time && !out.date) out.date = today;
  return out;
}
const words = (s: string) => new Set(norm(s).split(/[^a-z0-9]+/).filter((w) => w.length >= 4));

export function registerTaskTools(
  server: any,
  api: Api,
  spaceIdOf: (space?: string) => Promise<string | undefined>,
  run: (fn: () => Promise<unknown>) => Promise<any>,
  writes: Record<string, unknown>,
  readOnly: Record<string, unknown>,
) {
  const SPACE = z.string().optional().describe('Team or office id or name from list_spaces; omit for Personal');
  const slim = (t: any) => ({ id: t.id, text: t.text, completed: t.completed, priority: t.priority, deadline: t.deadline, tags: t.todoTags ?? t.tags, column: t.completed ? 'done' : t.meta?.status || 'todo', steps: t.meta?.subtasks });

  const allTasks = async (sp?: string): Promise<any[]> => ((await api('GET', '/todos?limit=2000', undefined, sp)).todos || []);
  const findTask = async (id: string, sp?: string) => {
    const t = (await allTasks(sp)).find((x) => x.id === id);
    if (!t) throw new Error('Peblo could not find that task. Check the id (list_tasks all=true shows ids) and the space.');
    return t;
  };
  /** Names (first names work) or ids to user ids, using the team's people list. */
  const peopleIds = async (list: string[], sp?: string): Promise<string[]> => {
    if (!sp) { if (list.length) throw new Error('Name the team with space so people can be matched.'); return []; }
    const me = (await api('GET', '/whoami')).id as string;
    const people: { id: string; name: string }[] = (await api('GET', `/workspaces/spaces/${enc(sp)}/people-lite`)).people || [];
    return list.map((q) => {
      if (q === me || norm(q) === 'me') return me;
      const hit = people.find((p) => p.id === q) || people.find((p) => norm(p.name) === norm(q)) || people.find((p) => norm(p.name).split(' ')[0] === norm(q)) || people.find((p) => norm(p.name).includes(norm(q)));
      if (!hit) throw new Error(`No one called "${q}" in that team. list_people shows who is there.`);
      return hit.id;
    });
  };
  const reg = (name: string, description: string, inputSchema: Record<string, unknown>, annotations: Record<string, unknown>, fn: (a: any) => Promise<unknown>) =>
    server.registerTool(name, { description, inputSchema, annotations }, (a: any) => run(() => fn(a ?? {})));

  // 6: comment on a task, with @mentions (works on team tasks: the server checks you are in the team)
  reg('add_task_comment', 'Write a comment on a task\'s discussion. mentions can be first names or ids of people in the team (give space so names can be matched); they are notified.',
    { id: z.string(), body: z.string().min(1).max(2000), mentions: z.array(z.string()).max(10).optional(), space: SPACE }, writes,
    async ({ id, body, mentions, space }) => {
      const sp = await spaceIdOf(space);
      const r = await api('POST', `/todos/${enc(id)}/comments`, { body, mentions: mentions?.length ? await peopleIds(mentions, sp) : [] }, sp);
      return { ok: true, commentId: r.id };
    });

  // 7: ask people to review (moves the task to In review and notifies them)
  reg('request_task_review', 'Ask people in the team to review a task. It moves to In review and they are notified. to can be first names or ids (give space so names can be matched). Approving or sending it back is done with update_task column.',
    { id: z.string(), to: z.array(z.string()).min(1).max(10), note: z.string().max(300).optional(), space: SPACE }, writes,
    async ({ id, to, note, space }) => {
      const sp = await spaceIdOf(space);
      return api('POST', `/todos/${enc(id)}/review`, { to: await peopleIds(to, sp), note }, sp);
    });

  // 12: bulk
  reg('bulk_update_tasks', 'Change many tasks at once: move them to a Kanban column, set their priority, assignees, visibility or colour label. Up to 200 ids. Only Personal tasks can be changed with an access token.',
    { ids: z.array(z.string()).min(1).max(200), column: KEY.optional(), priority: z.enum(['low', 'medium', 'high']).optional(), assignees: z.array(z.string()).max(10).optional().describe('People ids; [] clears'), visibility: z.enum(['team', 'people', 'me']).optional(), label: z.enum(['red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink']).nullable().optional(), space: SPACE },
    { ...writes, idempotentHint: true },
    async ({ ids, space, ...set }) => {
      const body = Object.fromEntries(Object.entries(set).filter(([, v]) => v !== undefined));
      if (!Object.keys(body).length) throw new Error('Say what to change: column, priority, assignees, visibility or label.');
      return api('POST', '/todos/bulk', { ids, set: body }, await spaceIdOf(space));
    });

  // 13: board columns. A removed column sends its tasks back to To do (nothing is deleted), so that needs a yes.
  reg('set_board_columns', 'Set the Kanban columns of your Personal board (a team board is edited by a team lead in the app). To do is always first and Done always last; give the ones between. Removing a column moves its tasks back to To do, so set confirm_removed to true when you remove one.',
    { columns: z.array(z.object({ key: KEY, name: z.string().min(1).max(30), tone: z.enum(['sand', 'butter', 'lilac', 'mint', 'sky', 'peach']).optional() })).max(10), confirm_removed: z.boolean().optional(), space: SPACE }, writes,
    async ({ columns, confirm_removed, space }) => {
      const sp = await spaceIdOf(space);
      const cur = (await api('GET', '/todos/board', undefined, sp)).columns || [];
      const next = new Set(columns.map((c: any) => c.key));
      const removed = cur.filter((c: any) => c.key !== 'todo' && c.key !== 'done' && !next.has(c.key));
      if (removed.length && !confirm_removed) throw new Error(`This would remove ${removed.map((c: any) => `"${c.name}"`).join(', ')}; its tasks would go back to To do. Nothing was changed. Call again with confirm_removed true to go ahead.`);
      return api('PUT', '/todos/board', { columns }, sp);
    });

  // 9: duplicate (a copy in Personal, steps unticked)
  reg('duplicate_task', 'Make a copy of a task (same text, priority, tags, link, estimate and steps with the ticks cleared). The copy is made in Personal.',
    { id: z.string(), space: SPACE }, writes,
    async ({ id, space }) => {
      const t = await findTask(id, await spaceIdOf(space));
      const m = t.meta || {};
      const meta: Record<string, unknown> = {};
      for (const k of ['link', 'estimateMin', 'details', 'reminders', 'remindMin', 'travelMin']) if (m[k] !== undefined) meta[k] = m[k];
      if (Array.isArray(m.subtasks) && m.subtasks.length) meta.subtasks = m.subtasks.map((s: any) => ({ text: s.text, done: false }));
      const { todo } = await api('POST', '/todos', { text: t.text, priority: t.priority, tags: t.todoTags || [], deadline: t.deadline || undefined, startTime: t.startTime || undefined, endTime: t.endTime || undefined, noteId: t.noteId || undefined, ...(Object.keys(meta).length ? { meta } : {}) });
      return slim(todo);
    });

  // 5: steps
  reg('add_task_steps', 'Add checklist steps to a task, after the ones it has (up to 30 in all).',
    { id: z.string(), steps: z.array(z.string().min(1).max(200)).min(1).max(30), space: SPACE }, writes,
    async ({ id, steps, space }) => {
      const sp = await spaceIdOf(space);
      const t = await findTask(id, sp);
      const old: { id?: string; text: string; done?: boolean }[] = Array.isArray(t.meta?.subtasks) ? t.meta.subtasks : [];
      const list = [...old, ...steps.filter((s: string) => !old.some((o) => norm(o.text) === norm(s))).map((text: string) => ({ text, done: false }))].slice(0, 30);
      const { todo } = await api('PATCH', `/todos/${enc(id)}`, { meta: { subtasks: list } }, sp);
      return slim(todo);
    });
  reg('set_task_step_done', 'Tick or untick one step of a task. step is the step\'s number (1 is the first) or part of its text.',
    { id: z.string(), step: z.union([z.number().int().min(1), z.string().min(1)]), done: z.boolean().optional().describe('Defaults to true'), space: SPACE }, { ...writes, idempotentHint: true },
    async ({ id, step, done, space }) => {
      const sp = await spaceIdOf(space);
      const t = await findTask(id, sp);
      const list: { text: string; done?: boolean }[] = Array.isArray(t.meta?.subtasks) ? t.meta.subtasks : [];
      const i = typeof step === 'number' ? step - 1 : list.findIndex((s) => norm(s.text).includes(norm(String(step))));
      if (i < 0 || i >= list.length) throw new Error(`That task has ${list.length} step${list.length === 1 ? '' : 's'}: ${list.map((s, n) => `${n + 1}. ${s.text}`).join('; ') || 'none'}.`);
      const next = list.map((s, n) => (n === i ? { ...s, done: done ?? true } : s));
      const { todo } = await api('PATCH', `/todos/${enc(id)}`, { meta: { subtasks: next } }, sp);
      return slim(todo);
    });

  // 19: look before adding. Open tasks from the week before to a month ahead that share a word of 4+ letters, and notes with a matching title.
  const similar = async (text: string, sp?: string) => {
    const w = words(text);
    if (!w.size) return { tasks: [], notes: [] };
    const today = (await api('GET', '/whoami')).today as string;
    const lo = new Date(`${addDays(today, -7)}T00:00:00Z`).getTime(); const hi = new Date(`${addDays(today, 31)}T00:00:00Z`).getTime();
    const tasks = (await allTasks(sp)).filter((t) => !t.completed && t.deadline && new Date(t.deadline).getTime() >= lo && new Date(t.deadline).getTime() <= hi && [...words(t.text)].some((x) => w.has(x))).slice(0, 5).map(slim);
    const first = [...w][0];
    const notes = ((await api('GET', '/notes?' + new URLSearchParams({ search: first, limit: '5' }), undefined, sp).catch(() => ({ notes: [] }))).notes || [])
      .filter((n: any) => [...words(n.title || '')].some((x) => w.has(x))).slice(0, 3).map((n: any) => ({ id: n.id, title: n.title }));
    return { tasks, notes };
  };
  reg('find_similar_tasks', 'Before adding a task: open tasks (from last week to a month ahead) that look like it, and notes whose title shares a word with it, so you can warn about a duplicate or link a note.',
    { text: z.string().min(1), space: SPACE }, readOnly,
    async ({ text, space }) => similar(text, await spaceIdOf(space)));

  // 17 + 20: quick add and capture, as the app's bar does
  reg('quick_add_task', 'Add a task from plain words the way the app\'s quick-add bar does: "revise BCNF tomorrow 5pm !high #exams". It understands today, tonight, tomorrow, a weekday, a time, !high or !low and #tags. Like the Capture box, it first checks for a similar open task and a note to link; if something similar exists it does NOT add and tells you, unless force is true. A date with no time becomes 17:00, as in the app.',
    { text: z.string().min(1).max(500), force: z.boolean().optional().describe('Add it even if a similar task exists'), note_id: z.string().optional().describe('Link this note (a suggestion from a previous call)') }, writes,
    async ({ text, force, note_id }) => {
      const me = await api('GET', '/whoami');
      const p = parseTaskWords(text, me.today);
      if (!p.text) throw new Error('There is no task text left after the date, time, !priority and #tags.');
      const found = await similar(p.text);
      if (found.tasks.length && !force) return { created: false, reason: 'Looks similar to an open task. Call again with force true to add it anyway.', similar: found.tasks, suggestedNotes: found.notes, understood: p };
      const { todo } = await api('POST', '/todos', {
        text: p.text, tags: p.tags, ...(p.priority ? { priority: p.priority } : {}), ...(note_id ? { noteId: note_id } : {}),
        ...(p.date ? { deadline: zonedIso(p.date, p.time || '17:00', me.timezone || 'UTC'), ...(p.time ? { startTime: p.time } : {}) } : {}),
      });
      return { created: true, task: slim(todo), understood: p, suggestedNotes: note_id ? [] : found.notes, ...(todo.meta?.proposal ? { status: 'waiting for the person to approve it' } : {}) };
    });

  // 18: a task from a line of a note
  reg('create_task_from_note', 'Make a task from a line of a note. It is linked to the note and keeps the quoted line, so the app can jump back to it ("Where it came from").',
    { note_id: z.string(), quote: z.string().min(3).max(400).describe('The line or sentence the task comes from'), text: z.string().min(1).optional().describe('The task; defaults to the quote'), line: z.number().int().min(1).optional().describe('Line number in the note'), deadline: z.string().optional(), priority: z.enum(['low', 'medium', 'high']).optional(), tags: z.array(z.string()).optional() }, writes,
    async ({ note_id, quote, text, line, deadline, priority, tags }) => {
      const { todo } = await api('POST', '/todos', { text: (text || quote).slice(0, 300), noteId: note_id, ...(deadline ? { deadline } : {}), ...(priority ? { priority } : {}), ...(tags ? { tags } : {}), meta: { source: { quote, noteId: note_id, ...(line ? { line } : {}) } } });
      return { ...slim(todo), ...(todo.meta?.proposal ? { status: 'waiting for the person to approve it' } : {}) };
    });

  // 14: the approval inbox, read only. Approving stays with the person.
  reg('list_task_proposals', 'Tasks you or another AI client proposed that are waiting in the person\'s approval inbox. You cannot approve them; only the person can, in the app.',
    {}, readOnly, async () => ((await api('GET', '/todos?proposals=only')).todos || []).map((t: any) => ({ ...slim(t), proposedBy: t.meta?.proposal?.by })));
}

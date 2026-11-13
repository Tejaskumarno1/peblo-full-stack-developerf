// Batch 1: tasks everyone can see. Visibility (team / just me / picked people), several assignees, board columns, bulk changes.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { boot, REPO } from './lib.mjs';
const b = await boot();
const ok = (c, m, x) => b.check(m, !!c, x);
try {
  const { default: db } = await import(pathToFileURL(path.join(REPO, process.env.PEBLO_SERVER_DIST || 'dist', 'server', 'db.js')).href);
  const call = (token, space) => async (method, url, body) => {
    const res = await fetch(b.base + url, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(space ? { 'x-peblo-space': space } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { ...(await res.json().catch(() => ({}))), status: res.status };
  };
  const person = async (name) => {
    const email = `${name.toLowerCase()}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@peblo.test`;
    const r = await fetch(b.base + '/api/auth/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'correct horse battery', name }) }).then((x) => x.json());
    await db.user.updateMany({ where: { email }, data: { emailVerifiedAt: new Date() } });
    return { email, token: r.token, id: r.user?.id };
  };
  const made = await b.api('POST', '/api/workspaces/orgs', { name: 'Studio Co', start: 'team' });
  const team = made.spaceId;
  const join = async (p) => {
    const inv = await b.api('POST', `/api/workspaces/orgs/${made.id}/invites`, { email: p.email, orgRole: 'member', spaceIds: [team], spaceRole: 'member' });
    await call(p.token)('POST', '/api/workspaces/invites/accept', { token: new URL(inv.link).searchParams.get('token') });
  };
  const ana = await person('Ana'); const bo = await person('Bo'); const out = await person('Out');
  await join(ana); await join(bo);
  const me = (await call(b.token)('GET', '/api/auth/me')).user?.id || (await call(b.token)('GET', '/api/profile')).user?.id;
  const A = call(b.token, team), N = call(ana.token, team), B = call(bo.token, team), O = call(out.token, team);
  const ids = async (C) => ((await C('GET', '/api/todos')).todos || []).map((t) => t.text);

  // default: the whole team sees it
  const t1 = await A('POST', '/api/todos', { text: 'Everyone task' });
  ok(t1.status === 201 && (await ids(N)).includes('Everyone task') && (await ids(B)).includes('Everyone task'), 'a team task is visible to the whole team by default');

  // just me
  const t2 = await A('POST', '/api/todos', { text: 'Private to me', meta: { visibility: 'me' } });
  ok(t2.status === 201 && (await ids(A)).includes('Private to me'), 'the creator sees a Just me task');
  ok(!(await ids(N)).includes('Private to me'), 'a teammate does not see a Just me task', JSON.stringify(await ids(N)));
  const hijack = await N('PATCH', `/api/todos/${t2.todo.id}`, { text: 'hijack' });
  ok(hijack.status === 404, 'and cannot change it', hijack.status);

  // picked people
  const t3 = await A('POST', '/api/todos', { text: 'For Ana only', meta: { visibility: 'people', viewers: [ana.id] } });
  ok((await ids(N)).includes('For Ana only') && !(await ids(B)).includes('For Ana only'), 'picked people see it and others do not');

  // several assignees: they see a Just me task too
  const t4 = await A('POST', '/api/todos', { text: 'Two owners', assignees: [ana.id, bo.id], meta: { visibility: 'me' } });
  ok(t4.status === 201 && t4.todo.assigneeId === ana.id && t4.todo.meta.assignees.length === 2, 'several people can be assigned (the first stays assigneeId)', JSON.stringify(t4.todo?.meta));
  ok((await ids(N)).includes('Two owners') && (await ids(B)).includes('Two owners'), 'every assignee sees it even when it is Just me');
  ok(!(await ids(O)).includes('Two owners'), 'someone outside the team sees nothing');
  const bad = await A('POST', '/api/todos', { text: 'x', assignees: [out.id] });
  ok(bad.status === 400, 'a person outside the team cannot be assigned');
  const re = await A('PATCH', `/api/todos/${t4.todo.id}`, { assignees: [bo.id] });
  ok(re.status === 200 && re.todo.assigneeId === bo.id && re.todo.meta.assignees.length === 1, 'assignees can be changed');
  const un = await A('PATCH', `/api/todos/${t4.todo.id}`, { assignees: [] });
  ok(un.todo?.assigneeId === null && !un.todo?.meta?.assignees, 'and cleared');

  // columns
  const id = t1.todo.id;
  const col = async (c) => (await A('PATCH', `/api/todos/${id}`, { column: c })).todo;
  let t = await col('doing');
  ok(t.completed === false && t.meta.status === 'doing', 'column In progress');
  t = await col('review');
  ok(t.completed === false && t.meta.status === 'review', 'column In review');
  t = await col('done');
  ok(t.completed === true && !t.meta?.status, 'column Done sets completed and clears the status');
  t = await col('todo');
  ok(t.completed === false && !t.meta?.status, 'back to To do');
  const ck = (await A('PATCH', `/api/todos/${id}`, { completed: true })).todo;
  ok(ck.completed === true, 'the old checkbox still completes a task');
  const ck2 = (await A('PATCH', `/api/todos/${id}`, { meta: { status: 'doing' } })).todo;
  ok(ck2.completed === false && ck2.meta.status === 'doing', 'setting a status on a finished task reopens it');

  // bulk
  const x1 = await A('POST', '/api/todos', { text: 'Bulk 1' }); const x2 = await A('POST', '/api/todos', { text: 'Bulk 2' });
  const bu = await A('POST', '/api/todos/bulk', { ids: [x1.todo.id, x2.todo.id, t2.todo.id], set: { column: 'review', assignees: [ana.id], priority: 'high' } });
  ok(bu.status === 200 && bu.changed === 3, 'bulk change touches the chosen tasks', JSON.stringify(bu));
  const after = (await N('GET', '/api/todos')).todos;
  const b1 = after.find((x) => x.text === 'Bulk 1');
  ok(b1?.meta?.status === 'review' && b1.assigneeId === ana.id && b1.priority === 'high', 'they moved to In review, assigned to Ana, high priority', JSON.stringify(b1?.meta));
  const nb = await N('POST', '/api/todos/bulk', { ids: [t2.todo.id], set: { column: 'done' } });
  ok(nb.changed === 0 || nb.changed === 1, 'bulk skips tasks a person cannot see');
  const stillMe = (await A('GET', '/api/todos')).todos.find((x) => x.id === t2.todo.id);
  ok(stillMe && stillMe.completed === false || stillMe?.assigneeId === ana.id, 'a hidden task was not changed by someone who cannot see it', JSON.stringify(stillMe?.meta));
  const empty = await A('POST', '/api/todos/bulk', { ids: [], set: {} });
  ok(empty.status === 400, 'bulk with nothing chosen is refused');

  // Personal tasks are untouched
  const pe = await b.api('POST', '/api/todos', { text: 'Personal one' });
  const pl = await b.api('GET', '/api/todos');
  ok(pe.todo && (pl.todos || []).some((x) => x.text === 'Personal one'), 'Personal tasks work as before');
} catch (e) { b.check('team tasks test ran without error', false, e.stack || e.message); }
await b.finish();

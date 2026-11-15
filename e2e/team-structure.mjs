// Batch 6: templates, projects, handover.
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
  const A = call(b.token, team), N = call(ana.token, team), O = call(out.token, team);

  // templates
  const tl = await A('GET', `/api/workspaces/${team}/templates`);
  ok(tl.templates?.some((t) => t.builtin) && tl.templates.length >= 3, 'ready-made templates are offered');
  const saved = await A('POST', `/api/workspaces/${team}/templates`, { name: 'Sponsor delivery', items: [{ text: 'Send the brief', day: 0 }, { text: 'Share the draft', day: 3 }, { text: '', day: 1 }] });
  ok(saved.status === 201 && saved.items.length === 2, 'a team can save its own template (empty lines dropped)', JSON.stringify(saved));
  ok((await N('GET', `/api/workspaces/${team}/templates`)).templates.some((t) => t.name === 'Sponsor delivery'), 'teammates see it');
  ok((await A('POST', `/api/workspaces/${team}/templates`, { name: '', items: [] })).status === 400, 'an empty template is refused');
  ok((await O('GET', `/api/workspaces/${team}/templates`)).status === 404, 'templates are for members only');
  ok((await N('DELETE', `/api/workspaces/${team}/templates/${saved.id}`)).status === 200, 'a member can remove a template');

  // projects
  await A('POST', '/api/todos', { text: 'Cut intro', meta: { list: 'Reel series' }, assignees: [ana.id] });
  const d = (await A('POST', '/api/todos', { text: 'Pick music', meta: { list: 'Reel series' } })).todo;
  await A('PATCH', `/api/todos/${d.id}`, { completed: true });
  await A('POST', '/api/todos', { text: 'Loose one' });
  const pr = await N('GET', `/api/workspaces/${team}/projects`);
  const reel = pr.projects?.find((p) => p.name === 'Reel series');
  ok(reel?.total === 2 && reel.done === 1 && reel.people.includes(ana.id), 'a project shows progress and people', JSON.stringify(pr));
  ok(pr.projects?.some((p) => p.name === 'Inbox' && p.total === 1), 'tasks without a list sit in Inbox');

  // handover
  const t1 = (await A('POST', '/api/todos', { text: 'Edit the reel', assignees: [ana.id] })).todo;
  await A('POST', '/api/todos', { text: 'Collect logos', assignees: [ana.id, bo.id] });
  const open = await A('GET', `/api/workspaces/${team}/people/${ana.id}/open`);
  ok(open.tasks?.length === 3, 'a lead sees the open tasks of a person', JSON.stringify(open.tasks?.map((t) => t.text)));
  ok((await N('GET', `/api/workspaces/${team}/people/${ana.id}/open`)).status === 403, 'a member cannot');
  ok((await N('POST', `/api/workspaces/${team}/handover`, { from: ana.id, to: bo.id })).status === 403, 'and cannot hand work over');
  ok((await A('POST', `/api/workspaces/${team}/handover`, { from: ana.id, to: ana.id })).status === 400, 'handing over to the same person is refused');
  const h = await A('POST', `/api/workspaces/${team}/handover`, { from: ana.id, to: bo.id, ids: [t1.id], note: 'While you are away' });
  ok(h.status === 200 && h.moved === 1, 'one chosen task moves', JSON.stringify(h));
  const after = (await A('GET', '/api/todos')).todos;
  ok(after.find((t) => t.id === t1.id).meta.assignees.join() === bo.id, 'it now belongs to Bo');
  ok(after.find((t) => t.text === 'Cut intro').meta.assignees.includes(ana.id), 'tasks that were not chosen stay with Ana');
  const h2 = await A('POST', `/api/workspaces/${team}/handover`, { from: ana.id, to: bo.id });
  ok(h2.moved === 2, 'handing over everything moves the rest', JSON.stringify(h2));
  const co = (await A('GET', '/api/todos')).todos.find((t) => t.text === 'Collect logos');
  ok(co.meta.assignees.length === 1 && co.meta.assignees[0] === bo.id, 'a shared task does not list Bo twice');
  const notes = (await call(bo.token)('GET', '/api/collab/notifications')).notifications || [];
  ok(notes.some((n) => n.kind === 'assigned' && /handed over/.test(n.title)), 'Bo is told');
  const feed = await A('GET', `/api/workspaces/${team}/feed`);
  ok(feed.items?.some((i) => i.kind === 'handover'), 'the handover is in the activity feed');
} catch (e) { b.check('team structure ran without error', false, e.stack || e.message); }
await b.finish();

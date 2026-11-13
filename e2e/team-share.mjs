// Share a note with a team (mockups T01 to T07): copy into the team, member folders, view-only, and the Done tag from a to-do list.
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
  const ana = await person('Ana');
  const inv = await b.api('POST', `/api/workspaces/orgs/${made.id}/invites`, { email: ana.email, orgRole: 'member', spaceIds: [team], spaceRole: 'member' });
  await call(ana.token)('POST', '/api/workspaces/invites/accept', { token: new URL(inv.link).searchParams.get('token') });
  const A = call(b.token);          // the author, Personal space
  const AT = call(b.token, team);   // the author, in the team
  const N = call(ana.token, team);  // Ana, in the team

  // empty team: no folders yet
  const f0 = await N('GET', `/api/workspaces/${team}/shared`);
  ok(f0.status === 200 && Array.isArray(f0.members) && f0.members.length === 0 && f0.total === 0, 'no folders before anything is shared', JSON.stringify(f0));

  // share a Personal note with a to-do list, can edit
  const mine = await A('POST', '/api/notes', { title: 'Reel script: Warangal fort', content: 'Hook, three beats, outro' });
  const sh = await A('POST', `/api/notes/${mine.note.id}/team-share`, { spaceId: team, level: 'edit', tasks: ['Record the voice-over', 'Edit the reel cuts', 'Design the thumbnail'] });
  ok(sh.status === 201 && sh.tasks === 3 && sh.note?.id && sh.note.id !== mine.note.id, 'sharing adds a copy to the team with 3 tasks', JSON.stringify(sh));
  const stay = await A('GET', `/api/notes/${mine.note.id}`);
  ok(stay.status === 200, 'the original stays in Personal');
  const inbox = await N('GET', '/api/notes');
  ok(inbox.notes?.some((n) => n.id === sh.note.id), 'the other member sees the shared note in the team', JSON.stringify(inbox.notes?.map((n) => n.title)));

  // folders
  const f1 = await N('GET', `/api/workspaces/${team}/shared`);
  const me = f1.members?.find((m) => m.userId !== ana.id);
  ok(f1.members?.length === 1 && me?.notes === 1 && me.withTodos === 1 && me.done === 0 && me.name === 'E2E', 'one folder for the sharer: 1 note, 1 with a to-do list, 0 done', JSON.stringify(f1));
  const mf = await N('GET', `/api/workspaces/${team}/shared/${me.userId}`);
  const row = mf.notes?.[0];
  ok(mf.person?.name === 'E2E' && row?.title === 'Reel script: Warangal fort' && row.todoTotal === 3 && row.todoDone === 0 && row.done === false && row.level === 'edit', 'the member folder lists the note with 0 of 3 tasks', JSON.stringify(mf));

  // Done tag: finish the tasks one by one
  const tasks = (await AT('GET', '/api/todos')).todos?.filter((t) => t.noteId === sh.note.id) || [];
  ok(tasks.length === 3, 'the three tasks are linked to the shared note', String(tasks.length));
  const tagsOf = async () => (await AT('GET', `/api/notes/${sh.note.id}`)).note?.tags?.map((t) => (typeof t === 'string' ? t : t.name || t.tag?.name)) || [];
  await AT('PATCH', `/api/todos/${tasks[0].id}`, { completed: true });
  await AT('PATCH', `/api/todos/${tasks[1].id}`, { completed: true });
  ok(!(await tagsOf()).includes('Done'), 'two of three done: no Done tag yet', JSON.stringify(await tagsOf()));
  const p3 = await AT('PATCH', `/api/todos/${tasks[2].id}`, { completed: true });
  ok(p3.status === 200, 'the last task saves', JSON.stringify(p3).slice(0, 300));
  ok((await tagsOf()).includes('Done'), 'the last task done: the note gets the Done tag', JSON.stringify(await tagsOf()));
  const f2 = await N('GET', `/api/workspaces/${team}/shared`);
  ok(f2.members?.find((m) => m.userId === me.userId)?.done === 1 && f2.done === 1, 'the folder counts it as Done');
  const mf2 = await N('GET', `/api/workspaces/${team}/shared/${me.userId}`);
  ok(mf2.notes?.[0]?.done === true && mf2.notes[0].todoDone === 3, 'the member folder shows 3 of 3 and Done');
  await AT('PATCH', `/api/todos/${tasks[1].id}`, { completed: false });
  ok(!(await tagsOf()).includes('Done'), 'reopening a task takes the Done tag off', JSON.stringify(await tagsOf()));
  const add = await AT('POST', '/api/todos', { text: 'One more', noteId: sh.note.id });
  await AT('PATCH', `/api/todos/${tasks[1].id}`, { completed: true });
  ok(!(await tagsOf()).includes('Done') && add.todo, 'a new open task keeps it off', JSON.stringify(await tagsOf()));

  // view-only share
  const ro = await A('POST', '/api/notes').then(() => A('POST', '/api/notes', { title: 'Brand colours', content: 'sky, mint, butter' }));
  const sv = await A('POST', `/api/notes/${ro.note.id}/team-share`, { spaceId: team, level: 'view' });
  ok(sv.status === 201 && sv.tasks === 0, 'a view-only share with no to-do list');
  const roPatch = await N('PATCH', `/api/notes/${sv.note.id}`, { title: 'hijack' });
  ok(roPatch.status === 403 && roPatch.code === 'view_only', 'another member cannot edit a view-only share', JSON.stringify(roPatch));
  const roRead = await N('GET', `/api/notes/${sv.note.id}`);
  ok(roRead.status === 200, 'but can read it');
  const ownEdit = await AT('PATCH', `/api/notes/${sv.note.id}`, { title: 'Brand colours v2' });
  ok(ownEdit.status === 200, 'the author can still edit it', JSON.stringify(ownEdit).slice(0, 160));
  const noDone = (await N('GET', `/api/workspaces/${team}/shared/${me.userId}`)).notes?.find((n) => n.id === sv.note.id);
  ok(noDone && noDone.todoTotal === 0 && noDone.done === false && noDone.level === 'view', 'a note with no tasks is never Done');

  // rules
  const bad1 = await N('POST', `/api/notes/${mine.note.id}/team-share`, { spaceId: team });
  ok(bad1.status === 404, 'only the author can share their note');
  const bad2 = await A('POST', `/api/notes/${mine.note.id}/team-share`, { spaceId: 'nope' });
  ok(bad2.status === 404, 'an unknown team is refused');
  const bad3 = await A('POST', `/api/notes/${sh.note.id}/team-share`, { spaceId: team });
  ok(bad3.status === 404, 'a note already in a team cannot be shared again');
  const outsider = await person('Out');
  const f3 = await call(outsider.token)('GET', `/api/workspaces/${team}/shared`);
  ok(f3.status === 404, 'someone outside the team cannot list the folders');
} catch (e) { b.check('team share test ran without error', false, e.stack || e.message); }
await b.finish();


// Private notes in an Office (mockups WsE01 to WsE03): a note starts private to its author and is opened up to people or to everyone.
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
  const off = await b.api('POST', `/api/workspaces/orgs/${made.id}/spaces`, { name: 'Warangal office', kind: 'office' });
  ok(off.id, 'an Office exists', JSON.stringify(off));
  const bea = await person('Bea');
  const inv = await b.api('POST', `/api/workspaces/orgs/${made.id}/invites`, { email: bea.email, orgRole: 'member', spaceIds: [off.id, made.spaceId], spaceRole: 'member' });
  const acc = await call(bea.token)('POST', '/api/workspaces/invites/accept', { token: new URL(inv.link).searchParams.get('token') });
  ok(acc.status === 200, 'a second person joins the Office', JSON.stringify(acc));
  if (!bea.id) bea.id = (await call(bea.token)('GET', '/api/profile')).user?.id;
  const A = call(b.token, off.id);
  const B = call(bea.token, off.id);

  // a new note starts private
  const n1 = await A('POST', '/api/notes', { title: 'Salary review draft', content: 'secret numbers' });
  ok(n1.status === 201 && n1.note?.access === 'owner' && n1.note.everyone === null && n1.note.owner?.name, 'a new Office note is private to its author', JSON.stringify(n1).slice(0, 300));
  const id1 = n1.note.id;
  const listB0 = await B('GET', '/api/notes');
  ok(!listB0.notes?.some((n) => n.id === id1), 'the other person does not see it in the list', JSON.stringify(listB0.notes?.map((n) => n.title)));
  const searchB0 = await B('GET', '/api/notes?search=Salary');
  ok(!searchB0.notes?.some((n) => n.id === id1), 'it does not turn up in their search either');
  const getB0 = await B('GET', `/api/notes/${id1}`);
  ok(getB0.status === 403 && getB0.code === 'no_access' && getB0.owner?.name === 'E2E', 'opening it answers 403 no_access and names the author', JSON.stringify(getB0));
  const patchB0 = await B('PATCH', `/api/notes/${id1}`, { title: 'hijack' });
  ok(patchB0.status === 403 && patchB0.code === 'no_access', 'editing it is refused the same way', JSON.stringify(patchB0));
  const bl0 = await B('GET', `/api/notes/${id1}/access`);
  ok(bl0.status === 403 && bl0.code === 'no_access', 'its access settings are not readable either');
  const del0 = await B('DELETE', `/api/notes/${id1}`);
  ok(del0.status === 403, 'deleting it is refused', JSON.stringify(del0));
  const copy0 = await B('POST', `/api/notes/${id1}/copy`, { to: 'personal' });
  ok(copy0.status === 403, 'copying it away is refused', JSON.stringify(copy0));

  // the author sees the access panel data
  const acA = await A('GET', `/api/notes/${id1}/access`);
  ok(acA.level === 'owner' && acA.everyone === null && Array.isArray(acA.people) && acA.people.length === 0 && acA.owner?.name === 'E2E', 'the author gets owner, everyone and people', JSON.stringify(acA));
  ok(acA.candidates?.some((c) => c.userId === bea.id), 'the people who could be added are listed', JSON.stringify(acA.candidates));

  // validation
  ok((await A('PUT', `/api/notes/${id1}/access`, { everyone: 'admin' })).status === 400, 'a bad everyone value is refused');
  ok((await A('PUT', `/api/notes/${id1}/access`, { people: [{ userId: bea.id, level: 'owner' }] })).status === 400, 'a bad level is refused');
  ok((await A('PUT', `/api/notes/${id1}/access`, { people: [{ userId: 'nobody', level: 'view' }] })).code === 'not_member', 'only people in the Office can be added');
  ok((await B('PUT', `/api/notes/${id1}/access`, { everyone: 'edit' })).status === 403, 'someone without access cannot grant it');

  // read-only share to one person
  const put1 = await A('PUT', `/api/notes/${id1}/access`, { people: [{ userId: bea.id, level: 'view' }] });
  ok(put1.status === 200 && put1.people?.length === 1 && put1.people[0].userId === bea.id && put1.people[0].level === 'view' && put1.people[0].name, 'sharing to one person as read only', JSON.stringify(put1));
  const listB1 = await B('GET', '/api/notes');
  const seen = listB1.notes?.find((n) => n.id === id1);
  ok(seen && seen.access === 'view' && seen.owner?.name === 'E2E', 'it appears for them, marked view only, with its author', JSON.stringify(seen && { a: seen.access, o: seen.owner }));
  ok((await B('GET', `/api/notes/${id1}`)).note?.content === 'secret numbers', 'they can open it');
  const p1 = await B('PATCH', `/api/notes/${id1}`, { title: 'hijack' });
  ok(p1.status === 403 && p1.code === 'view_only', 'but not change it (403 view_only)', JSON.stringify(p1));
  const acB = await B('GET', `/api/notes/${id1}/access`);
  ok(acB.level === 'view' && acB.people.length === 0 && acB.owner?.name === 'E2E', 'their access panel shows their level and the author, not the list', JSON.stringify(acB));
  const noteBell = await call(bea.token)('GET', '/api/collab/notifications');
  ok(noteBell.notifications?.some((n) => n.kind === 'note_shared' && n.noteId === id1 && n.title === 'Salary review draft'), 'they are told it was shared with them', JSON.stringify(noteBell).slice(0, 300));

  // edit access
  await A('PUT', `/api/notes/${id1}/access`, { people: [{ userId: bea.id, level: 'edit' }] });
  const p2 = await B('PATCH', `/api/notes/${id1}`, { title: 'Salary review v2' });
  ok(p2.status === 200, 'with edit access they can change it', JSON.stringify(p2));
  ok((await A('GET', `/api/notes/${id1}`)).note?.title === 'Salary review v2', 'the author sees their change');
  const d2 = await B('DELETE', `/api/notes/${id1}`);
  ok(d2.status === 403 && d2.code === 'owner_only', 'only the author can delete it', JSON.stringify(d2));
  const m2 = await B('POST', `/api/notes/${id1}/move`, { to: 'personal' });
  ok(m2.status === 403, 'only the author can move it', JSON.stringify(m2));

  // leaks through links
  const q = await B('POST', '/api/notes', { title: 'Bea only note', content: 'mine' });
  await A('POST', '/api/notes', { title: 'Links to Bea', content: `see [Bea only note](/notes/${q.note.id})` });
  const backs = await B('GET', `/api/notes/${q.note.id}/backlinks`);
  ok(!backs.backlinks?.some((x) => x.title === 'Links to Bea'), 'a private note does not leak through backlinks', JSON.stringify(backs));

  // remove the person, then open it to everyone
  const rm = await A('DELETE', `/api/notes/${id1}/access/${bea.id}`);
  ok(rm.status === 200 && (await B('GET', `/api/notes/${id1}`)).code === 'no_access', 'removing a person closes it again');
  const allv = await A('PUT', `/api/notes/${id1}/access`, { everyone: 'view' });
  ok(allv.everyone === 'view', 'it can be opened to everyone to read', JSON.stringify(allv));
  const g3 = await B('GET', `/api/notes/${id1}`);
  ok(g3.note?.access === 'view' && g3.note.everyone === 'view', 'then they can open it as view only', JSON.stringify(g3).slice(0, 200));
  ok((await B('PATCH', `/api/notes/${id1}`, { title: 'x' })).code === 'view_only', 'and still not edit');
  await A('PUT', `/api/notes/${id1}/access`, { everyone: 'edit' });
  ok((await B('PATCH', `/api/notes/${id1}`, { title: 'Salary review v3' })).status === 200, 'open to everyone to edit lets them edit');
  await A('PUT', `/api/notes/${id1}/access`, { everyone: null });
  ok((await B('GET', `/api/notes/${id1}`)).code === 'no_access', 'turning it off makes it private again');

  // organization export withholds private notes
  const exp = await b.api('GET', `/api/workspaces/orgs/${made.id}/export`);
  ok(!JSON.stringify(exp.notes).includes('Salary review'), 'the organization export leaves private notes out', JSON.stringify(exp.notes?.map((n) => n.title)));
  ok(JSON.stringify(exp.notes).includes('Bea only note') === false, 'including other people\'s private notes');

  // other places stay as they were
  const personalNote = await b.api('POST', '/api/notes', { title: 'Mine personally', content: 'x' });
  ok((await A('GET', `/api/notes/${personalNote.note.id}/access`)).status === 404, 'a Personal note has no access settings (404 in an Office header)');
  const t = await A('POST', '/api/todos', { text: 'Office task', priority: 'medium' });
  const tl = await B('GET', '/api/todos');
  ok(tl.todos?.some((x) => x.text === 'Office task'), 'tasks in the Office stay visible to everyone in it', JSON.stringify(t).slice(0, 120));
  const team = call(b.token, made.spaceId);
  await team('POST', '/api/notes', { title: 'Team note', content: 'open' });
  const teamB = await call(bea.token, made.spaceId)('GET', '/api/notes');
  ok(teamB.notes?.some((n) => n.title === 'Team note') && teamB.notes[0].access === undefined, 'a team keeps sharing every note, with no private layer');
  const outsider = await person('Zed');
  ok((await call(outsider.token, off.id)('GET', '/api/notes')).status === 404, 'a person outside the organization gets 404 for the Office');
  ok((await call(outsider.token)('GET', `/api/notes/${id1}/access`)).status === 404, 'and for the access settings');
  const audit = await b.api('GET', `/api/workspaces/orgs/${made.id}/audit`);
  ok(JSON.stringify(audit).includes('note.access_changed') && !JSON.stringify(audit).includes('Salary'), 'access changes are in the audit log, without the note text', JSON.stringify(audit).slice(0, 200));
} catch (e) { console.log('ERROR', e.stack || e); b.check('no exception', false, e.message); }
await b.finish();

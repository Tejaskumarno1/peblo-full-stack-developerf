// Workspaces phase 1: the switcher list, creating an organization and a team, and the permission rules in can().
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { boot, REPO } from './lib.mjs';
const b = await boot();
const ok = (c, m, x) => b.check(m, !!c, x);
try {
  const { can } = await import(pathToFileURL(path.join(REPO, process.env.PEBLO_SERVER_DIST || 'dist', 'server', 'utils', 'access.js')).href);
  const org = (role, orgStatus = 'active', status = 'active') => ({ orgId: 'o', role, status, orgStatus });
  ok(!can('space.read', null, 'lead'), 'no membership means no access');
  ok(!can('space.read', org('owner'), null), 'an owner is not in a space just by being an owner');
  ok(can('space.write', org('member'), 'member') && !can('space.write', org('member'), 'viewer'), 'members write, viewers read');
  ok(can('space.read', org('member'), 'viewer'), 'viewers can read');
  ok(!can('space.write', org('member', 'read_only'), 'member') && can('space.read', org('member', 'read_only'), 'member'), 'a read-only organization can be read but not written');
  ok(!can('space.read', org('member', 'active', 'paused'), 'member'), 'a paused person cannot read');
  ok(can('org.manage', org('admin')) && !can('org.manage', org('member')) && !can('org.manage', org('guest')), 'only owners and admins manage the organization');
  ok(!can('org.create_space', org('guest')), 'guests cannot create teams');

  const first = await b.api('GET', '/api/workspaces');
  ok(first.personal?.name === 'Personal' && first.orgs?.length === 0, 'a new person has only Personal', JSON.stringify(first));
  const bad = await b.api('POST', '/api/workspaces/orgs', { name: 'x' });
  ok(bad.error, 'a one-letter name is refused', JSON.stringify(bad));
  const made = await b.api('POST', '/api/workspaces/orgs', { name: 'Studio Co', start: 'team', spaceName: 'Studio team' });
  ok(made.id && made.spaceId, 'an organization is created with its first team', JSON.stringify(made));
  const list = await b.api('GET', '/api/workspaces');
  const o = list.orgs?.[0];
  ok(o?.name === 'Studio Co' && o.role === 'owner' && o.spaces?.length === 1 && o.spaces[0].name === 'Studio team' && o.spaces[0].role === 'lead' && o.spaces[0].members === 1, 'the creator owns it and leads the team', JSON.stringify(list));
  const t2 = await b.api('POST', `/api/workspaces/orgs/${made.id}/spaces`, { name: 'Design review' });
  ok(t2.id, 'a second team can be created', JSON.stringify(t2));
  const off = await b.api('POST', `/api/workspaces/orgs/${made.id}/spaces`, { name: 'Warangal office', kind: 'office' });
  ok(off.id, 'an Office can be created', JSON.stringify(off));
  const after = await b.api('GET', '/api/workspaces');
  ok(after.orgs[0].spaces.length === 3 && after.orgs[0].spaces.some((s) => s.kind === 'office'), 'all three spaces are listed', JSON.stringify(after));
  const nope = await b.api('POST', '/api/workspaces/orgs/not-mine/spaces', { name: 'Sneaky' });
  ok(nope.error, 'creating a team in an organization you are not in is refused', JSON.stringify(nope));
  const notes = await b.api('GET', '/api/notes');
  ok(!JSON.stringify(notes).includes('Studio'), 'Personal notes are untouched');

  // notes in a space
  const asSpace = (spaceId) => async (method, url, body) => {
    const res = await fetch(b.base + url, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${b.token}`, 'x-peblo-space': spaceId }, body: body ? JSON.stringify(body) : undefined });
    return { ...(await res.json().catch(() => ({}))), status: res.status };
  };
  const team = asSpace(made.spaceId);
  await b.api('POST', '/api/notes', { title: 'My private diary', content: 'personal only' });
  const tn = await team('POST', '/api/notes', { title: 'Sprint retro notes', content: 'team text' });
  ok(tn.status === 201 && tn.note?.id, 'a note can be written in a team space', JSON.stringify(tn).slice(0, 200));
  const teamList = await team('GET', '/api/notes');
  ok(teamList.notes?.length === 1 && teamList.notes[0].title === 'Sprint retro notes', 'the team list shows only team notes', JSON.stringify(teamList.notes?.map((n) => n.title)));
  const personalList = await b.api('GET', '/api/notes');
  ok(personalList.notes?.length === 1 && personalList.notes[0].title === 'My private diary', 'Personal never shows a team note', JSON.stringify(personalList.notes?.map((n) => n.title)));
  const viaPersonal = await b.api('GET', `/api/notes/${tn.note.id}`);
  ok(!viaPersonal.note, 'a team note cannot be opened as a Personal note', JSON.stringify(viaPersonal).slice(0, 120));
  const got = await team('GET', `/api/notes/${tn.note.id}`);
  ok(got.note?.title === 'Sprint retro notes', 'a team note opens inside its space');
  const up = await team('PATCH', `/api/notes/${tn.note.id}`, { title: 'Sprint retro v2', content: 'team text 2', baseUpdatedAt: got.note.updatedAt, baseContent: 'team text' });
  ok(up.status === 200, 'a team note saves (with the safe merge path)', JSON.stringify(up).slice(0, 160));
  const again = await team('GET', `/api/notes/${tn.note.id}`);
  ok(again.note?.content === 'team text 2', 'the saved text is there', JSON.stringify(again.note?.content));
  const search = await team('GET', '/api/notes?search=retro');
  ok(search.notes?.length === 1, 'search inside the space finds it');
  const psearch = await b.api('GET', '/api/notes?search=retro');
  ok(psearch.notes?.length === 0, 'Personal search does not find it', JSON.stringify(psearch.notes?.map((n) => n.title)));
  const del = await team('DELETE', `/api/notes/${tn.note.id}`);
  ok(del.status === 200, 'a team note moves to the space trash');
  const tt = await team('GET', '/api/notes?deleted=true');
  ok(tt.notes?.length === 1, 'it sits in that space trash', JSON.stringify(tt.notes?.length));
  const res = await team('POST', `/api/notes/${tn.note.id}/restore`);
  ok(res.status === 200 && res.note?.id === tn.note.id, 'and can be restored', JSON.stringify(res).slice(0, 140));
  const arch = await team('POST', `/api/notes/${tn.note.id}/archive`);
  ok(arch.status === 200 && arch.note?.isArchived === true, 'and archived', JSON.stringify(arch).slice(0, 140));
  // somebody who is not in the space
  const so = await fetch(b.base + '/api/auth/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: `out-${Date.now()}@peblo.test`, password: 'correct horse battery', name: 'Out' }) }).then((r) => r.json());
  const out = await fetch(b.base + '/api/notes', { headers: { Authorization: `Bearer ${so.token}`, 'x-peblo-space': made.spaceId } });
  ok(out.status === 404, 'a person outside the space gets 404, not 403', out.status);
  const out2 = await fetch(b.base + `/api/notes/${tn.note.id}`, { headers: { Authorization: `Bearer ${so.token}` } });
  ok(out2.status === 404, 'and cannot reach the note by its id either', out2.status);

  // tasks in a space
  const me = (await b.api('GET', '/api/workspaces')).me || {};
  await b.api('POST', '/api/todos', { text: 'Buy milk' });
  const tt1 = await team('POST', '/api/todos', { text: 'Write rollout note', deadline: new Date(Date.now() + 86400000).toISOString(), recurrence: 'daily', assigneeId: me.id });
  const teamTodoId = tt1.todo?.id || tt1.id;
  ok(tt1.status === 201 && teamTodoId, 'a task can be created in a team space', JSON.stringify(tt1).slice(0, 200));
  const tl = await team('GET', '/api/todos');
  ok((tl.todos || []).length === 1 && tl.todos[0].text === 'Write rollout note', 'team tasks list shows only team tasks', JSON.stringify((tl.todos || []).map((t) => t.text)));
  const pl = await b.api('GET', '/api/todos');
  ok((pl.todos || []).length === 1 && pl.todos[0].text === 'Buy milk', 'Personal tasks never show team tasks', JSON.stringify((pl.todos || []).map((t) => t.text)));
  const upd = await team('PATCH', `/api/todos/${teamTodoId}`, { completed: true });
  ok(upd.status === 200, 'a team task can be completed', JSON.stringify(upd).slice(0, 160));
  const badAssign = await team('PATCH', `/api/todos/${teamTodoId}`, { assigneeId: 'someone-else' });
  ok(badAssign.status === 400, 'assigning to someone outside the space is refused', badAssign.status);
  const personalCannot = await b.api('PATCH', `/api/todos/${teamTodoId}`, { completed: false });
  ok(personalCannot.error, 'a team task cannot be changed through Personal', JSON.stringify(personalCannot).slice(0, 120));
  const rng = await team('GET', `/api/todos/range?from=${new Date().toISOString()}&to=${new Date(Date.now() + 3 * 86400000).toISOString()}`);
  ok((rng.todos || []).length === 1, 'the calendar range works inside a space', JSON.stringify(rng).slice(0, 140));
  const dl = await team('DELETE', `/api/todos/${teamTodoId}`);
  ok(dl.status === 200, 'a team task can be deleted by a writer');

  // Home across spaces
  const dueSoon = new Date(Date.now() - 3600000).toISOString();
  const md1 = await team('POST', '/api/todos', { text: 'Mine and due', deadline: dueSoon, assigneeId: me.id });
  const md2 = await team('POST', '/api/todos', { text: 'Unassigned and due', deadline: dueSoon });
  const md3 = await team('POST', '/api/todos', { text: 'Mine but next month', deadline: new Date(Date.now() + 30 * 86400000).toISOString(), assigneeId: me.id });
  const myDay = await b.api('GET', '/api/workspaces/my-day');
  const names = (myDay.tasks || []).map((t) => t.text);
  ok(names.includes('Mine and due') && !names.includes('Unassigned and due') && !names.includes('Mine but next month'), 'My Day lists only my team tasks that are due', JSON.stringify(names));
  ok(myDay.tasks?.[0]?.spaceName === 'Studio team', 'each task carries its space name');
  const outDay = await fetch(b.base + '/api/workspaces/my-day', { headers: { Authorization: `Bearer ${so.token}` } }).then((r) => r.json());
  ok((outDay.tasks || []).length === 0, 'an outsider sees none of them');
  await team('PATCH', `/api/todos/${md1.todo?.id || md1.id}`, { completed: true });
  ok(!((await b.api('GET', '/api/workspaces/my-day')).tasks || []).some((t) => t.text === 'Mine and due'), 'a completed task leaves My Day');
  void md2; void md3;

  // calendar team layers
  const ranged = await team('POST', '/api/todos', { text: 'Layered task', deadline: new Date(Date.now() + 86400000).toISOString() });
  const tr = await b.api('GET', `/api/workspaces/team-range?from=${encodeURIComponent(new Date().toISOString())}&to=${encodeURIComponent(new Date(Date.now() + 5 * 86400000).toISOString())}&tz=Asia/Kolkata`);
  const ev = (tr.events || []).find((e) => e.title === 'Layered task');
  ok(ev && ev.feed === 'Studio team' && ev.allDay && /^\d{4}-\d\d-\d\d$/.test(ev.start), 'a team task appears as a calendar layer named after its space', JSON.stringify(tr).slice(0, 200));
  const trOut = await fetch(b.base + `/api/workspaces/team-range?from=${encodeURIComponent(new Date().toISOString())}&to=${encodeURIComponent(new Date(Date.now() + 5 * 86400000).toISOString())}`, { headers: { Authorization: `Bearer ${so.token}` } }).then((r) => r.json());
  ok((trOut.events || []).length === 0, 'an outsider gets no layer events');
  ok((await b.api('GET', '/api/workspaces/team-range')).error, 'a missing range is refused');
  void ranged;

  // move and copy
  const pn = await b.api('POST', '/api/notes', { title: 'Move me', content: 'wandering note' });
  const mv = await b.api('POST', `/api/notes/${pn.note.id}/move`, { to: made.spaceId });
  ok(mv.ok && mv.to === made.spaceId && mv.from === null, 'a Personal note moves into a team', JSON.stringify(mv));
  ok(!(await b.api('GET', '/api/notes')).notes.some((n) => n.title === 'Move me'), 'it leaves Personal');
  ok((await team('GET', '/api/notes')).notes.some((n) => n.title === 'Move me'), 'it appears in the team');
  const same = await team('POST', `/api/notes/${pn.note.id}/move`, { to: made.spaceId });
  ok(same.status === 400, 'moving to where it already is is refused', same.status);
  const outMove = await fetch(b.base + `/api/notes/${pn.note.id}/move`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${so.token}`, 'x-peblo-space': made.spaceId }, body: JSON.stringify({ to: null }) });
  ok(outMove.status === 404, 'an outsider cannot move a team note', outMove.status);
  const toBad = await team('POST', `/api/notes/${pn.note.id}/move`, { to: 'no-such-space' });
  ok(toBad.status === 404, 'moving to an unknown space is refused', toBad.status);
  const back = await team('POST', `/api/notes/${pn.note.id}/move`, { to: null });
  ok(back.ok && back.to === null, 'Undo: it moves back to Personal', JSON.stringify(back));
  ok((await b.api('GET', '/api/notes')).notes.some((n) => n.title === 'Move me'), 'it is in Personal again');
  const cp = await b.api('POST', `/api/notes/${pn.note.id}/copy`, { to: made.spaceId });
  ok(cp.ok && cp.note?.id && cp.note.id !== pn.note.id, 'a copy can be shared into the team', JSON.stringify(cp));
  ok((await b.api('GET', '/api/notes')).notes.some((n) => n.id === pn.note.id) && (await team('GET', '/api/notes')).notes.some((n) => n.id === cp.note.id), 'the original stays and the copy lands in the team');

  // AI never reads a team note
  const aiTeam = await team('POST', `/api/notes/${tn.note.id}/ai/summary`, {});
  ok(aiTeam.status >= 400 && aiTeam.status !== 500, 'AI refuses a team note when asked inside the space', aiTeam.status);
  const aiPers = await b.api('POST', `/api/notes/${tn.note.id}/ai/summary`, {});
  ok(aiPers.error || aiPers.status >= 400, 'AI cannot reach a team note from Personal either', JSON.stringify(aiPers).slice(0, 120));
  const aiChat = await b.api('POST', '/api/ai/chat', { message: 'What did the sprint retro say?', noteId: tn.note.id });
  ok(!JSON.stringify(aiChat).includes('team text'), 'AI chat never shows team note text', JSON.stringify(aiChat).slice(0, 160));

  // mentions inside a space
  const rA = await team('POST', '/api/notes', { title: 'Roadmap Q4', content: 'the plan' });
  const rB = await team('POST', '/api/notes', { title: 'Standup', content: 'we should check Roadmap Q4 today' });
  await b.api('POST', '/api/notes', { title: 'Personal musing', content: 'my own Roadmap Q4 thoughts' });
  const mnt = await team('GET', `/api/notes/${rA.note.id}/mentions`);
  const mids = (mnt.mentions || []).map((m) => m.title);
  ok(mids.includes('Standup') && !mids.includes('Personal musing'), 'mentions in a team come only from that team', JSON.stringify(mids));
  const lk = await team('POST', `/api/notes/${rA.note.id}/mentions/${rB.note.id}/link`);
  ok(lk.ok, 'a mention can be turned into a link inside the team', JSON.stringify(lk));
  const bl = await team('GET', `/api/notes/${rA.note.id}/backlinks`);
  ok((bl.backlinks || []).some((x) => x.title === 'Standup'), 'the link shows as a backlink in the team', JSON.stringify(bl));
  const blP = await b.api('GET', `/api/notes/${rA.note.id}/backlinks`);
  ok(!(blP.backlinks || []).length, 'and not from Personal');

  // members and invites
  const email2 = `mate-${Date.now()}@peblo.test`;
  const mate = await fetch(b.base + '/api/auth/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: email2, password: 'correct horse battery', name: 'Mate' }) }).then((r) => r.json());
  const as2 = async (method, url, body, extra = {}) => { const res = await fetch(b.base + url, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${mate.token}`, ...extra }, body: body ? JSON.stringify(body) : undefined }); return { ...(await res.json().catch(() => ({}))), status: res.status }; };
  const { default: dbp } = await import(pathToFileURL(path.join(REPO, process.env.PEBLO_SERVER_DIST || 'dist', 'server', 'db.js')).href);
  await dbp.user.updateMany({ where: { email: email2 }, data: { emailVerifiedAt: new Date() } });
  const unv = await dbp.$queryRaw`SELECT 1`; void unv;
  const mateId = (await as2('GET', '/api/workspaces')).me?.id;
  await team('POST', '/api/notes', { title: 'Welcome to the team', content: 'hi' });
  const inv0 = await b.api('POST', `/api/workspaces/orgs/${made.id}/invites`, { email: 'nope' });
  ok(inv0.error, 'a bad email is refused', JSON.stringify(inv0));
  const noAdmin = await as2('POST', `/api/workspaces/orgs/${made.id}/invites`, { email: 'x@y.co' });
  ok(noAdmin.status === 404, 'a stranger cannot invite into an organization', noAdmin.status);
  const inv = await b.api('POST', `/api/workspaces/orgs/${made.id}/invites`, { email: email2, orgRole: 'member', spaceIds: [made.spaceId], spaceRole: 'member' });
  ok(inv.id && inv.link?.includes('/invite?token='), 'an invite is created with a link', JSON.stringify(inv));
  const tok = new URL(inv.link).searchParams.get('token');
  const pending = await b.api('GET', `/api/workspaces/orgs/${made.id}/members`);
  ok(pending.invites?.length === 1 && pending.members?.length === 1, 'the pending invite is listed', JSON.stringify(pending).slice(0, 200));
  const bad2 = await as2('GET', '/api/workspaces/invites/lookup?token=garbage');
  ok(bad2.state === 'invalid', 'a made-up token is invalid', JSON.stringify(bad2));
  const look = await as2('GET', `/api/workspaces/invites/lookup?token=${tok}`);
  ok(look.state === 'ready', 'the verified invitee can accept', JSON.stringify(look));
  const wrong = await fetch(b.base + `/api/workspaces/invites/lookup?token=${tok}`, { headers: { Authorization: `Bearer ${so.token}` } }).then((r) => r.json());
  ok(wrong.state === 'wrong_account', 'another account gets the wrong-account state', JSON.stringify(wrong));
  if (look.state === 'ready') {
    const acc = await as2('POST', '/api/workspaces/invites/accept', { token: tok });
    ok(acc.ok, 'the invite is accepted', JSON.stringify(acc));
    const again2 = await as2('POST', '/api/workspaces/invites/accept', { token: tok });
    ok(again2.status === 409, 'an invite works once', again2.status);
    const mw = await as2('GET', '/api/workspaces');
    ok(mw.orgs?.[0]?.name === 'Studio Co' && mw.orgs[0].spaces?.[0]?.role === 'member', 'the new member sees the team', JSON.stringify(mw).slice(0, 200));
    const seen = await as2('GET', '/api/notes', undefined, { 'x-peblo-space': made.spaceId });
    ok(seen.notes?.some((n) => n.title === 'Welcome to the team'), 'the new member reads team notes');
    const mTodo = await as2('POST', '/api/todos', { text: 'Mate task', assigneeId: mateId }, { 'x-peblo-space': made.spaceId });
    ok(mTodo.status === 201, 'the new member can add a team task', JSON.stringify(mTodo).slice(0, 160));
    // Office announcements
    const post1 = await b.api('POST', `/api/workspaces/spaces/${off.id}/announcements`, { title: 'Holiday on Monday', body: 'Office closed for Diwali.' });
    ok(post1.id, 'the publisher posts an announcement', JSON.stringify(post1));
    const teamAnn = await b.api('POST', `/api/workspaces/spaces/${made.spaceId}/announcements`, { title: 'Not an office', body: '' });
    ok(teamAnn.error, 'a team has no announcements', JSON.stringify(teamAnn));
    const notIn = await as2('GET', `/api/workspaces/spaces/${off.id}/announcements`);
    ok(notIn.status === 404, 'a person outside the Office cannot read it', notIn.status);
    await b.api('PUT', `/api/workspaces/spaces/${off.id}/members/${mateId}`, { role: 'member' });
    const feed = await as2('GET', `/api/workspaces/spaces/${off.id}/announcements`);
    ok(feed.posts?.length === 1 && feed.publisher === false, 'a member reads the feed and is not the publisher', JSON.stringify(feed).slice(0, 200));
    const sug = await as2('POST', `/api/workspaces/spaces/${off.id}/announcements`, { title: 'Lunch menu', body: 'Biryani on Friday' });
    ok(sug.status === 201 && sug.id, 'a member can send a suggestion', JSON.stringify(sug));
    const feed2 = await as2('GET', `/api/workspaces/spaces/${off.id}/announcements`);
    ok(feed2.posts.filter((x) => x.status === 'published').length === 1, 'a suggestion is not published');
    const pubView = await b.api('GET', `/api/workspaces/spaces/${off.id}/announcements`);
    ok(pubView.publisher && pubView.posts.some((x) => x.status === 'suggested'), 'the publisher sees the suggestion', JSON.stringify(pubView).slice(0, 160));
    const memberEdit = await as2('PATCH', `/api/workspaces/spaces/${off.id}/announcements/${post1.id}`, { title: 'Hacked' });
    ok(memberEdit.status === 403, 'a member cannot edit a published post', memberEdit.status);
    const ap = await b.api('POST', `/api/workspaces/spaces/${off.id}/announcements/${sug.id}/approve`);
    ok(ap.ok, 'the publisher approves the suggestion', JSON.stringify(ap));
    const ed = await b.api('PATCH', `/api/workspaces/spaces/${off.id}/announcements/${post1.id}`, { title: 'Holiday on Monday', body: 'Office closed for Diwali. Files due Friday 5 pm.' });
    ok(ed.version === 2, 'an edit makes version 2', JSON.stringify(ed));
    const vs = await as2('GET', `/api/workspaces/spaces/${off.id}/announcements/${post1.id}/versions`);
    ok(vs.versions?.length === 1 && vs.versions[0].version === 1 && vs.versions[0].body === 'Office closed for Diwali.', 'the earlier version is kept', JSON.stringify(vs));
    const rt = await b.api('POST', `/api/workspaces/spaces/${off.id}/announcements/${post1.id}/retract`);
    const after = await as2('GET', `/api/workspaces/spaces/${off.id}/announcements`);
    ok(rt.ok && after.posts.find((x) => x.id === post1.id)?.retractedAt, 'a retracted post stays visible as retracted', JSON.stringify(after).slice(0, 200));
    // policy, export, team settings
    const pol0 = await b.api('GET', `/api/workspaces/orgs/${made.id}/policy`);
    ok(pol0.policy?.guests === false && pol0.policy?.membersCreateTeams === true, 'policy starts with guests off and member team creation on', JSON.stringify(pol0));
    const polM = await as2('PATCH', `/api/workspaces/orgs/${made.id}/policy`, { guests: true });
    ok(polM.status === 403, 'a member cannot change policy', polM.status);
    const gInv = await b.api('POST', `/api/workspaces/orgs/${made.id}/invites`, { email: 'auditor@example.com', orgRole: 'guest' });
    ok(gInv.error, 'a guest invite is refused while guests are off', JSON.stringify(gInv));
    await b.api('PATCH', `/api/workspaces/orgs/${made.id}/policy`, { guests: true });
    const gInv2 = await b.api('POST', `/api/workspaces/orgs/${made.id}/invites`, { email: 'auditor@example.com', orgRole: 'guest' });
    ok(gInv2.id, 'and allowed once guests are on', JSON.stringify(gInv2));
    await b.api('PATCH', `/api/workspaces/orgs/${made.id}/policy`, { membersCreateTeams: false });
    const mTeam = await as2('POST', `/api/workspaces/orgs/${made.id}/spaces`, { name: 'Mate team' });
    ok(mTeam.status === 403, 'members cannot create teams when policy says so', mTeam.status);
    await b.api('PATCH', `/api/workspaces/orgs/${made.id}/policy`, { membersCreateTeams: true });
    const mTeam2 = await as2('POST', `/api/workspaces/orgs/${made.id}/spaces`, { name: 'Mate team' });
    ok(mTeam2.status === 201, 'and can again when it is on', mTeam2.status);
    const exp = await b.api('GET', `/api/workspaces/orgs/${made.id}/export`);
    ok(exp.organization?.name === 'Studio Co' && exp.notes?.some((n) => n.title === 'Welcome to the team') && exp.members?.length >= 2 && Array.isArray(exp.tasks), 'the export holds notes, tasks and members', JSON.stringify(Object.keys(exp)));
    const expM = await as2('GET', `/api/workspaces/orgs/${made.id}/export`);
    ok(expM.status === 403, 'a member cannot export the organization', expM.status);
    ok((await b.api('GET', `/api/workspaces/orgs/${made.id}/audit`)).events.some((e) => e.action === 'org.exported'), 'the export is in the audit log');
    const ren = await b.api('PATCH', `/api/workspaces/spaces/${made.spaceId}`, { name: 'Studio crew', defaultRole: 'viewer' });
    ok(ren.ok, 'a lead renames the team and sets the default role', JSON.stringify(ren));
    const renM = await as2('PATCH', `/api/workspaces/spaces/${made.spaceId}`, { name: 'Mine now' });
    ok(renM.status === 403, 'a member cannot rename the team', renM.status);
    await b.api('PATCH', `/api/workspaces/spaces/${made.spaceId}`, { name: 'Studio team', defaultRole: 'member' });
    const leadLeave = await b.api('POST', `/api/workspaces/spaces/${made.spaceId}/leave`);
    ok(leadLeave.error, 'the only lead cannot leave the team', JSON.stringify(leadLeave));
    const tmp = await b.api('POST', `/api/workspaces/orgs/${made.id}/spaces`, { name: 'Temporary team' });
    const closed = await b.api('POST', `/api/workspaces/spaces/${tmp.id}/close`);
    const listC = await b.api('GET', '/api/workspaces');
    ok(closed.ok && !listC.orgs[0].spaces.some((x) => x.id === tmp.id), 'a closed team leaves the switcher', JSON.stringify(closed));
    const trashNote = await team('POST', '/api/notes', { title: 'Trash me', content: 'x' });
    const mTrash = await as2('DELETE', `/api/notes/${trashNote.note.id}`, undefined, { 'x-peblo-space': made.spaceId });
    ok(mTrash.status === 200, 'a member can move a team note to the trash', mTrash.status);
    const mForever = await as2('DELETE', `/api/notes/${trashNote.note.id}?permanent=1`, undefined, { 'x-peblo-space': made.spaceId });
    ok(mForever.status === 403, 'a member cannot delete a team note forever', mForever.status);
    const mRestore = await as2('POST', `/api/notes/${trashNote.note.id}/restore`, undefined, { 'x-peblo-space': made.spaceId });
    ok(mRestore.status === 200, 'a member can restore it from the team trash', mRestore.status);
    await as2('DELETE', `/api/notes/${trashNote.note.id}`, undefined, { 'x-peblo-space': made.spaceId });
    const lForever = await team('DELETE', `/api/notes/${trashNote.note.id}?permanent=1`);
    ok(lForever.status === 200, 'a lead can delete it forever', lForever.status);
    const cant = await as2('POST', `/api/workspaces/orgs/${made.id}/invites`, { email: 'z@z.co' });
    ok(cant.status === 403, 'a plain member cannot invite', cant.status);
    const lastOwner = await b.api('PATCH', `/api/workspaces/orgs/${made.id}/members/${me.id}`, { role: 'member' });
    ok(lastOwner.error, 'the only owner cannot be demoted', JSON.stringify(lastOwner));
    const leaveOwner = await b.api('POST', `/api/workspaces/orgs/${made.id}/leave`);
    ok(leaveOwner.error, 'the only owner cannot leave', JSON.stringify(leaveOwner));
    const aud = await b.api('GET', `/api/workspaces/orgs/${made.id}/audit`);
    ok(aud.events?.some((e) => e.action === 'member.joined') && aud.events.some((e) => e.action === 'invite.sent'), 'the audit log records the invite and the join', JSON.stringify(aud).slice(0, 200));
    const rm = await b.api('DELETE', `/api/workspaces/orgs/${made.id}/members/${mateId}`);
    ok(rm.ok, 'an admin can remove a member', JSON.stringify(rm));
    const gone = await as2('GET', '/api/notes', undefined, { 'x-peblo-space': made.spaceId });
    ok(gone.status === 404, 'a removed member loses access at once', gone.status);
  } else {
    console.log('note: signup users are unverified here; accept path skipped');
  }

  // a viewer can read but not write
  await b.api('PUT', `/api/workspaces/spaces/${made.spaceId}/members/${me.id}`, { role: 'viewer' });
  const vr = await team('GET', '/api/notes');
  ok(vr.status === 200 && vr.notes?.length > 0, 'a viewer can read the team notes');
  const vw = await team('POST', '/api/notes', { title: 'Viewer attempt', content: 'x' });
  ok(vw.status === 403, 'a viewer cannot add a note', vw.status);
  const vt = await team('POST', '/api/todos', { text: 'Viewer task' });
  ok(vt.status === 403, 'a viewer cannot add a task', vt.status);
  await b.api('PUT', `/api/workspaces/spaces/${made.spaceId}/members/${me.id}`, { role: 'lead' });
} catch (e) { ok(false, 'workspaces ran without crashing', e?.stack || e); }
await b.finish();

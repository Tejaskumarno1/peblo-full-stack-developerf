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
} catch (e) { ok(false, 'workspaces ran without crashing', e?.stack || e); }
await b.finish();

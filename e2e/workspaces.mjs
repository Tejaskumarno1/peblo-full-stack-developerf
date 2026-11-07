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
} catch (e) { ok(false, 'workspaces ran without crashing', e?.stack || e); }
await b.finish();

// Expiring join links for an Office (mockups WsE04 to WsE06): create, look up, accept, limits, expiry, revoke.
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
  const person = async (name, verified = true) => {
    const email = `${name.toLowerCase()}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@peblo.test`;
    const r = await fetch(b.base + '/api/auth/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'correct horse battery', name }) }).then((x) => x.json());
    if (verified) await db.user.updateMany({ where: { email }, data: { emailVerifiedAt: new Date() } });
    else await db.user.updateMany({ where: { email }, data: { emailVerifiedAt: null } });
    return { email, token: r.token, call: call(r.token) };
  };
  const tokenOf = (link) => new URL(link).searchParams.get('token');
  const W = '/api/workspaces';

  const noOffice = await b.api('POST', `${W}/orgs`, { name: 'Teams only', start: 'team' });
  ok((await b.api('POST', `${W}/orgs/${noOffice.id}/join-links`, {})).code === 'no_office', 'an organization with no Office cannot make a join link');

  const made = await b.api('POST', `${W}/orgs`, { name: 'Studio Co', start: 'team' });
  const off = await b.api('POST', `${W}/orgs/${made.id}/spaces`, { name: 'Warangal office', kind: 'office' });
  await call(b.token, off.id)('POST', '/api/notes', { title: 'Office welcome', content: 'hello' });
  const A = (m, u, body) => b.api(m, u, body);

  // who may make links, and what they ask for
  const mem = await person('Mem');
  const invM = await A('POST', `${W}/orgs/${made.id}/invites`, { email: mem.email, orgRole: 'member', spaceIds: [off.id], spaceRole: 'member' });
  await mem.call('POST', `${W}/invites/accept`, { token: tokenOf(invM.link) });
  ok((await mem.call('POST', `${W}/orgs/${made.id}/join-links`, {})).status === 403, 'a plain member cannot make a join link');
  ok((await mem.call('GET', `${W}/orgs/${made.id}/join-links`)).status === 403, 'or list them');
  ok((await A('POST', `${W}/orgs/${made.id}/join-links`, { expiresInDays: 0 })).error, 'an expiry of 0 days is refused');
  ok((await A('POST', `${W}/orgs/${made.id}/join-links`, { expiresInDays: 365 })).error, 'a year is refused');
  ok((await A('POST', `${W}/orgs/${made.id}/join-links`, { maxUses: 0 })).error, 'max uses of 0 is refused');

  // create one (defaults: 7 days, unlimited uses)
  const l1 = await A('POST', `${W}/orgs/${made.id}/join-links`, {});
  ok(l1.id && /\/join\?token=/.test(l1.link) && l1.spaceId === off.id && l1.spaceName === 'Warangal office' && l1.uses === 0 && l1.maxUses === null && l1.state === 'active', 'a join link is created for the Office', JSON.stringify(l1));
  const days = (new Date(l1.expiresAt).getTime() - Date.now()) / 86400000;
  ok(days > 6.9 && days < 7.1, 'it expires in 7 days by default', String(days));
  const list = await A('GET', `${W}/orgs/${made.id}/join-links`);
  ok(list.links?.length === 1 && list.links[0].link === l1.link && list.links[0].state === 'active' && list.links[0].createdBy === 'E2E', 'the admin can see and copy it again', JSON.stringify(list));

  // look up, then accept
  ok((await mem.call('GET', `${W}/join-links/lookup?token=nope`)).state === 'invalid', 'a made-up link is invalid');
  const cara = await person('Cara');
  const look = await cara.call('GET', `${W}/join-links/lookup?token=${tokenOf(l1.link)}`);
  ok(look.state === 'ready' && look.orgName === 'Studio Co' && look.spaceName === 'Warangal office' && look.expiresAt && !look.link, 'a link shows what it would do before anyone joins', JSON.stringify(look));
  const un = await person('Una', false);
  ok((await un.call('GET', `${W}/join-links/lookup?token=${tokenOf(l1.link)}`)).state === 'unverified', 'an unverified email is told to verify first');
  ok((await un.call('POST', `${W}/join-links/accept`, { token: tokenOf(l1.link) })).status === 409, 'and cannot join yet');
  const join = await cara.call('POST', `${W}/join-links/accept`, { token: tokenOf(l1.link) });
  ok(join.status === 200 && join.orgName === 'Studio Co' && join.spaceId === off.id && join.orgId === made.id, 'opening the link joins the organization and the Office', JSON.stringify(join));
  const mine = await cara.call('GET', W);
  const org = mine.orgs?.find((o) => o.id === made.id);
  ok(org?.role === 'member' && org.spaces?.some((s) => s.id === off.id && s.role === 'member'), 'they are a member of the organization and the Office', JSON.stringify(mine).slice(0, 300));
  const notes = await call(cara.token, off.id)('GET', '/api/notes');
  ok(notes.status === 200, 'they can read the Office', JSON.stringify(notes).slice(0, 120));
  ok((await cara.call('GET', `${W}/join-links/lookup?token=${tokenOf(l1.link)}`)).state === 'member', 'the same link now says they are already in');
  ok((await cara.call('POST', `${W}/join-links/accept`, { token: tokenOf(l1.link) })).status === 409, 'using it again changes nothing');
  const after = await A('GET', `${W}/orgs/${made.id}/join-links`);
  ok(after.links[0].uses === 1, 'the use is counted', JSON.stringify(after.links[0]));
  const bell = await A('GET', '/api/collab/notifications');
  ok(bell.notifications?.some((n) => n.kind === 'member_joined' && /Cara/.test(n.title)), 'the person who made the link is told', JSON.stringify(bell).slice(0, 200));
  const aud = JSON.stringify(await A('GET', `${W}/orgs/${made.id}/audit`));
  ok(aud.includes('joinlink.created') && aud.includes('member.joined_via_link'), 'creating and using it are in the audit log', aud.slice(0, 200));
  ok(!aud.includes(tokenOf(l1.link)), 'the audit log never holds the link token');

  // limits: one place only, a viewer link
  const l2 = await A('POST', `${W}/orgs/${made.id}/join-links`, { expiresInDays: 1, maxUses: 1, spaceRole: 'viewer' });
  ok(l2.maxUses === 1 && l2.spaceRole === 'viewer', 'a link can have a use limit and a viewer role', JSON.stringify(l2));
  const dan = await person('Dan'); const eve = await person('Eve');
  ok((await dan.call('POST', `${W}/join-links/accept`, { token: tokenOf(l2.link) })).status === 200, 'the first person gets the place');
  const full = await eve.call('GET', `${W}/join-links/lookup?token=${tokenOf(l2.link)}`);
  ok(full.state === 'full', 'the next person is told the link is full', JSON.stringify(full));
  ok((await eve.call('POST', `${W}/join-links/accept`, { token: tokenOf(l2.link) })).status === 409, 'and cannot join');
  const dm = (await dan.call('GET', W)).orgs?.find((o) => o.id === made.id);
  ok(dm?.spaces?.find((s) => s.id === off.id)?.role === 'viewer', 'a viewer link joins people as viewers', JSON.stringify(dm));
  ok((await call(dan.token, off.id)('POST', '/api/notes', { title: 'x', content: 'y' })).status === 403, 'who can read but not write');
  ok((await A('GET', `${W}/orgs/${made.id}/join-links`)).links.find((l) => l.id === l2.id)?.state === 'full', 'the list marks it full');

  // expiry
  const l3 = await A('POST', `${W}/orgs/${made.id}/join-links`, { expiresInDays: 1 });
  await db.$executeRaw`UPDATE org_join_links SET expires_at = now() - interval '1 hour' WHERE id = ${l3.id}`;
  const fay = await person('Fay');
  ok((await fay.call('GET', `${W}/join-links/lookup?token=${tokenOf(l3.link)}`)).state === 'expired', 'an expired link says so');
  ok((await fay.call('POST', `${W}/join-links/accept`, { token: tokenOf(l3.link) })).status === 409, 'and cannot be used');
  ok((await A('GET', `${W}/orgs/${made.id}/join-links`)).links.find((l) => l.id === l3.id)?.state === 'expired', 'the list marks it expired');

  // revoke
  const l4 = await A('POST', `${W}/orgs/${made.id}/join-links`, {});
  ok((await mem.call('DELETE', `${W}/orgs/${made.id}/join-links/${l4.id}`)).status === 403, 'a member cannot revoke a link');
  ok((await A('DELETE', `${W}/orgs/${made.id}/join-links/${l4.id}`)).ok === true, 'an admin can revoke it');
  ok((await fay.call('GET', `${W}/join-links/lookup?token=${tokenOf(l4.link)}`)).state === 'revoked', 'a revoked link says so');
  ok((await fay.call('POST', `${W}/join-links/accept`, { token: tokenOf(l4.link) })).status === 409, 'and cannot be used');
  ok(!(await A('GET', `${W}/orgs/${made.id}/join-links`)).links.some((l) => l.id === l4.id), 'it leaves the list');
  ok((await call(b.token)('DELETE', `${W}/orgs/${made.id}/join-links/${l4.id}`)).status === 404, 'revoking twice is a 404');
  ok((await call(b.token)('DELETE', `${W}/orgs/${noOffice.id}/join-links/${l1.id}`)).status === 404, 'a link of another organization cannot be revoked here');

  // a link never reaches the token itself in the database
  const row = (await db.$queryRaw`SELECT token_hash, token_enc FROM org_join_links WHERE id = ${l1.id}`)[0];
  ok(row.token_hash !== tokenOf(l1.link) && !String(row.token_enc).includes(tokenOf(l1.link)), 'the token is stored hashed and encrypted, never as it is sent');
} catch (e) { console.log('ERROR', e.stack || e); b.check('no exception', false, e.message); }
await b.finish();

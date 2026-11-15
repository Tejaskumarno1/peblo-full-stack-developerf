// Batches 4 and 5: comments with @mentions, review requests, activity, feed, workload, availability.
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
  const A = call(b.token, team), N = call(ana.token, team), B = call(bo.token, team), O = call(out.token, team);
  const notifs = async (tok) => (await call(tok)('GET', '/api/profile/notifications')).notifications || (await call(tok)('GET', '/api/notifications')).notifications || [];

  const t = (await A('POST', '/api/todos', { text: 'Edit the reel', assignees: [ana.id], deadline: new Date(Date.now() - 864e5).toISOString() })).todo;

  // comments
  const c1 = await N('POST', `/api/todos/${t.id}/comments`, { body: 'Cut the intro, @Bo can you check the music?', mentions: [bo.id] });
  ok(c1.status === 201, 'a teammate can comment on a team task', c1.status);
  const th = await B('GET', `/api/todos/${t.id}/thread`);
  ok(th.comments?.length === 1 && th.comments[0].name === 'Ana', 'everyone sees the comment with the author', JSON.stringify(th));
  ok((await O('GET', `/api/todos/${t.id}/thread`)).status === 404, 'someone outside the team cannot read it');
  ok((await N('POST', `/api/todos/${t.id}/comments`, { body: '   ' })).status === 400, 'an empty comment is refused');
  const bad = await N('POST', `/api/todos/${t.id}/comments`, { body: 'hi', mentions: [out.id] });
  ok(bad.status === 201, 'mentioning someone outside the team is ignored, not an error');

  // private task thread hidden
  const priv = (await A('POST', '/api/todos', { text: 'Secret plan', meta: { visibility: 'me' } })).todo;
  ok((await N('GET', `/api/todos/${priv.id}/thread`)).status === 404, 'a Just me task has no thread for others');

  // review request
  const rv = await A('POST', `/api/todos/${t.id}/review`, { to: [bo.id], note: 'Please look at the cut' });
  ok(rv.status === 200, 'asking for a review works', JSON.stringify(rv));
  const after = (await A('GET', '/api/todos')).todos.find((x) => x.id === t.id);
  ok(after.meta?.status === 'review' && after.meta.watchers?.includes(bo.id), 'it moves to In review and Bo watches it');
  ok((await A('POST', `/api/todos/${t.id}/review`, { to: [] })).status === 400, 'a review needs someone to review it');

  // status change shows in the trail
  await B('PATCH', `/api/todos/${t.id}`, { column: 'done' });
  const th2 = await A('GET', `/api/todos/${t.id}/thread`);
  const kinds = (th2.activity || []).map((a) => a.kind);
  ok(kinds.includes('comment') && kinds.includes('review') && kinds.includes('done'), 'the activity trail records comment, review and done', kinds.join(','));

  // feed
  const feed = await N('GET', `/api/workspaces/${team}/feed`);
  ok(feed.items?.some((i) => i.kind === 'done' && i.text === 'Edit the reel'), 'the team feed shows what happened');
  ok(!feed.items?.some((i) => i.text === 'Secret plan'), 'the feed hides private tasks');
  ok((await O('GET', `/api/workspaces/${team}/feed`)).status === 404, 'the feed is for members only');

  // workload
  const t2 = (await A('POST', '/api/todos', { text: 'Late one', assignees: [bo.id], deadline: new Date(Date.now() - 2 * 864e5).toISOString() })).todo;
  await A('POST', '/api/todos', { text: 'Nobody yet' });
  const wl = await A('GET', `/api/workspaces/${team}/workload`);
  const boRow = wl.people?.find((p) => p.id === bo.id);
  ok(boRow?.overdue === 1 && boRow.open === 1, 'workload counts Bo\'s open and overdue tasks', JSON.stringify(boRow));
  ok(wl.people?.find((p) => p.id === ana.id)?.doneThisWeek === 1, 'and what Ana finished this week');
  ok(wl.summary?.unassigned === 2 && wl.overdue?.some((o) => o.id === t2.id), 'the summary lists unassigned and overdue work', JSON.stringify(wl.summary));
  ok((await O('GET', `/api/workspaces/${team}/workload`)).status === 404, 'workload is for members only');

  // availability
  const av = await N('PUT', `/api/workspaces/${team}/availability`, { status: 'away', note: 'Back Monday' });
  ok(av.status === 200, 'a member can set availability');
  ok((await A('GET', `/api/workspaces/${team}/workload`)).people.find((p) => p.id === ana.id)?.availability === 'away', 'and the team sees it');
  ok((await N('PUT', `/api/workspaces/${team}/availability`, { status: 'party' })).status === 400, 'an unknown status is refused');
} catch (e) { b.check('team talk ran without error', false, e.stack || e.message); }
await b.finish();

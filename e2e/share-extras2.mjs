// Polls on the page, read receipts, short link, owner style, extend request (API level).
import { boot } from './lib.mjs';

const { base, api, check, finish } = await boot();
const pub = async (method, path, body) => {
  const r = await fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, redirect: 'manual' });
  let j = null; try { j = await r.json(); } catch { /* none */ }
  return { status: r.status, j, loc: r.headers.get('location') };
};
const S1 = 'sess1aaaaaaaaaaaaaaaa', S2 = 'sess2bbbbbbbbbbbbbbbb';
try {
  const note = (await api('POST', '/api/notes', { title: 'Extras', content: '# E\n\nHello', tags: [] })).note;
  const tok = (await api('POST', `/api/share/note/${note.id}`, { edit: false })).token;

  // polls
  const bad = await api('POST', `/api/share/note/${note.id}/polls`, { question: 'x', options: ['only'] }).catch((e) => ({ error: String(e) }));
  check('a poll needs two options', !!bad.error);
  const mk = await api('POST', `/api/share/note/${note.id}/polls`, { question: 'Ship on Friday?', options: ['Yes', 'No', 'Later'], named: true });
  check('owner makes a poll', !!mk.id);
  let g = await pub('GET', `/api/public/note/${tok}/polls?sid=${S1}`);
  check('guest sees the poll', g.j.polls.length === 1 && g.j.polls[0].options.length === 3 && g.j.polls[0].total === 0, JSON.stringify(g.j));
  let v = await pub('POST', `/api/public/note/${tok}/polls/${mk.id}/vote`, { sessionId: S1, name: 'Ann', choice: 1 });
  check('a vote counts', v.status === 200 && v.j.polls[0].counts[1] === 1 && v.j.polls[0].mine === 1, JSON.stringify(v.j));
  v = await pub('POST', `/api/public/note/${tok}/polls/${mk.id}/vote`, { sessionId: S1, name: 'Ann', choice: 0 });
  check('changing a vote does not double count', v.j.polls[0].total === 1 && v.j.polls[0].counts[0] === 1);
  await pub('POST', `/api/public/note/${tok}/polls/${mk.id}/vote`, { sessionId: S2, name: 'Bo', choice: 0 });
  g = await pub('GET', `/api/public/note/${tok}/polls?sid=${S2}`);
  check('results add up and names show on a named poll', g.j.polls[0].counts[0] === 2 && g.j.polls[0].voters.length === 2);
  v = await pub('POST', `/api/public/note/${tok}/polls/${mk.id}/vote`, { sessionId: S2, choice: 9 });
  check('a bad option is refused', v.status === 400);
  await api('POST', `/api/share/note/${note.id}/polls/${mk.id}/close`);
  v = await pub('POST', `/api/public/note/${tok}/polls/${mk.id}/vote`, { sessionId: S2, choice: 1 });
  check('a closed poll refuses votes', v.status === 409);
  await api('POST', `/api/share/note/${note.id}/polls/${mk.id}/reopen`);
  await api('POST', `/api/share/note/${note.id}/polls/${mk.id}/reset`);
  g = await pub('GET', `/api/public/note/${tok}/polls?sid=${S1}`);
  check('reset clears votes, keeps the poll', g.j.polls.length === 1 && g.j.polls[0].total === 0);
  const own = await api('GET', `/api/share/note/${note.id}/polls`);
  check('owner lists polls', own.polls.length === 1);
  await api('POST', `/api/share/note/${note.id}/polls/${mk.id}/remove`);
  g = await pub('GET', `/api/public/note/${tok}/polls?sid=${S1}`);
  check('remove deletes it', g.j.polls.length === 0);

  // read receipts
  await pub('POST', `/api/public/note/${tok}/presence`, { sessionId: S1, name: 'Ann', progress: 40 });
  await pub('POST', `/api/public/note/${tok}/presence`, { sessionId: S2, name: 'Bo', progress: 95 });
  await pub('POST', `/api/public/note/${tok}/presence`, { sessionId: S2, name: 'Bo', progress: 20 });
  await new Promise((r) => setTimeout(r, 400));
  const act = await api('GET', `/api/share/note/${note.id}/activity`);
  const rd = act.stats.readers;
  check('readers are tracked', rd && rd.count === 2, JSON.stringify(rd));
  check('progress only moves forward', rd.people.find((p) => p.name === 'Bo').progress === 95);
  check('finish rate and histogram', rd.finishRate === 50 && rd.stops.length === 10 && rd.stops[4] === 1 && rd.stops[9] === 1, JSON.stringify(rd));

  // short link
  const s1 = await api('GET', `/api/share/note/${note.id}/short`);
  const s2 = await api('GET', `/api/share/note/${note.id}/short`);
  check('a short code is made once and kept', /^[a-z0-9]{6}$/.test(s1.code) && s1.code === s2.code, JSON.stringify(s1));
  const red = await pub('GET', `/l/${s1.code}`);
  check('the short link redirects to the page', red.status === 302 && red.loc === `/s/note/${tok}`, `${red.status} ${red.loc}`);
  const nored = await pub('GET', `/l/zzzzzz`);
  check('an unknown code goes home', nored.status === 302 && nored.loc === '/');

  // owner style
  await api('GET', `/api/share/note/${note.id}/live?style=orbit`);
  const pg = await pub('GET', `/api/public/note/${tok}?sid=${S1}`);
  check('the page carries the owner style', pg.j.ownerStyle === 'orbit', JSON.stringify(pg.j.ownerStyle));

  // extend request
  const ex = await pub('POST', `/api/public/note/${tok}/extend-request`, { sessionId: S1, name: 'Ann' });
  check('guest can ask to extend', ex.status === 200);
  const lv = await api('GET', `/api/share/note/${note.id}/live`);
  check('owner sees the request', lv.extendRequest && lv.extendRequest.by === 'Ann', JSON.stringify(lv.extendRequest));
  await api('POST', `/api/share/note/${note.id}`, { edit: false, expiresAt: new Date(Date.now() + 86400000).toISOString() });
  const lv2 = await api('GET', `/api/share/note/${note.id}/live`);
  check('extending clears the request', !lv2.extendRequest, JSON.stringify(lv2.extendRequest));
} catch (e) { check('extras2 ran without error', false, String(e)); }
await finish();

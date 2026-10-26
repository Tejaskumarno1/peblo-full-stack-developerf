// Waiting room (owner admits guests) and per-person roles, through the real server.
import { boot } from './lib.mjs';

const { base, api, check, finish } = await boot();
const j = async (method, path, body) => { const r = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, body: await r.json().catch(() => ({})) }; };
const sid = (n) => `guest-session-${n}-abcdefghijkl`;
try {
  const note = (await api('POST', '/api/notes', { title: 'Access note', content: '# Hello\n\nSecret body', tags: [] })).note;
  const tok = (await api('POST', `/api/share/note/${note.id}`, { edit: true })).token;
  const pub = `/api/public/note/${tok}`;

  // a guest already on the page when approval is switched on stays in
  await j('POST', `${pub}/presence`, { sessionId: sid(0), name: 'Early' });
  await api('POST', `/api/share/note/${note.id}/approval`, { on: true });
  let r = await j('GET', `${pub}?sid=${sid(0)}`);
  check('someone already on the page stays in', r.body.content && !r.body.waiting);

  // a new guest waits
  r = await j('GET', `${pub}?sid=${sid(1)}`);
  check('a new guest gets no content', r.status === 200 && r.body.waiting === 'waiting' && !r.body.content);
  r = await j('GET', pub);
  check('no session means no content either', r.body.waiting === 'waiting' && !r.body.content);
  r = await j('POST', `${pub}/knock`, { sessionId: sid(1), name: 'Meera' });
  check('knocking puts them in the waiting list', r.body.status === 'waiting');
  r = await j('POST', `${pub}/presence`, { sessionId: sid(1), name: 'Meera' });
  check('a waiting guest cannot join the presence list', r.status === 403 && r.body.waiting);
  r = await j('PUT', pub, { sessionId: sid(1), content: 'hacked', baseUpdatedAt: new Date().toISOString() });
  check('a waiting guest cannot save', r.status === 403);
  let live = await api('GET', `/api/share/note/${note.id}/live`);
  check('the owner sees who is waiting', live.approval === true && live.waiting.length === 1 && live.waiting[0].name === 'Meera', JSON.stringify(live.waiting));

  // admit
  await api('POST', `/api/share/note/${note.id}/guests/${live.waiting[0].id}/admit`, {});
  r = await j('GET', `${pub}?sid=${sid(1)}`);
  check('after admitting, the guest reads the note', /Secret body/.test(r.body.content || '') && r.body.canEdit === true);
  r = await j('POST', `${pub}/presence`, { sessionId: sid(1), name: 'Meera' });
  check('and joins the presence list', r.status === 200 && r.body.canEdit === true);
  live = await api('GET', `/api/share/note/${note.id}/live`);
  check('the waiting list is empty again', live.waiting.length === 0);

  // decline
  await j('POST', `${pub}/knock`, { sessionId: sid(2), name: 'Rohan' });
  live = await api('GET', `/api/share/note/${note.id}/live`);
  await api('POST', `/api/share/note/${note.id}/guests/${live.waiting[0].id}/decline`, {});
  r = await j('GET', `${pub}?sid=${sid(2)}`);
  check('a declined guest is told so and gets nothing', r.body.waiting === 'declined' && !r.body.content);
  r = await j('POST', `${pub}/knock`, { sessionId: sid(2), name: 'Rohan' });
  check('knocking again does not undo a decline', r.body.status === 'declined');

  // roles: take edit away from one person
  live = await api('GET', `/api/share/note/${note.id}/live`);
  const meera = live.viewers.find((v) => v.name === 'Meera');
  check('the viewers list shows each person can edit', meera && meera.canEdit === true && meera.custom === false, JSON.stringify(meera));
  await api('POST', `/api/share/note/${note.id}/viewers/${meera.id}/role`, { role: 'view' });
  r = await j('GET', `${pub}?sid=${sid(1)}`);
  check('their page becomes view only', r.body.canEdit === false);
  r = await j('POST', `${pub}/presence`, { sessionId: sid(1), name: 'Meera' });
  check('presence tells their page right away', r.body.canEdit === false);
  r = await j('PUT', pub, { sessionId: sid(1), content: 'nope', baseUpdatedAt: new Date().toISOString() });
  check('their save is refused', r.status === 403 && /view only/.test(r.body.error));
  r = await j('PUT', pub, { sessionId: sid(0), content: '# Hello\n\nEarly was here', baseUpdatedAt: new Date().toISOString(), force: true });
  check('others on the link still edit', r.status === 200, JSON.stringify(r.body));
  live = await api('GET', `/api/share/note/${note.id}/live`);
  const m2 = live.viewers.find((v) => v.name === 'Meera');
  check('the owner sees the custom role', m2.custom === true && m2.canEdit === false && m2.status !== 'editing', JSON.stringify(m2));
  await api('POST', `/api/share/note/${note.id}/viewers/${m2.id}/role`, { role: null });
  r = await j('GET', `${pub}?sid=${sid(1)}`);
  check('clearing the role goes back to the link default', r.body.canEdit === true);

  // a view-only link can give one person edit
  const note2 = (await api('POST', '/api/notes', { title: 'View link', content: '# V\n\nbody', tags: [] })).note;
  const tok2 = (await api('POST', `/api/share/note/${note2.id}`, { edit: false })).token;
  const pub2 = `/api/public/note/${tok2}`;
  await j('POST', `${pub2}/presence`, { sessionId: sid(5), name: 'Ishita' });
  r = await j('PUT', pub2, { sessionId: sid(5), content: 'x', baseUpdatedAt: new Date().toISOString() });
  check('view-only link refuses a save', r.status === 403);
  const l2 = await api('GET', `/api/share/note/${note2.id}/live`);
  await api('POST', `/api/share/note/${note2.id}/viewers/${l2.viewers.find((v) => v.name === 'Ishita').id}/role`, { role: 'edit' });
  r = await j('GET', `${pub2}?sid=${sid(5)}`);
  check('one person can be given edit on a view-only link', r.body.canEdit === true);
  r = await j('PUT', pub2, { sessionId: sid(5), content: '# V\n\nIshita edited', baseUpdatedAt: new Date().toISOString(), force: true });
  check('and their save goes through', r.status === 200, JSON.stringify(r.body));
  r = await j('GET', `${pub2}?sid=${sid(6)}`);
  check('everyone else is still view only', r.body.canEdit === false);

  // switching approval off lets everyone in
  await api('POST', `/api/share/note/${note.id}/approval`, { on: false });
  r = await j('GET', `${pub}?sid=${sid(9)}`);
  check('without approval new guests read at once', /Early was here/.test(r.body.content || ''));
  const bad = await api('POST', `/api/share/note/${note.id}/viewers/nothere/role`, { role: 'owner' }).catch((e) => ({ err: String(e) }));
  check('a made-up role is refused', !!bad.err || bad.error);
} catch (e) { check('access test ran without error', false, String(e)); }
await finish();

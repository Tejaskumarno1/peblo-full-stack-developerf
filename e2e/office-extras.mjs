// Office co-editing for people with access, org-key requirement, invite notifications, per-space pop-up switches, All my spaces search.
import { boot, REPO } from './lib.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, } from 'node:url';
import WebSocket from 'ws';
const b = await boot({ freshTip: false });
const ok = (c, m, x) => b.check(m, !!c, x);
const shots = process.env.SHOTS || 'D:\\Peblo\\_shots';
try { fs.mkdirSync(shots, { recursive: true }); } catch {}
const p = b.page;
const sleep = (ms) => p.waitForTimeout(ms);
const J = { 'Content-Type': 'application/json' };
try {
  const { default: db } = await import(pathToFileURL(path.join(REPO, process.env.PEBLO_SERVER_DIST || 'dist', 'server', 'db.js')).href);
  const org = await b.api('POST', '/api/workspaces/orgs', { name: 'Extras Co', start: 'team' });
  const off = await b.api('POST', `/api/workspaces/orgs/${org.id}/spaces`, { name: 'Extras office', kind: 'office' });
  const person = async (name) => {
    const email = `${name.toLowerCase()}-${Date.now()}@peblo.test`;
    const su = await fetch(b.base + '/api/auth/signup', { method: 'POST', headers: J, body: JSON.stringify({ email, password: 'correct horse battery', name }) }).then((x) => x.json());
    await db.user.updateMany({ where: { email }, data: { emailVerifiedAt: new Date() } });
    return { email, token: su.token, id: su.user?.id };
  };
  const call = (tok, space) => async (method, url, body) => { const r = await fetch(b.base + url, { method, headers: { ...J, Authorization: `Bearer ${tok}`, ...(space ? { 'x-peblo-space': space } : {}) }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, ...(await r.json().catch(() => ({}))) }; };
  const ed = await person('Edie'); const vw = await person('Vera'); const no = await person('Nora');
  for (const x of [ed, vw, no]) {
    const inv = await b.api('POST', `/api/workspaces/orgs/${org.id}/invites`, { email: x.email, orgRole: 'member', spaceIds: [off.id], spaceRole: 'member' });
    // (3) an invited person who already has an account is told in their notifications
    const n = await call(x.token)('GET', '/api/collab/notifications');
    ok((n.notifications || []).some((m) => m.kind === 'org_invite' && /^\/invite\?token=/.test(m.body || '')), `${x.email.split('-')[0]} gets an invite notification`, JSON.stringify(n).slice(0, 200));
    const acc = await call(x.token)('POST', '/api/workspaces/invites/accept', { token: new URL(inv.link).searchParams.get('token') });
    ok(acc.ok, 'invite accepted', JSON.stringify(acc));
    x.id = x.id || (await db.user.findFirst({ where: { email: x.email } })).id;
  }
  // (1) live co-editing: the author writes a note and shares it, edit and view
  const mine = await call(b.token, off.id)('POST', '/api/notes', { title: 'Live plan', content: 'one' });
  const nid = mine.note?.id || mine.id;
  ok(nid, 'author has an office note', JSON.stringify(mine).slice(0, 150));
  const set = await call(b.token, off.id)('PUT', `/api/notes/${nid}/access`, { people: [{ userId: ed.id, level: 'edit' }, { userId: vw.id, level: 'view' }] });
  ok(set.status === 200, 'access set', JSON.stringify(set).slice(0, 150));
  const tEd = await call(ed.token)('POST', '/api/collab/ticket', { noteId: nid });
  ok(tEd.ticket && tEd.readOnly === false, 'a person with edit gets a live-editing ticket', JSON.stringify(tEd));
  const tVw = await call(vw.token)('POST', '/api/collab/ticket', { noteId: nid });
  ok(tVw.ticket && tVw.readOnly === true, 'a person with view gets a read-only ticket');
  const tNo = await call(no.token)('POST', '/api/collab/ticket', { noteId: nid });
  ok(tNo.status === 404, 'a person without access gets no ticket', String(tNo.status));
  const open = (ticket) => new Promise((res) => {
    const ws = new WebSocket(b.base.replace('http', 'ws') + `/collab?note=${nid}&ticket=${encodeURIComponent(ticket)}`);
    const t = setTimeout(() => { try { ws.close(); } catch {} res('timeout'); }, 5000);
    ws.on('open', () => { clearTimeout(t); try { ws.close(); } catch {} res('open'); });
    ws.on('error', () => { clearTimeout(t); res('refused'); });
    ws.on('unexpected-response', () => { clearTimeout(t); res('refused'); });
  });
  ok((await open(tEd.ticket)) === 'open', 'the editor joins the live room');
  ok((await open(tVw.ticket)) === 'open', 'the viewer joins the live room to read');

  // (2) organization key requirement
  const pol = await b.api('PATCH', `/api/workspaces/orgs/${org.id}/policy`, { requireOrgKey: true });
  const chat = (tok) => call(tok, off.id)('POST', '/api/ai/chat', { message: 'hi' });
  const c1 = await chat(b.token);
  ok(c1.status === 403 && c1.code === 'org_key_missing', 'AI in an org that requires its own key is refused until a key is added', JSON.stringify(c1).slice(0, 200));
  await b.api('PUT', `/api/workspaces/orgs/${org.id}/ai-keys/openai`, { key: 'sk-test-org-key-12345678' });
  const c2 = await chat(b.token);
  ok(c2.code !== 'org_key_missing' && !(c2.status === 403 && /requires its own/.test(c2.error || '')), 'with an org key the call goes past the requirement', JSON.stringify(c2).slice(0, 200));
  await b.api('PATCH', `/api/workspaces/orgs/${org.id}/policy`, { aiFeatures: false });
  const c3 = await chat(b.token);
  ok(c3.status === 403 && /turned AI off/.test(c3.error || ''), 'AI features off blocks note AI too', JSON.stringify(c3).slice(0, 150));
  const c4 = await call(b.token, off.id)('POST', `/api/notes/${nid}/ai/summary`, {});
  ok(c4.status === 403 && /turned AI off/.test(c4.error || ''), 'AI features off blocks the note summary route', JSON.stringify(c4).slice(0, 150));
  await b.api('PATCH', `/api/workspaces/orgs/${org.id}/policy`, { aiFeatures: true, requireOrgKey: false });

  // (4) per-space pop-up switches on the notification page
  await p.goto(b.base + '/notifications', { waitUntil: 'networkidle' });
  await p.getByTestId('per-space').waitFor({ timeout: 8000 });
  await p.screenshot({ path: shots + '\\ox-notif.png' });
  await p.getByRole('switch', { name: 'Pop-ups from Extras office' }).click();
  await sleep(900);
  const me = await b.api('GET', '/api/profile');
  const sm = (me.user?.settings || me.settings || {}).spaceMute;
  ok(sm && sm[off.id] === true, 'turning a space off saves it as muted', JSON.stringify(sm));
  await p.getByRole('tab', { name: 'Invites' }).click().catch(() => p.getByRole('radio', { name: 'Invites' }).click());
  ok(true, 'the Invites filter exists');

  // (5) All my spaces search
  await call(b.token)('POST', '/api/notes', { title: 'Zebra personal note', content: 'zebra' });
  await call(b.token, off.id)('POST', '/api/notes', { title: 'Zebra office note', content: 'zebra' });
  await p.evaluate((id) => localStorage.setItem('peblo-space', id), off.id);
  await p.goto(b.base + '/notes', { waitUntil: 'networkidle' });
  await p.keyboard.press('Control+k');
  await p.getByTestId('cmd-all-spaces').waitFor({ timeout: 8000 });
  await p.locator('.cmd-input').fill('zebra');
  await sleep(900);
  ok(!(await p.locator('.cmd-palette').innerText()).includes('Zebra personal'), 'search is limited to this space by default');
  await p.getByTestId('cmd-all-spaces').click();
  await sleep(1200);
  const txt = await p.locator('.cmd-palette').innerText();
  ok(txt.includes('Zebra personal') && txt.includes('Zebra office'), 'All my spaces finds notes from Personal and the office', txt.slice(0, 300));
  await p.screenshot({ path: shots + '\\ox-search.png' });
} catch (e) { console.log('ERROR', e.stack || e); b.check('no exception', false, e.message); }
await b.finish();

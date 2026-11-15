// A teammate edits a team note somebody else wrote, in the browser, and the author sees it; a viewer cannot type.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { boot, REPO } from './lib.mjs';
const b = await boot();
const ok = (c, m, x) => b.check(m, !!c, x);
try {
  const me = (await b.api('GET', '/api/workspaces')).me;
  const org = await b.api('POST', '/api/workspaces/orgs', { name: 'Studio Co', start: 'team', spaceName: 'Studio team' });
  const mk = async (name) => {
    const email = `${name}-${Date.now()}@peblo.test`;
    const s = await fetch(b.base + '/api/auth/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'correct horse battery', name }) }).then((r) => r.json());
    const { default: db } = await import(pathToFileURL(path.join(REPO, process.env.PEBLO_SERVER_DIST || 'dist', 'server', 'db.js')).href);
    await db.user.updateMany({ where: { email }, data: { emailVerifiedAt: new Date() } });
    const call = async (method, url, body) => { const r = await fetch(b.base + url, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s.token}`, 'x-peblo-space': org.spaceId }, body: body ? JSON.stringify(body) : undefined }); return { ...(await r.json().catch(() => ({}))), status: r.status }; };
    const inv = await b.api('POST', `/api/workspaces/orgs/${org.id}/invites`, { email, orgRole: 'member', spaceIds: [org.spaceId], spaceRole: name === 'viewer' ? 'viewer' : 'member' });
    const tok = new URL(inv.link).searchParams.get('token');
    const acc = await call('POST', '/api/workspaces/invites/accept', { token: tok });
    return { email, token: s.token, call, acc };
  };
  const mate = await mk('mate');
  const viewer = await mk('viewer');
  ok(mate.acc.ok && viewer.acc.ok, 'the teammates joined', JSON.stringify([mate.acc, viewer.acc]));
  const note = await fetch(b.base + '/api/notes', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${b.token}`, 'x-peblo-space': org.spaceId }, body: JSON.stringify({ title: 'Shared plan', content: 'owner text' }) }).then((r) => r.json());
  const noteAs = async (who, id) => (await who.call('GET', '/api/notes/' + id)).note?.content || '';

  const open = async (who) => {
    const ctx = await b.ctx.browser().newContext({ viewport: { width: 1440, height: 900 } });
    await ctx.addInitScript(([t, s]) => { try { localStorage.setItem('peblo-token', t); localStorage.setItem('peblo-space', s); } catch {} }, [who.token, org.spaceId]);
    const page = await ctx.newPage();
    await page.goto(b.base + '/notes/' + note.note.id, { waitUntil: 'networkidle' });
    await page.locator('.bn-editor').waitFor({ timeout: 20000 });
    await page.waitForTimeout(1500);
    return page;
  };
  const mp = await open(mate);
  ok((await mp.locator('.bn-editor').first().getAttribute('contenteditable')) === 'true', 'teammate: the note is editable in the browser');
  await mp.locator('.bn-editor').first().click();
  await mp.keyboard.press('Control+End');
  await mp.keyboard.type(' mate-wrote-this');
  await mp.waitForTimeout(3000);
  const saved = await noteAs(mate, note.note.id);
  ok(saved.includes('mate-wrote-this'), 'teammate: the edit reaches the server', saved);
  const ownerSees = (await fetch(b.base + '/api/notes/' + note.note.id, { headers: { Authorization: `Bearer ${b.token}`, 'x-peblo-space': org.spaceId } }).then((r) => r.json())).note?.content || '';
  ok(ownerSees.includes('mate-wrote-this'), 'the author sees the teammate edit', ownerSees);
  await mp.reload({ waitUntil: 'networkidle' });
  await mp.locator('.bn-editor').waitFor({ timeout: 20000 });
  ok((await mp.locator('.bn-editor').innerText()).includes('mate-wrote-this'), 'teammate: the edit is there after a reload');
  const vp = await open(viewer);
  ok((await vp.locator('.bn-editor').first().getAttribute('contenteditable')) !== 'true', 'viewer: the note is read-only');
  void me;
} catch (e) { ok(false, 'team-mate-edit ran without crashing', e?.stack || e); }
await b.finish();

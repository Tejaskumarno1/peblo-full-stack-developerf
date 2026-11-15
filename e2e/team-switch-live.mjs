// Switching spaces WITHOUT a reload: the open editor, the note list and a new note must stay editable and save into the right space.
import { boot } from './lib.mjs';
const b = await boot({ freshTip: true });
const ok = (c, m, x) => b.check(m, !!c, x);
const p = b.page;
const errs = [];
p.on('pageerror', (e) => errs.push(String(e)));
const ready = async () => { await p.locator('.bn-editor').first().waitFor({ timeout: 20000 }); await p.waitForTimeout(700); };
const editable = async () => (await p.locator('.bn-editor').first().getAttribute('contenteditable')) === 'true';
const typeIn = async (text) => { await p.locator('.bn-editor').first().click(); await p.keyboard.press('Control+End'); await p.keyboard.type(text); await p.waitForTimeout(2500); };
const text = async (spaceId, id) => (await (await fetch(b.base + '/api/notes/' + id, { headers: { Authorization: `Bearer ${b.token}`, ...(spaceId ? { 'x-peblo-space': spaceId } : {}) } })).json()).note?.content || '';
const mk = async (spaceId, title, content) => (await (await fetch(b.base + '/api/notes', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${b.token}`, ...(spaceId ? { 'x-peblo-space': spaceId } : {}) }, body: JSON.stringify({ title, content }) })).json()).note;
const pick = async (re) => { await p.getByTestId('space-pill').click(); await p.getByRole('menuitemradio', { name: re }).click(); await p.waitForTimeout(1500); };
try {
  const personal = await mk(null, 'Personal live', 'alpha');
  const org = await b.api('POST', '/api/workspaces/orgs', { name: 'Live Co', start: 'team', spaceName: 'Live team' });
  const office = await b.api('POST', `/api/workspaces/orgs/${org.id}/spaces`, { name: 'Live office', kind: 'office' });
  const tnote = await mk(org.spaceId, 'Team live', 'beta');
  const onote = await mk(office.id, 'Office live', 'gamma');

  await p.goto(b.base + '/notes/' + personal.id, { waitUntil: 'networkidle' });
  await ready();
  await typeIn(' p1');
  ok((await text(null, personal.id)).includes('p1'), 'Personal: edit saved');

  // switch to the team while the personal note is still open, then edit whatever the editor now shows
  await pick(/Live team/);
  await p.waitForTimeout(800);
  const still = await p.locator('.bn-editor').count();
  if (still) { ok(await editable(), 'after the switch the open editor is not left read-only'); }
  // open the team note through the app (sidebar / list), not by URL
  const link = p.getByText('Team live').first();
  await link.waitFor({ timeout: 15000 });
  await link.click();
  await ready();
  ok(await editable(), 'Team: note opened from the list is editable');
  await typeIn(' t1');
  ok((await text(org.spaceId, tnote.id)).includes('t1'), 'Team: edit saved into the team space', await text(org.spaceId, tnote.id));
  ok(!(await text(null, personal.id)).includes('t1'), 'Team edit did not leak into the personal note');

  await pick(/Live office/);
  const olink = p.getByText('Office live').first();
  await olink.waitFor({ timeout: 15000 });
  await olink.click();
  await ready();
  ok(await editable(), 'Office: note opened from the list is editable');
  await typeIn(' o1');
  ok((await text(office.id, onote.id)).includes('o1'), 'Office: edit saved into the office space');

  await pick(/Personal/);
  const plink = p.getByText('Personal live').first();
  await plink.waitFor({ timeout: 15000 });
  await plink.click();
  await ready();
  ok(await editable(), 'Back in Personal: editable');
  await typeIn(' p2');
  ok((await text(null, personal.id)).includes('p2'), 'Back in Personal: second edit saved');

  // reload inside a team space keeps the space and stays editable
  await pick(/Live team/);
  await p.reload({ waitUntil: 'networkidle' });
  await p.getByText('Team live').first().click();
  await ready();
  ok(await editable(), 'Team after reload: editable');
  await p.screenshot({ path: 'D:\\Peblo\\_shots\\team-switch-live.png' });
  ok(errs.length === 0, 'no uncaught page errors', errs.join('\n'));
} catch (e) { ok(false, 'team-switch-live ran without crashing', e?.stack || e); await p.screenshot({ path: 'D:\\Peblo\\_shots\\team-switch-live-fail.png' }).catch(() => {}); }
await b.finish();

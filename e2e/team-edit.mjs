// Notes stay editable after switching spaces: edit in Personal, switch to a team and to an Office, edit there, switch back, reload.
import { boot } from './lib.mjs';
const b = await boot({ freshTip: true });
const ok = (c, m, x) => b.check(m, !!c, x);
const p = b.page;
const ready = async () => { await p.locator('.bn-editor').waitFor({ timeout: 20000 }); await p.waitForTimeout(700); };
const typeIn = async (text) => {
  const ed = p.locator('.bn-editor').first();
  await ed.click();
  await p.keyboard.press('Control+End');
  await p.keyboard.type(text);
  await p.waitForTimeout(2500); // autosave
};
const editable = async () => (await p.locator('.bn-editor').first().getAttribute('contenteditable')) === 'true';
const noteText = async (spaceId, id) => {
  const r = await fetch(b.base + '/api/notes/' + id, { headers: { Authorization: `Bearer ${b.token}`, ...(spaceId ? { 'x-peblo-space': spaceId } : {}) } });
  return (await r.json()).note?.content || '';
};
try {
  const personal = await b.api('POST', '/api/notes', { title: 'Personal one', content: 'alpha' });
  const org = await b.api('POST', '/api/workspaces/orgs', { name: 'Studio Co', start: 'team', spaceName: 'Studio team' });
  const office = await b.api('POST', `/api/workspaces/orgs/${org.id}/spaces`, { name: 'HQ office', kind: 'office' });
  await p.goto(b.base + '/notes/' + personal.note.id, { waitUntil: 'networkidle' });
  await ready();
  ok(await editable(), 'Personal: the note is editable');
  await typeIn(' first-edit');
  ok((await noteText(null, personal.note.id)).includes('first-edit'), 'Personal: the edit is saved');

  // switch to the team through the pill
  await p.getByTestId('space-pill').click();
  await p.getByRole('menuitemradio', { name: /Studio team/ }).click();
  await p.waitForTimeout(1200);
  const tn = await fetch(b.base + '/api/notes', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${b.token}`, 'x-peblo-space': org.spaceId }, body: JSON.stringify({ title: 'Team one', content: 'beta' }) }).then((r) => r.json());
  await p.goto(b.base + '/notes/' + tn.note.id, { waitUntil: 'networkidle' });
  await ready();
  ok(await editable(), 'Team: the note is editable');
  await typeIn(' team-edit');
  ok((await noteText(org.spaceId, tn.note.id)).includes('team-edit'), 'Team: the edit is saved', await noteText(org.spaceId, tn.note.id));

  // switch back to Personal without reloading, then edit the personal note again
  await p.getByTestId('space-pill').click();
  await p.getByRole('menuitemradio', { name: /Personal/ }).click();
  await p.waitForTimeout(1200);
  await p.goto(b.base + '/notes/' + personal.note.id, { waitUntil: 'networkidle' });
  await ready();
  ok(await editable(), 'Back in Personal: still editable');
  await typeIn(' second-edit');
  ok((await noteText(null, personal.note.id)).includes('second-edit'), 'Back in Personal: the second edit is saved');

  // Office
  await p.getByTestId('space-pill').click();
  await p.getByRole('menuitemradio', { name: /HQ office/ }).click();
  await p.waitForTimeout(1200);
  const on = await fetch(b.base + '/api/notes', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${b.token}`, 'x-peblo-space': office.id }, body: JSON.stringify({ title: 'Office one', content: 'gamma' }) }).then((r) => r.json());
  await p.goto(b.base + '/notes/' + on.note.id, { waitUntil: 'networkidle' });
  await ready();
  ok(await editable(), 'Office: the note is editable');
  await typeIn(' office-edit');
  ok((await noteText(office.id, on.note.id)).includes('office-edit'), 'Office: the edit is saved');
} catch (e) { ok(false, 'team-edit ran without crashing', e?.stack || e); }
await b.finish();

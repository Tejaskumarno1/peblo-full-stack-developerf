// Round 11: Orbit Trash and Archive screens: restore, unarchive, empty trash with confirmation.
import { boot } from './lib.mjs';
const { base, api, page, check, finish } = await boot();
const go = async (path) => {
  await page.goto(base + '/tasks');
  await page.evaluate(() => { localStorage.setItem('peblo-style', 'orbit'); localStorage.setItem('peblo-orbit-help-seen', '1'); });
  await page.goto(base + path);
  await page.waitForTimeout(1500);
};
const list = async (q) => { const r = await api('GET', '/api/notes?' + q); return r.notes || r; };
try {
  const a = (await api('POST', '/api/notes', { title: 'Alpha gone', content: 'a', tags: ['x'] })).note;
  const b = (await api('POST', '/api/notes', { title: 'Beta gone', content: 'b', tags: ['x'] })).note;
  const c = (await api('POST', '/api/notes', { title: 'Gamma kept', content: 'c', tags: ['x'] })).note;
  await api('DELETE', '/api/notes/' + a.id);
  await api('DELETE', '/api/notes/' + b.id);
  await api('POST', '/api/notes/' + c.id + '/archive');
  await go('/notes');
  await page.getByRole('button', { name: 'Trash', exact: true }).click();
  await page.waitForTimeout(900);
  check('the trash lists deleted notes', (await page.locator('.o-tile').count()) === 2);
  check('..with how long ago they were deleted', /DELETED/.test(await page.locator('.o-tile').first().innerText()));

  await page.getByRole('button', { name: 'Restore Alpha gone' }).click();
  await page.waitForTimeout(900);
  check('Restore brings a note back', (await list('')).some((n) => n.id === a.id));
  check('..and removes it from the trash', (await page.locator('.o-tile').count()) === 1);

  await page.getByRole('button', { name: 'Empty trash' }).click();
  check('Empty trash asks first', (await page.getByRole('alertdialog', { name: 'Empty the trash?' }).count()) === 1);
  await page.getByRole('button', { name: 'Keep them' }).click();
  await page.waitForTimeout(300);
  check('..and Keep them cancels', (await list('deleted=true')).length === 1);
  await page.getByRole('button', { name: 'Empty trash' }).click();
  await page.getByRole('button', { name: 'Yes, delete forever' }).click();
  await page.waitForTimeout(1200);
  check('confirming deletes the notes for good', (await list('deleted=true')).length === 0);
  check('..and the screen says so', (await page.getByText(/Trash emptied: 1 note deleted/).count()) === 1);

  await page.getByRole('button', { name: 'Archive', exact: true }).click();
  await page.waitForTimeout(900);
  check('the archive lists archived notes', (await page.locator('.o-tile').count()) === 1);
  await page.getByRole('button', { name: 'Unarchive Gamma kept' }).click();
  await page.waitForTimeout(900);
  check('Unarchive returns the note to the list', (await list('archived=true')).length === 0 && (await list('')).some((n) => n.id === c.id));
} catch (e) {
  check('script ran to the end', false, String(e).slice(0, 300));
}
await finish();

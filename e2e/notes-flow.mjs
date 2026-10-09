import { boot } from './lib.mjs';
const { base, api, page, check, finish } = await boot();
try {
  const a = (await api('POST', '/api/notes', { title: 'Alpha note', content: 'alpha body' })).note;
  const b = (await api('POST', '/api/notes', { title: 'Beta note', content: 'beta body' })).note;
  await page.goto(base + '/notes');
  const row = (t) => page.locator('.nl-row', { hasText: t }).first();
  const tab = (t) => page.getByRole('tab', { name: t, exact: true });

  await row('Alpha note').waitFor({ timeout: 15000 });
  await row('Alpha note').click();
  await page.waitForURL(new RegExp('/notes/' + a.id), { timeout: 8000 });
  check('open a note from All', true);

  // delete -> trash -> restore -> reopen (PEB-70 main steps)
  await row('Alpha note').hover();
  await row('Alpha note').getByLabel('Move note to Trash').click({ force: true });
  await page.waitForTimeout(800);
  await tab('Trash').click();
  await row('Alpha note').waitFor({ timeout: 8000 });
  check('deleted note is in Trash', true);
  await row('Alpha note').click();
  await page.waitForURL(new RegExp('/notes/' + a.id), { timeout: 8000 });
  check('a note in Trash can be opened', await page.getByText('This note is in the Trash').isVisible().catch(() => false));
  await row('Alpha note').getByLabel('Restore note').click({ force: true });
  await page.waitForTimeout(800);
  await tab('All').click();
  await row('Alpha note').waitFor({ timeout: 8000 }).catch(() => {});
  check('restored note is back in All', await row('Alpha note').isVisible());
  await row('Alpha note').click();
  await page.waitForURL(new RegExp('/notes/' + a.id), { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(800);
  check('restored note opens again in the same session', page.url().includes(a.id) && (await page.locator('.nl-row.active', { hasText: 'Alpha note' }).count()) === 1, page.url());

  // archive -> Archive tab -> open -> unarchive -> back in All -> open
  await row('Beta note').hover();
  await row('Beta note').getByLabel('Archive note').click({ force: true });
  await page.waitForTimeout(800);
  await tab('Archive').click();
  await row('Beta note').waitFor({ timeout: 8000 }).catch(() => {});
  check('archived note is in Archive', await row('Beta note').isVisible());
  await row('Beta note').click();
  await page.waitForTimeout(800);
  check('an archived note can be opened', page.url().includes(b.id), page.url());
  await row('Beta note').getByLabel('Unarchive note').click({ force: true });
  await page.waitForTimeout(800);
  await tab('All').click();
  await row('Beta note').waitFor({ timeout: 8000 }).catch(() => {});
  check('unarchived note is back in All', await row('Beta note').isVisible());
  await row('Beta note').click();
  await page.waitForTimeout(800);
  check('unarchived note opens again', page.url().includes(b.id), page.url());
} catch (e) { console.error(e); process.exitCode = 1; }
await finish();

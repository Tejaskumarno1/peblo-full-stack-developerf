// PEB-25: Settings > Delete account removes the account and everything in it, after a password and a tick.
import { boot } from './lib.mjs';

const { base, api, page, check, finish, token } = await boot();
try {
  await api('POST', '/api/notes', { title: 'Soon gone', content: 'bye' });
  await page.goto(base + '/notes');
  await page.locator('.nl-row', { hasText: 'Soon gone' }).first().waitFor({ timeout: 15000 });
  await page.evaluate(() => window.dispatchEvent(new Event('peblo:open-settings')));
  await page.locator('.settings-hub-container').waitFor({ timeout: 10000 });
  await page.locator('.settings-tab-btn', { hasText: 'Data' }).first().click();
  await page.locator('#del-submit').scrollIntoViewIfNeeded();

  check('the delete button is off until there is a password and a tick', await page.locator('#del-submit').isDisabled());
  await page.locator('#del-password').fill('wrong password here');
  check('..still off with only a password', await page.locator('#del-submit').isDisabled());
  await page.locator('#del-sure').check();
  check('..on once both are there', await page.locator('#del-submit').isEnabled());

  await page.locator('#del-submit').click();
  await page.getByRole('alert').filter({ hasText: 'not correct' }).waitFor({ timeout: 8000 }).catch(() => {});
  check('a wrong password shows a message', (await page.getByRole('alert').filter({ hasText: 'not correct' }).count()) === 1);
  const still = await api('GET', '/api/notes');
  check('..and nothing was deleted', (still.notes || []).some((n) => n.title === 'Soon gone'));

  await page.locator('#del-password').fill('correct horse battery');
  await page.locator('#del-submit').click();
  await page.waitForFunction(() => !localStorage.getItem('peblo-token'), null, { timeout: 15000 }).catch(() => {});
  check('this device is signed out', await page.evaluate(() => !localStorage.getItem('peblo-token')));
  await page.waitForSelector('input[type="password"]', { timeout: 10000 }).catch(() => {});
  check('the sign-in screen is shown', (await page.locator('input[type="password"]').count()) >= 1);
  const gone = await fetch(base + '/api/notes', { headers: { Authorization: `Bearer ${token}` } });
  check('the old token no longer works', gone.status === 401, gone.status);
} catch (e) { console.error(e); check('script ran to the end', false, e.message); }
await finish();

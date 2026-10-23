// PEB-82: settings do what they say; one AI routing choice everywhere; real save errors.
import { boot } from './lib.mjs';
const { base, api, page, check, finish } = await boot();
const openSettings = async (tab) => {
  await page.evaluate(() => window.dispatchEvent(new Event('peblo:open-settings')));
  await page.locator('.settings-hub-container').waitFor({ timeout: 10000 });
  if (tab) await page.locator('.settings-tab-btn', { hasText: tab }).first().click();
};
const closeSettings = async () => { await page.locator('.settings-hub-close').click(); await page.waitForTimeout(300); };
const routingNow = async () => (await api('GET', '/api/ai/hub/models')).routing;
try {
  await api('POST', '/api/notes', { title: 'Font note', content: 'Some text to size' });
  await page.goto(base + '/notes');
  await page.locator('.nl-row', { hasText: 'Font note' }).first().click();
  await page.locator('.bn-editor').first().waitFor({ timeout: 15000 });

  // dead settings are gone
  await openSettings('Preferences');
  const prefText = await page.locator('.settings-hub-content').innerText();
  check('no Note Language / Auto-save / Word Wrap / Auto-suggest settings', !/Note Language|Auto-save Interval|Word Wrap|Auto-suggest/i.test(prefText));
  check('no Notifications tab', (await page.locator('.settings-tab-btn', { hasText: 'Notifications' }).count()) === 0);

  // editor font size works
  const fs = async () => page.evaluate(() => getComputedStyle(document.querySelector('.bn-editor .bn-inline-content') || document.querySelector('.bn-editor')).fontSize);
  await page.locator('#pref-font').selectOption('large');
  await page.waitForTimeout(300);
  check('Large makes the editor text 18px', (await fs()) === '18px', await fs());
  await page.locator('#pref-font').selectOption('small');
  await page.waitForTimeout(300);
  check('Small makes it 13px', (await fs()) === '13px', await fs());
  await page.locator('#pref-font').selectOption('medium');
  await closeSettings();

  // routing: one list, same answer in Settings and Your AI
  await api('PUT', '/api/profile', { settings: { defaultAiModel: 'ask' } });
  await page.goto(base + '/ai/connections');
  await page.waitForTimeout(1200);
  check('Your AI shows "Ask first" chosen', await page.locator('.cx-route.on', { hasText: /Ask/ }).count() === 1);
  await openSettings('AI Providers');
  check('Settings shows "Ask me first" chosen', await page.getByRole('radio', { name: /Ask me first/ }).isChecked());
  check('Settings offers exactly the 3 shared choices', (await page.locator('input[name="settings-routing"]').count()) === 3);
  // saving keys must not overwrite the choice
  await page.getByRole('button', { name: 'Save AI Settings' }).click();
  await page.waitForTimeout(800);
  check('saving AI settings leaves the routing as it was', (await routingNow()) === 'ask', await routingNow());
  await closeSettings();
  // old accounts holding "openai" show "Best available", not a blank
  await api('PUT', '/api/profile', { settings: { defaultAiModel: 'openai' } });
  await page.goto(base + '/ai/connections');
  await page.waitForTimeout(1200);
  check('legacy "openai" shows Best available chosen', await page.locator('.cx-route.on', { hasText: /Best available/ }).count() === 1);

  // profile save: failure is reported and the name goes back
  await page.goto(base + '/notes');
  await page.waitForTimeout(800);
  await page.route('**/api/profile', (r) => (r.request().method() === 'PUT' ? r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"down"}' }) : r.continue()));
  await openSettings('Profile');
  const nameBox = page.locator('form input[required]').first();
  const before = await nameBox.inputValue();
  await nameBox.fill('Broken Save Name');
  await page.getByRole('button', { name: 'Save Profile Changes' }).click();
  await page.waitForTimeout(800);
  check('failed profile save shows an error, not "saved"', (await page.getByText(/Could not save your profile/).count()) === 1 && (await page.getByText('Profile saved successfully!').count()) === 0);
  const me = await api('GET', '/api/profile');
  check('the server name was not changed', (me.user?.name || me.name) === before, JSON.stringify(me).slice(0, 80));
  await page.unroute('**/api/profile');
} catch (e) { console.error(e); process.exitCode = 1; }
await finish();

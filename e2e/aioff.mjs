// PEB-106: Settings > AI Providers > "Turn off all AI" is saved on the account and every AI surface says AI is off.
import { boot } from './lib.mjs';

const { base, api, page, check, finish } = await boot();
const openSettings = async (tab) => {
  await page.evaluate(() => window.dispatchEvent(new Event('peblo:open-settings')));
  await page.locator('.settings-hub-container').waitFor({ timeout: 10000 });
  if (tab) await page.locator('.settings-tab-btn', { hasText: tab }).first().click();
};
const closeSettings = async () => { await page.locator('.settings-hub-close').click(); await page.waitForTimeout(300); };
try {
  await api('POST', '/api/notes', { title: 'A note', content: 'text' });
  await page.goto(base + '/notes');
  await page.waitForTimeout(3000);

  await openSettings('AI Providers');
  const off = page.locator('#pref-ai-off');
  await off.waitFor({ timeout: 5000 });
  check('"Turn off all AI" starts unchecked', !(await off.isChecked()));
  await off.check();
  await page.waitForTimeout(800);
  let me = (await api('GET', '/api/profile')).user;
  check('ticking it is saved on the account', me.settings.aiOff === true, JSON.stringify(me.settings));

  await closeSettings();
  await page.reload();
  await page.waitForTimeout(3000);

  const hub = await fetch(base + '/api/ai/hub/chat', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await page.evaluate(() => localStorage.getItem('peblo-token'))}` }, body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }) });
  check('the server refuses AI whatever the page does (403)', hub.status === 403, hub.status);

  await openSettings('Preferences');
  await closeSettings();

  await openSettings('AI Providers');
  check('the box is still ticked after a reload', await page.locator('#pref-ai-off').isChecked());
  await page.locator('#pref-ai-off').uncheck();
  await page.waitForTimeout(800);
  me = (await api('GET', '/api/profile')).user;
  check('unticking turns AI back on', me.settings.aiOff === false, JSON.stringify(me.settings));
  const hub2 = await fetch(base + '/api/ai/hub/models', { headers: { Authorization: `Bearer ${await page.evaluate(() => localStorage.getItem('peblo-token'))}` } });
  check('..and the model list no longer says it is off', (await hub2.json()).aiOff === false);
} catch (e) { console.error(e); check('script ran to the end', false, e.message); }
await finish();

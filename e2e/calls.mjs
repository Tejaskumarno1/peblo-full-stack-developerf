// PEB-81: the AI voice call. "Call me now" works, a snoozed call comes back with the same agenda,
// all-day tasks are read as "today", and a setting turns calls off.
import { boot } from './lib.mjs';
const { base, api, ctx, page, check, finish } = await boot();
const openSettings = async (tab) => {
  await page.evaluate(() => window.dispatchEvent(new Event('peblo:open-settings')));
  await page.locator('.settings-hub-container').waitFor({ timeout: 10000 });
  if (tab) await page.locator('.settings-tab-btn', { hasText: tab }).first().click();
};
try {
  // keep the morning briefing out of the way so only the manual call is tested
  await ctx.addInitScript((d) => { try { localStorage.setItem('peblo_last_morning_briefing', d); } catch {} }, new Date().toDateString());
  const today = new Date();
  const allDay = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59).toISOString();
  await api('POST', '/api/todos', { text: 'Call dentist', deadline: new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 0).toISOString() });
  await api('POST', '/api/todos', { text: 'Pay rent', deadline: allDay });

  await page.clock.install();
  await page.goto(base + '/tasks');
  await page.waitForTimeout(1500);
  check('no call rings on its own for a new task and an all-day task', (await page.locator('.ai-call-overlay').count()) === 0);

  await openSettings('Preferences');
  check('"AI voice calls" is on by default', await page.locator('#pref-calls').isChecked());
  await page.locator('#call-me-now').click();
  await page.locator('.ai-call-overlay').waitFor({ timeout: 10000 });
  check('"Call me now" starts a call', (await page.locator('.ai-call-overlay').count()) === 1);
  check('no debug hook is left on window', await page.evaluate(() => typeof window.__simulateVoiceCommand === 'undefined'));

  // snooze, wait, and the call comes back with the same list
  await page.getByRole('button', { name: 'Snooze' }).click();
  await page.waitForTimeout(300);
  check('snooze hides the call', (await page.locator('.ai-call-overlay').count()) === 0);
  await page.clock.fastForward('10:05');
  await page.locator('.ai-call-overlay').waitFor({ timeout: 10000 });
  check('the call comes back after the snooze', (await page.locator('.ai-call-overlay').count()) === 1);
  await page.locator('.call-btn.answer').click();
  await page.locator('.ai-call-task-item').first().waitFor({ timeout: 10000 });
  const rows = await page.locator('.ai-call-task-item').allInnerTexts();
  check('the snoozed call still has the agenda (2 tasks)', rows.length === 2, JSON.stringify(rows));
  const rent = rows.find((r) => /Pay rent/.test(r)) || '';
  check('an all-day task is shown as "today", not 11:59 PM', /today/i.test(rent) && !/11:59|23:59/.test(rent), rent);
  await page.locator('.call-btn.decline').click();
  await page.waitForTimeout(300);

  // turn calls off
  await openSettings('Preferences');
  await page.locator('#pref-calls').uncheck();
  await page.waitForTimeout(500);
  const me = await api('GET', '/api/profile');
  check('the setting is saved on the account', (me.user?.settings || me.settings)?.voiceCalls === false, JSON.stringify(me).slice(0, 120));
  check('"Call me now" is disabled while calls are off', await page.locator('#call-me-now').isDisabled());
  await page.locator('.settings-hub-close').click();
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('snooze_ai_call', { detail: { minutes: 1 } })));
  await page.clock.fastForward('02:00');
  await page.waitForTimeout(300);
  check('a call waiting to come back is cancelled when calls are off', (await page.locator('.ai-call-overlay').count()) === 0);
} catch (e) { console.error(e); check('script ran to the end', false, e.message); }
await finish();

// PEB-90: week start and UI style are account settings, used the same way everywhere.
import { boot } from './lib.mjs';
const { base, api, page, ctx, token, check, finish } = await boot();
const firstDow = async (url, sel) => {
  await page.goto(base + url);
  await page.locator(sel).first().waitFor({ timeout: 15000 });
  return (await page.locator(sel).first().innerText()).trim().toLowerCase();
};
try {
  // Week start: Tasks week strip and the Calendar grid follow the account setting
  await api('PUT', '/api/profile', { settings: { weekStart: 'sun' } });
  check('Tasks week starts on Sunday', (await firstDow('/tasks', '.tasks-day .dow')).startsWith('sun'));
  const calFirst = async () => {
    await page.goto(base + '/calendar');
    await page.locator('.cal-grid').first().waitFor({ timeout: 15000 });
    return (await page.locator('.cal-grid').first().innerText()).trim().slice(0, 3).toLowerCase();
  };
  check('Calendar grid starts on Sunday', (await calFirst()) === 'sun');
  await api('PUT', '/api/profile', { settings: { weekStart: 'mon' } });
  await page.evaluate(() => localStorage.removeItem('peblo-settings'));
  check('Tasks week starts on Monday', (await firstDow('/tasks', '.tasks-day .dow')).startsWith('mon'));
  check('Calendar grid starts on Monday', (await calFirst()) === 'mon');

  // Soft calendar follows too
  await page.evaluate(() => localStorage.setItem('peblo-style', 'soft'));
  await api('PUT', '/api/profile', { settings: { weekStart: 'sun', uiStyle: 'soft' } });
  await page.evaluate(() => localStorage.removeItem('peblo-settings'));
  await page.goto(base + '/calendar');
  await page.locator('.s-mini-dow').first().waitFor({ timeout: 15000 });
  const miniSun = await page.locator('.s-mini-dow span').allInnerTexts();
  check('Soft mini calendar header starts with Sunday (S M T W T F S)', miniSun.join('') === 'SMTWTFS');
  await api('PUT', '/api/profile', { settings: { weekStart: 'mon' } });
  await page.evaluate(() => localStorage.removeItem('peblo-settings'));
  await page.goto(base + '/calendar');
  await page.locator('.s-mini-dow').first().waitFor({ timeout: 15000 });
  const miniMon = await page.locator('.s-mini-dow span').allInnerTexts();
  check('Soft mini calendar header starts with Monday (M T W T F S S)', miniMon.join('') === 'MTWTFSS');

  // Style follows the account onto a device that has never chosen one
  await api('PUT', '/api/profile', { settings: { uiStyle: 'river' } });
  const fresh = await ctx.browser().newContext({ viewport: { width: 1440, height: 900 } });
  await fresh.addInitScript((t) => { try { if (!localStorage.getItem('peblo-token')) localStorage.setItem('peblo-token', t); } catch {} }, token);
  const p2 = await fresh.newPage();
  await p2.goto(base + '/tasks');
  await p2.waitForTimeout(1500);
  check('a new device opens in the account style (river)', (await p2.evaluate(() => document.documentElement.getAttribute('data-style'))) === 'river');

  // Choosing a style in Settings is saved to the account
  await p2.evaluate(() => window.dispatchEvent(new Event('peblo:open-settings')));
  await p2.locator('.settings-hub-container').waitFor({ timeout: 10000 });
  const tabs = p2.locator('.settings-tab-btn');
  for (let i = 0; i < await tabs.count(); i++) {
    if (await p2.locator('.style-card').count()) break;
    await tabs.nth(i).click();
    await p2.waitForTimeout(200);
  }
  await p2.locator('.style-card', { hasText: /orbit/i }).first().click();
  await p2.waitForTimeout(1000);
  const me = await api('GET', '/api/profile');
  const saved = (me.user || me).settings?.uiStyle;
  check('picking Orbit in Settings saves it to the account', saved === 'orbit', String(saved));
  await fresh.close();
} catch (e) { console.error(e); process.exitCode = 1; }
await finish();

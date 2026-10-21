// River and Orbit show the same Connect apps section (address, test, activity) in the classic Settings window.
import { boot } from './lib.mjs';
const { base, api, page, check, finish } = await boot();
try {
  for (const style of ['river', 'orbit']) {
    await api('PUT', '/api/profile', { settings: { uiStyle: style } });
    await page.evaluate((s) => localStorage.setItem('peblo-style', s), style).catch(() => {});
    await page.goto(base + '/');
    await page.waitForTimeout(1200);
    await page.evaluate((s) => { localStorage.setItem('peblo-style', s); window.dispatchEvent(new Event('peblo:open-settings')); }, style);
    await page.locator('.settings-hub-container').waitFor({ timeout: 10000 });
    await page.locator('.settings-tab-btn', { hasText: /Data|Security|Account/ }).first().click().catch(() => {});
    const addr = page.locator('.s-set-addr code');
    await addr.waitFor({ timeout: 10000 });
    check(`${style}: Connect section shows the public MCP address`, (await addr.innerText()) === `${base}/mcp`);
    await page.getByRole('button', { name: 'Test the connection' }).click();
    await page.locator('.s-set-checks li.ok').nth(2).waitFor({ timeout: 15000 });
    check(`${style}: test passes`, (await page.locator('.s-set-checks li.bad').count()) === 0);
    await addr.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `C:/Users/tejas/peblo-e2e/connect-${style}.png` });
    await page.locator('.settings-hub-close').click();
  }
} catch (e) { check('river/orbit connect ran', false, e.stack || e.message); }
await finish();

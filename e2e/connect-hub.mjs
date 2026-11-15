// Connect page: three columns, app steps with marks, test connection, connected apps, disconnect all, See all.
import { boot } from './lib.mjs';

const { base, api, page, check, finish } = await boot();
try {
  await page.setViewportSize({ width: 1440, height: 900 });
  await api('POST', '/api/tokens', { name: 'Connected: Claude', scope: 'write' });
  await api('POST', '/api/tokens', { name: 'Connected: Cursor', scope: 'read' });
  await page.goto(base + '/ai/connections');
  await page.locator('[data-col=agents]').waitFor({ timeout: 15000 });
  check('three columns are on the page', (await page.locator('.s-hub-col').count()) === 3);
  const box = await page.locator('.s-hub').boundingBox();
  check('the columns use the full width', box.width > 1250, String(Math.round(box.width)));
  check('the stale "Coming next" card is gone', (await page.getByText('Coming next').count()) === 0);
  check('the Peblo address is shown with Copy', /\/mcp$/.test((await page.locator('[data-col=agents] code').first().innerText()).trim()) && (await page.locator('[data-col=agents]').getByRole('button', { name: /^Copy/ }).count()) >= 1);

  // App steps
  const tabs = await page.locator('.s-hub-clients button').allInnerTexts();
  check('four apps to pick from', tabs.length === 4 && /Claude/.test(tabs[0]) && /Cursor/.test(tabs[1]) && /VS Code/.test(tabs[2]) && /ChatGPT/.test(tabs[3]), tabs.join(','));
  await page.locator('.s-hub-clients button', { hasText: 'Cursor' }).click();
  check('picking Cursor shows Cursor steps', /In Cursor/.test(await page.locator('.s-hub-steps').innerText()));

  // Test connection runs and lists its three checks
  await page.getByRole('button', { name: 'Test the connection' }).click();
  await page.locator('.s-set-checks li').first().waitFor({ timeout: 90000 });
  await page.waitForFunction(() => document.querySelectorAll('.s-set-checks li').length === 3, null, { timeout: 90000 });
  check('test connection lists three checks', (await page.locator('.s-set-checks li').count()) === 3);
  await page.screenshot({ path: 'hub-test.png' });

  // Connected apps with marks
  const apps = await page.locator('.s-set-accts li').allInnerTexts();
  check('both connected apps are listed', apps.length === 2 && apps.some((a) => /Claude/.test(a)) && apps.some((a) => /Cursor/.test(a)), apps.join(' | ').replace(/\n/g, ' '));
  await page.screenshot({ path: 'hub-page.png' });
  await page.getByRole('button', { name: 'Disconnect all' }).click();
  await page.getByRole('button', { name: /Yes|Remove|Confirm/i }).first().click();
  await page.waitForTimeout(900);
  check('Disconnect all removes them', (await page.locator('.s-set-accts li').count()) === 0);

  // See all
  await page.goto(base + '/ai/connections?view=activity');
  await page.locator('[data-view=activity-all]').waitFor({ timeout: 10000 });
  check('See all shows the full log page with filters', (await page.getByRole('button', { name: 'Failed' }).count()) === 1 && (await page.getByRole('button', { name: 'Back to Connect' }).count()) === 1);
  await page.screenshot({ path: 'hub-seeall.png' });
  await page.getByRole('button', { name: 'Back to Connect' }).click();
  await page.locator('[data-col=agents]').waitFor({ timeout: 10000 });
  check('Back returns to Connect', !page.url().includes('view=activity'));

  // Settings still shows the single-column Connect apps
  await page.goto(base + '/settings');
  check('Settings still loads', (await page.locator('body').innerText()).length > 50);
} catch (e) {
  check('no crash', false, String(e).slice(0, 300));
}
await finish();

import { boot } from './lib.mjs';
const { base, api, page, ctx, check, finish } = await boot();
try {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(base + '/settings/appearance');
  await page.locator('text=Accessibility').first().waitFor({ timeout: 15000 });
  await page.locator('[aria-label="Text size"] >> text=XL').last().click();
  check('text size XL zooms the app', (await page.evaluate(() => getComputedStyle(document.documentElement).zoom)) == 1.25);
  await page.locator('[aria-label="Reduce motion"]').first().click();
  check('reduce motion sets the flag', await page.evaluate(() => document.documentElement.hasAttribute('data-a11y-motion')));
  await page.locator('[aria-label="Visible focus ring"]').first().click();
  check('focus ring flag set', await page.evaluate(() => document.documentElement.hasAttribute('data-a11y-focus')));
  await page.screenshot({ path: 'D:/Peblo/_shots/a11y.png' });
  await page.reload();
  await page.locator('text=Accessibility').first().waitFor();
  const st = await page.evaluate(() => ({ z: getComputedStyle(document.documentElement).zoom, m: document.documentElement.hasAttribute('data-a11y-motion'), ls: localStorage.getItem('peblo-a11y') }));
  check('choices survive a reload', st.z == 1.25 && st.m, JSON.stringify(st));
  await page.locator('[aria-label="Text size"] >> text=M').last().click();
  await page.context().setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await page.locator('[data-testid="offline-bar"]').waitFor({ timeout: 5000 });
  check('offline bar appears', /offline/i.test(await page.locator('[data-testid="offline-bar"]').innerText()));
  await page.screenshot({ path: 'D:/Peblo/_shots/offline.png' });
  await page.context().setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  check('bar says back online', /back online/i.test(await page.locator('[data-testid="offline-bar"]').innerText()));
  await page.locator('[data-testid="offline-bar"]').waitFor({ state: 'detached', timeout: 6000 });
  check('bar clears itself', true);
} catch (e) { check('no crash', false, String(e).slice(0, 300)); }
await finish();



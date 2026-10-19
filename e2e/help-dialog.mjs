// PEB-167/171: Help dialog (shortcuts, what's new, feedback) in every style; ? key, palette, Orbit tour link.
import { boot } from './lib.mjs';
const { base, page, check, finish } = await boot();
const go = async (style, path = '/tasks') => {
  await page.goto(base + '/tasks');
  await page.evaluate((s) => { localStorage.setItem('peblo-style', s); localStorage.setItem('peblo-orbit-help-seen', '1'); }, style);
  await page.goto(base + path);
  await page.waitForTimeout(1000);
};
const dlg = () => page.getByRole('dialog', { name: 'Help' });
try {
  for (const s of ['studio', 'console', 'soft', 'river', 'orbit']) {
    await go(s);
    await page.locator('body').click({ position: { x: 3, y: 3 } }).catch(() => {});
    await page.keyboard.press('?');
    await page.waitForTimeout(400);
    check(`${s}: ? opens Help`, await dlg().isVisible().catch(() => false));
    check(`${s}: it lists the command palette shortcut`, /Command palette/.test(await dlg().innerText().catch(() => '')));
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    check(`${s}: Escape closes it`, (await page.getByRole('dialog', { name: 'Help' }).count()) === 0);
  }

  // Not while typing
  await go('studio', '/tasks');
  const input = page.locator('input[type="text"], input:not([type]), textarea').first();
  if (await input.count()) {
    await input.click();
    await page.keyboard.type('what?');
    check('typing ? in a box does not open Help', (await page.getByRole('dialog', { name: 'Help' }).count()) === 0);
  }

  // Tabs
  await go('studio');
  await page.locator('body').click({ position: { x: 3, y: 3 } }).catch(() => {});
  await page.keyboard.press('?');
  await dlg().getByRole('tab', { name: "What's new" }).click();
  check("What's new tab shows entries", (await dlg().locator('.pb-help-news li').count()) > 0);
  await dlg().getByRole('tab', { name: 'Send feedback' }).click();
  const href = await dlg().getByRole('link', { name: /feedback page/ }).getAttribute('href');
  check('feedback opens a GitHub new-issue page', /github\.com\/.*\/issues\/new/.test(href || ''), href);
  await page.keyboard.press('Escape');

  // Command palette entry
  await page.keyboard.press('Control+k');
  await page.getByPlaceholder('Search notes or type a command...').fill('help');
  await page.waitForTimeout(300);
  await page.getByText('Help and shortcuts', { exact: true }).first().click();
  await page.waitForTimeout(400);
  check('palette "Help and shortcuts" opens Help', await dlg().isVisible().catch(() => false));
  await page.keyboard.press('Escape');

  // Account menu + tour in Orbit
  await go('orbit', '/tasks');
  await page.getByRole('button', { name: 'Your menu' }).click();
  await page.getByRole('menuitem', { name: 'Help and shortcuts' }).click();
  check('Orbit account menu opens Help', await dlg().isVisible());
  await dlg().getByRole('button', { name: 'Take the map tour' }).click();
  await page.waitForTimeout(900);
  check('..and "Take the map tour" starts the map guide', await page.getByRole('dialog', { name: /./ }).first().innerText().then((t) => /STEP 1 OF 4/.test(t)).catch(() => false));
} catch (err) {
  check('script ran to the end', false, err.message);
}
await finish();

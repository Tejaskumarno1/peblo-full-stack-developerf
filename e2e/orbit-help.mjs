// PEB-147/148/150: Orbit map help: first-run hint, 4-step tour, skip, replay, ring colours explained.
import { boot } from './lib.mjs';
const { base, page, check, finish } = await boot();
try {
  await page.goto(base + '/tasks');
  await page.evaluate(() => { localStorage.setItem('peblo-style', 'orbit'); localStorage.removeItem('peblo-orbit-help-seen'); });
  await page.goto(base + '/');
  await page.waitForTimeout(1200);
  const hint = page.locator('.o-help-hint');
  check('first visit offers a tour (does not block the map)', await hint.isVisible());
  check('..and no dialog opened by itself', (await page.getByRole('dialog').count()) === 0);
  await hint.getByRole('button', { name: 'No thanks' }).click();
  await page.reload(); await page.waitForTimeout(1000);
  check('"No thanks" is remembered', (await page.locator('.o-help-hint').count()) === 0);

  const help = page.getByRole('button', { name: /Help: how the map works/ });
  await help.click();
  const dlg = page.getByRole('dialog');
  check('the ? button opens the guide', await dlg.isVisible());
  check('guide starts at step 1 of 4', (await dlg.innerText()).includes('STEP 1 OF 4'));
  for (let i = 2; i <= 4; i++) {
    await dlg.getByRole('button', { name: 'Next' }).click();
    check(`Next goes to step ${i}`, (await dlg.innerText()).includes(`STEP ${i} OF 4`));
    if (i === 3) {
      const t = await dlg.innerText();
      check('step 3 explains the ring colours', /Weak/.test(t) && /Getting there/.test(t) && /Strong/.test(t) && /Not quizzed/.test(t));
    }
  }
  check('step 4 explains the revision path', /revision path/i.test(await dlg.innerText()));
  await dlg.getByRole('button', { name: 'Back' }).click();
  check('Back goes back a step', (await dlg.innerText()).includes('STEP 3 OF 4'));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  check('Escape closes the guide', (await page.getByRole('dialog').count()) === 0);

  await help.click();
  await page.getByRole('dialog').getByRole('button', { name: 'Skip' }).click();
  check('Skip closes it too', (await page.getByRole('dialog').count()) === 0);
  await help.click();
  check('it can be replayed from step 1', (await page.getByRole('dialog').innerText()).includes('STEP 1 OF 4'));
} catch (err) {
  check('script ran to the end', false, err.message);
}
await finish();

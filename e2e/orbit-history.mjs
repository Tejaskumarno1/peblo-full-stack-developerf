// PEB-190 version history panel, PEB-189 editor hint, PEB-255 Alt+Left/Right in Orbit.
import { boot } from './lib.mjs';

const { base, api, page, check, finish } = await boot();
try {
  const first = 'Alpha line one.\n\nBeta line two that will disappear.\n\nGamma stays.';
  const n = (await api('POST', '/api/notes', { title: 'History demo', content: first })).note;
  await api('PATCH', `/api/notes/${n.id}`, { content: 'Alpha line one.\n\nGamma stays.\n\nDelta is new and written later, with enough words to count as a real change to the note.' });
  const list = (await api('GET', `/api/notes/${n.id}/backups`)).backups || [];
  check('the API kept an earlier version', list.length >= 1, JSON.stringify(list));

  await page.goto(base + '/');
  await page.evaluate(() => localStorage.setItem('peblo-style', 'orbit'));
  await page.goto(base + `/notes/${n.id}`);
  await page.locator('.bn-editor').waitFor({ timeout: 12000 });
  check('the editor tells you about / and @', /for commands/.test(await page.locator('.o-sheet').textContent()));

  await page.getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitem', { name: 'Version history' }).click();
  const dlg = page.getByTestId('version-history');
  await dlg.waitFor({ timeout: 6000 });
  await dlg.locator('ul[aria-label="Saved versions"] li button').first().waitFor({ timeout: 6000 }).catch(() => {});
  check('the panel lists the saved versions', (await dlg.locator('ul[aria-label="Saved versions"] li button').count()) >= 1);
  await dlg.locator('ul[aria-label="Saved versions"] li button').first().click();
  await dlg.getByTestId('vh-text').waitFor({ timeout: 6000 });
  const shown = await dlg.getByTestId('vh-text').textContent();
  check('picking one shows its text', /Beta line two/.test(shown), shown);
  check('it says what differs from now', /would come back/.test(await dlg.getByTestId('vh-summary').textContent()));
  await dlg.getByRole('button', { name: /Restore this version/ }).click();
  await dlg.waitFor({ state: 'detached', timeout: 6000 }).catch(() => {});
  await page.waitForTimeout(1500);
  const after = (await api('GET', `/api/notes/${n.id}`)).note;
  check('restoring brings the old text back', /Beta line two/.test(after.content), after.content);
  check('the open editor shows the restored text', /Beta line two/.test(await page.locator('.bn-editor').textContent()));
  const kept = (await api('GET', `/api/notes/${n.id}/backups`)).backups || [];
  check('the text it replaced was kept, so the restore can be undone', kept.some((b) => /Delta is new/.test(b.preview || '')) || kept.length >= 2, JSON.stringify(kept.map((b) => b.preview)));

  // Back / forward with the keyboard
  await page.goto(base + '/');
  await page.waitForTimeout(1200);
  await page.goto(base + `/notes/${n.id}`);
  await page.waitForTimeout(1200);
  await page.locator('.o-sheet h1, .o-crumbs').first().click({ trial: true }).catch(() => {});
  await page.keyboard.press('Alt+ArrowLeft');
  await page.waitForTimeout(800);
  check('Alt+Left goes back', !page.url().includes('/notes/'), page.url());
  await page.keyboard.press('Alt+ArrowRight');
  await page.waitForTimeout(800);
  check('Alt+Right goes forward again', page.url().includes(`/notes/${n.id}`), page.url());
} catch (e) {
  check('test ran without throwing', false, e?.stack || e);
} finally {
  await finish();
}

// Notes batch 4: table of contents, copy as Markdown / link, empty Trash, words in the list row.
import { boot } from './lib.mjs';

const { base, api, page, check, finish } = await boot();
try {
  const long = Array.from({ length: 40 }, (_, i) => `word${i}`).join(' ');
  const n = (await api('POST', '/api/notes', { title: 'Batch four', content: `## Alpha\n\n${long}\n\n## Beta\n\nmore\n\nThe end.\n`, tags: ['b4'] })).note;
  const t1 = (await api('POST', '/api/notes', { title: 'Trash one', content: 'x', tags: ['b4'] })).note;
  const t2 = (await api('POST', '/api/notes', { title: 'Trash two', content: 'y', tags: ['b4'] })).note;
  await api('DELETE', `/api/notes/${t1.id}`); await api('DELETE', `/api/notes/${t2.id}`);

  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
  await page.goto(base + `/notes/${n.id}`);
  await page.locator('.bn-editor').waitFor({ timeout: 12000 });
  await page.waitForTimeout(1000);
  check('the list row shows the word count for longer notes', /4\d words/.test(await page.locator('.s-note-row.on').innerText()));

  await page.locator('.bn-inline-content', { hasText: 'The end.' }).click();
  await page.waitForTimeout(500);
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  await page.keyboard.type('/table of', { delay: 60 });
  await page.locator('.bn-suggestion-menu-item').first().waitFor({ timeout: 5000 }).catch(() => {});
  await page.keyboard.press('Enter');
  await page.waitForTimeout(800);
  const items = await page.locator('.bn-block-content[data-content-type="bulletListItem"]').allTextContents();
  check('the table of contents lists the headings', items.includes('Alpha') && items.includes('Beta'), items.join('|'));

  await page.getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitem', { name: 'Copy as Markdown' }).click();
  await page.waitForTimeout(500);
  const clip = await page.evaluate(() => navigator.clipboard.readText()).catch(() => '');
  check('Copy as Markdown puts the note on the clipboard', /# Batch four/.test(clip) && /## Alpha/.test(clip), clip.slice(0, 80));
  await page.getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitem', { name: 'Copy link to note' }).click();
  await page.waitForTimeout(400);
  check('Copy link puts the note address on the clipboard', (await page.evaluate(() => navigator.clipboard.readText()).catch(() => '')).endsWith(`/notes/${n.id}`));

  await page.goto(base + '/notes?filter=trash');
  await page.locator('.s-note-row').first().waitFor({ timeout: 12000 });
  await page.getByRole('button', { name: 'Empty', exact: true }).click();
  await page.waitForTimeout(1200);
  const left = (await api('GET', '/api/notes?deleted=true')).notes || [];
  check('Empty Trash deletes the notes for good', !left.some((x) => x.id === t1.id || x.id === t2.id), left.map((x) => x.title).join('|'));
} catch (e) { check('no crash', false, String(e).slice(0, 300)); }
await finish();

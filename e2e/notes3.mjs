// Notes batch 3: backlinks table, unlinked mentions, callouts, code copy, slash menu, folders, filters, bulk, tag manager.
import { boot, REPO } from './lib.mjs';
import path from 'path';

const { base, api, page, check, finish } = await boot();
const shot = (n) => page.screenshot({ path: path.join(REPO, '.shots', n + '.png') });
try {
  const target = (await api('POST', '/api/notes', { title: 'Zebra Project', content: 'The target note.', tags: ['b3'] })).note;
  const linker = (await api('POST', '/api/notes', { title: 'Linker', content: `See [Zebra Project](/notes/${target.id}) for more.`, tags: ['b3'] })).note;
  const mention = (await api('POST', '/api/notes', { title: 'Mentioner', content: 'I was talking about the zebra project yesterday, nothing linked.', tags: ['b3'] })).note;

  // server: backlinks come from note_links, mentions are separate
  let bl = await api('GET', `/api/notes/${target.id}/backlinks`);
  check('backlinks list the note that links to it', (bl.backlinks || []).some((n) => n.id === linker.id) && !(bl.backlinks || []).some((n) => n.id === mention.id), JSON.stringify(bl).slice(0, 200));
  let mn = await api('GET', `/api/notes/${target.id}/mentions`);
  check('unlinked mentions find the plain-text title', (mn.mentions || []).some((n) => n.id === mention.id && /zebra/i.test(n.snippet || '')) && !(mn.mentions || []).some((n) => n.id === linker.id), JSON.stringify(mn).slice(0, 200));
  await api('POST', `/api/notes/${mention.id}/mentions/${target.id}/link`).catch(() => {});
  // the link endpoint is called on the TARGET id with the mentioning note as :otherId
  await api('POST', `/api/notes/${target.id}/mentions/${mention.id}/link`);
  bl = await api('GET', `/api/notes/${target.id}/backlinks`);
  check('"Link it" turns the mention into a real link', (bl.backlinks || []).some((n) => n.id === mention.id));
  mn = await api('GET', `/api/notes/${target.id}/mentions`);
  check('the mention disappears once linked', !(mn.mentions || []).some((n) => n.id === mention.id));
  await api('PATCH', `/api/notes/${linker.id}`, { content: 'No link any more.' });
  bl = await api('GET', `/api/notes/${target.id}/backlinks`);
  check('removing a link removes the backlink', !(bl.backlinks || []).some((n) => n.id === linker.id));

  // editor: callouts, code copy, slash menu
  const doc = (await api('POST', '/api/notes', { title: 'Editor bits', content: '> 💡 A handy tip\n\n> ⚠️ Careful now\n\n```js\nconst x = 1;\n```\n\nThe end.\n', tags: ['b3'] })).note;
  await page.goto(base + `/notes/${doc.id}`);
  await page.locator('.bn-editor').waitFor({ timeout: 12000 });
  await page.waitForTimeout(1200);
  const co = await page.locator('[data-callout]').evaluateAll((els) => els.map((e) => e.getAttribute('data-callout')));
  check('quotes starting with a symbol become callouts', co.includes('tip') && co.includes('warn'), co.join(','));
  await shot('notes3-callouts');
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
  const cb = page.locator('.bn-block-content[data-content-type="codeBlock"]').first();
  await cb.evaluate((el) => el.scrollIntoView({ block: 'center' })); // away from the comments button pinned at the top right
  const box = await cb.boundingBox();
  await page.mouse.click(box.x + box.width - 30, box.y + 14);
  check('clicking Copy on a code block copies it and says so', await page.locator('.pb-notice', { hasText: 'Code copied' }).waitFor({ timeout: 1500 }).then(() => true, () => false));

  // slash menu extras
  await page.locator('.bn-inline-content', { hasText: 'The end.' }).click();
  await page.waitForTimeout(600);
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  await page.keyboard.type('/templ', { delay: 60 });
  await page.locator('.bn-suggestion-menu-item').first().waitFor({ timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(400);
  const slash = await page.locator('.bn-suggestion-menu-item').allTextContents();
  check('the slash menu offers templates', /Template: Meeting notes/.test(slash.join(' ')), slash.join(' ').slice(0, 200));
  await page.keyboard.press('Enter');
  await page.waitForTimeout(800);
  check('picking a template drops in a ready layout', /Agenda/.test(await page.locator('.bn-editor').innerText()));
  await page.keyboard.press('Escape');

  // list: folders, filters, bulk, tag manager
  await page.goto(base + `/notes/${target.id}`);
  await page.locator('.s-note-row').first().waitFor({ timeout: 12000 });
  await page.getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitem', { name: /Move to folder/ }).click();
  await page.getByRole('dialog', { name: 'Move to folder' }).getByRole('button', { name: /New folder/ }).click(); // the sheet lists folders; a new one is made in the New folder sheet and the note moves into it
  await page.getByRole('dialog', { name: 'New folder' }).getByLabel('Folder name').fill('Work');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1000);
  const meta = (await api('GET', `/api/notes/${target.id}`)).note.meta || {};
  check('moving a note to a folder saves it', meta.folder === 'Work', JSON.stringify(meta));
  await page.reload();
  await page.locator('.s-note-row').first().waitFor({ timeout: 12000 });
  await page.getByRole('tab', { name: /^Work/ }).click(); // folder chips replaced the old filter selects
  await page.waitForTimeout(400);
  const rows = await page.locator('.s-note-row .t').allTextContents();
  check('the folder filter shows only that folder', rows.length === 1 && /Zebra/.test(rows[0]), rows.join('|'));
  await page.getByRole('tab', { name: /^All/ }).click();
  await page.locator('.s-notes-foot').getByRole('button', { name: 'Pictures' }).click(); // the pictures gallery replaced the With pictures filter
  check('the pictures view shows only notes with pictures (none here)', await page.getByRole('dialog', { name: 'Pictures in your notes' }).getByText(/No pictures yet/).waitFor({ timeout: 4000 }).then(() => true, () => false));
  await page.getByRole('dialog', { name: 'Pictures in your notes' }).getByRole('button', { name: 'Close' }).click();

  await page.getByRole('button', { name: 'Select notes' }).click();
  await page.locator('.s-note-row', { hasText: 'Linker' }).click();
  check('select mode counts picked notes', /1 selected/.test(await page.locator('.np-selhead').innerText()));
  await page.getByRole('toolbar', { name: 'Bulk actions' }).getByRole('button', { name: 'Archive' }).click();
  await page.waitForTimeout(1000);
  const arch = (await api('GET', `/api/notes/${linker.id}`)).note;
  check('bulk archive archives the picked notes', arch.isArchived === true);

  await page.locator('.s-notes-foot').getByRole('button', { name: 'Tags', exact: true }).click();
  await page.waitForTimeout(600);
  check('the tag manager opens and lists tags', (await page.locator('.s-share', { hasText: 'b3' }).count()) > 0);
  await shot('notes3-tags');
} catch (e) { check('no crash', false, String(e).slice(0, 300)); await shot('notes3-fail').catch(() => {}); }
await finish();

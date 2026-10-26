// Notes panel redesign (mockups M1 to M5): folder chips, one View menu, select and move, New folder, smart folders, outside-click close.
import { boot } from './lib.mjs';

const { base, api, page, check, finish } = await boot();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await fn()) return true; } catch { /* retry */ } await wait(100); } return false; };
const list = page.locator('.s-notes-list.np');
try {
  const mk = async (title, tags, meta) => (await api('POST', '/api/notes', { title, content: `${title} body text`, tags, ...(meta ? { meta } : {}) })).note;
  const A = await mk('Alpha', ['orbit']);
  const B = await mk('Beta', ['peblo']);
  const C = await mk('Gamma', ['orbit']);
  const D = await mk('Delta', ['inbox']);
  await page.goto(base + '/notes'); await list.waitFor({ timeout: 20000 });
  await page.locator('.s-note-row').first().waitFor();

  // ---- home (M1)
  check('1 header has Select and New note buttons', (await list.getByRole('button', { name: 'Select notes' }).count()) === 1 && (await list.getByRole('button', { name: 'New note' }).count()) === 1);
  check('2 search and one View button', (await list.getByLabel('Search notes').count()) === 1 && (await list.getByRole('button', { name: 'View' }).count()) === 1);
  check('3 chips: All 4, Inbox 1, and a + for new folder', (await list.getByRole('tab', { name: /^All 4/ }).count()) === 1 && (await list.getByRole('tab', { name: /^Inbox 1/ }).count()) === 1 && (await list.getByRole('button', { name: 'New folder' }).count()) === 1);
  check('4 footer: Archive, Trash, Tags, Pictures', (await Promise.all(['Archive', 'Trash', 'Tags', 'Pictures'].map((n) => list.locator('.s-notes-foot button', { hasText: n }).count()))).every((c) => c === 1));
  check('5 group label with a count (TODAY 4)', (await list.locator('.s-grp-h', { hasText: 'Today' }).locator('.cnt').innerText()) === '4');

  // ---- View menu (M2)
  await list.getByRole('button', { name: 'View' }).click();
  const pop = page.getByRole('dialog', { name: 'View options' });
  check('6 View menu shows sort, group, density and 4 switches', await pop.isVisible() && (await pop.getByRole('radio').count()) === 9 && (await pop.getByRole('switch').count()) === 4);
  check('7 summary chips show while View is open', await list.locator('.np-sum').isVisible());
  await pop.getByRole('radio', { name: 'Title' }).click();
  await pop.getByRole('radio', { name: 'Folder' }).click();
  await pop.getByRole('radio', { name: 'Compact' }).click();
  check('8 sort by title applies (Alpha first)', (await list.locator('.s-note-row .t').first().innerText()).includes('Alpha'));
  check('9 compact density hides previews', (await list.locator('.s-note-row .s').first().isVisible()) === false);
  await pop.getByRole('switch', { name: 'Show preview text' }).click();
  await list.locator('.np-dim').click({ position: { x: 20, y: 20 } });
  check('10 clicking outside closes the View menu', await until(async () => (await pop.count()) === 0));
  await list.getByRole('button', { name: 'View' }).click();
  await pop.getByText('Reset to default').click();
  await pop.getByRole('radio', { name: 'Cozy' }).waitFor();
  check('11 Reset restores Edited / Date / Cozy', (await pop.getByRole('radio', { name: 'Edited' }).getAttribute('aria-checked')) === 'true' && (await pop.getByRole('radio', { name: 'Date' }).getAttribute('aria-checked')) === 'true');
  await page.keyboard.press('Escape');

  // ---- New folder (M4)
  await list.getByRole('button', { name: 'New folder' }).click();
  const sheet = page.getByRole('dialog', { name: 'New folder' });
  check('12 New folder sheet: kind switch, name, colours, Inside, collect switch', await sheet.isVisible() && (await sheet.getByRole('radio', { name: 'Smart folder' }).count()) === 1 && (await sheet.getByRole('radio').filter({ hasNot: page.locator('span') }).count()) >= 6);
  await sheet.getByLabel('Folder name').fill('Orbit Work');
  check('13 collect switch counts tagged notes', (await sheet.innerText()).includes('2 notes already have this tag'));
  await sheet.getByRole('radio', { name: 'mint' }).click();
  await sheet.getByRole('button', { name: 'Create folder' }).click();
  check('14 the new folder chip appears, selected, with its 2 tagged notes', await until(async () => (await list.getByRole('tab', { name: /^Orbit Work 2/, selected: true }).count()) === 1));
  check('15 the list shows only Alpha and Gamma', (await list.locator('.s-note-row').count()) === 2);
  const prof = await api('GET', '/api/profile');
  check('16 the folder is saved on the account', Array.isArray(prof.user?.settings?.noteFolders) && prof.user.settings.noteFolders[0]?.name === 'Orbit Work' && prof.user.settings.noteFolders[0].color === 'mint', JSON.stringify(prof.user?.settings));
  await list.getByRole('tab', { name: /^All/ }).click();

  // ---- Select and move (M3)
  await list.getByRole('button', { name: 'Select notes' }).click();
  check('17 select mode shows Cancel, count, Select all and the action bar', (await list.getByText('0 selected').count()) === 1 && (await list.getByRole('button', { name: 'Select all' }).count()) === 1 && (await list.getByRole('toolbar', { name: 'Bulk actions' }).getByRole('button').count()) === 5);
  await list.locator('.s-note-row', { hasText: 'Beta' }).click();
  await list.locator('.s-note-row', { hasText: 'Delta' }).click();
  check('18 two selected', (await list.getByText('2 selected').count()) === 1);
  await list.getByRole('toolbar', { name: 'Bulk actions' }).getByRole('button', { name: 'Move' }).click();
  const mv = page.getByRole('dialog', { name: 'Move to folder' });
  check('19 move sheet titled "Move 2 notes to" lists the folder and New folder...', (await mv.innerText()).includes('Move 2 notes to') && (await mv.getByRole('radio', { name: 'Orbit Work' }).count()) === 1 && (await mv.getByText('New folder...').count()) === 1);
  await mv.getByRole('radio', { name: 'Orbit Work' }).click();
  await mv.getByRole('button', { name: 'Move to Orbit Work' }).click();
  const moved = await until(async () => ((await api('GET', `/api/notes/${B.id}`)).note?.meta?.folder === 'Orbit Work') && ((await api('GET', `/api/notes/${D.id}`)).note?.meta?.folder === 'Orbit Work'));
  check('20 both notes moved into the folder (saved on the server)', moved);
  check('21 select mode closed after moving', (await list.getByRole('button', { name: 'Select notes' }).count()) === 1);

  // tag, pin, archive, delete from the action bar
  await list.getByRole('button', { name: 'Select notes' }).click();
  await list.locator('.s-note-row', { hasText: 'Alpha' }).click();
  await list.getByRole('toolbar', { name: 'Bulk actions' }).getByRole('button', { name: 'Tag' }).click();
  const tg = page.getByRole('dialog', { name: 'Tag notes' });
  await tg.getByLabel('New tag').fill('urgent'); await tg.getByRole('button', { name: 'Add tag' }).click();
  check('22 Tag adds a tag to the selected note', await until(async () => ((await api('GET', `/api/notes/${A.id}`)).note?.tags || []).includes('urgent')));
  await list.getByRole('button', { name: 'Select notes' }).click();
  await list.locator('.s-note-row', { hasText: 'Alpha' }).click();
  await list.getByRole('toolbar', { name: 'Bulk actions' }).getByRole('button', { name: 'Pin' }).click();
  check('23 Pin pins it', await until(async () => (await api('GET', `/api/notes/${A.id}`)).note?.meta?.pinned === true));
  check('24 pinned notes get their own group', await until(async () => (await list.locator('.s-grp-h', { hasText: 'Pinned' }).count()) === 1));
  await list.getByRole('button', { name: 'Select notes' }).click();
  await list.locator('.s-note-row', { hasText: 'Gamma' }).click();
  await list.getByRole('toolbar', { name: 'Bulk actions' }).getByRole('button', { name: 'Archive' }).click();
  check('25 Archive archives', await until(async () => (await api('GET', `/api/notes/${C.id}`)).note?.isArchived === true));
  await list.getByRole('button', { name: 'Select notes' }).click();
  await list.locator('.s-note-row', { hasText: 'Delta' }).click();
  await list.getByRole('toolbar', { name: 'Bulk actions' }).getByRole('button', { name: 'Delete' }).click();
  check('26 Delete moves it to the Trash', await until(async () => (await api('GET', `/api/notes/${D.id}`)).note?.isDeleted === true));

  // ---- Smart folder (M5)
  await list.getByRole('button', { name: 'New folder' }).click();
  await page.getByRole('dialog', { name: 'New folder' }).getByRole('radio', { name: 'Smart folder' }).click();
  const sp = page.getByRole('dialog', { name: 'New smart folder' });
  check('27 smart folder page: back, kind switch, name, rule, Add a rule, preview, note, buttons', await sp.isVisible() && (await sp.getByRole('button', { name: 'Back' }).count()) === 1 && (await sp.getByText('Add a rule').count()) === 1 && (await sp.getByText('Preview').count()) === 1 && (await sp.getByText('holds no notes itself').count()) === 1);
  await sp.getByLabel('Smart folder name').fill('Urgent things');
  await sp.getByLabel('Rule value').selectOption('urgent');
  check('28 preview shows the 1 matching note', (await sp.innerText()).includes('1 note match'));
  await sp.getByText('Add a rule').click();
  check('29 a second rule joins with AND', (await sp.getByText('AND', { exact: true }).count()) === 1);
  await sp.getByLabel('Remove rule').last().click();
  await sp.getByRole('button', { name: 'Save smart folder' }).click();
  check('30 the smart chip appears with its count and filters the list', await until(async () => (await list.getByRole('tab', { name: /^Urgent things 1/, selected: true }).count()) === 1) && (await list.locator('.s-note-row').count()) === 1);

  // ---- edit and delete a folder, outside-click on the note menu
  await list.getByRole('tab', { name: /^Orbit Work/ }).dblclick();
  const ed = page.getByRole('dialog', { name: 'Edit folder' });
  await ed.getByLabel('Folder name').fill('Orbit Team');
  await ed.getByRole('button', { name: 'Save folder' }).click();
  check('31 renaming a folder renames it on its notes', await until(async () => (await api('GET', `/api/notes/${B.id}`)).note?.meta?.folder === 'Orbit Team'));
  await list.getByRole('tab', { name: /^All/ }).click();
  await list.locator('.s-note-row').first().click();
  await page.getByRole('button', { name: 'More' }).click();
  const menu = page.locator('.s-menu[role="menu"]').first();
  check('32 the ··· menu opens', await menu.isVisible());
  await page.locator('.s-note-title').click();
  check('33 clicking anywhere else closes the ··· menu', await until(async () => (await page.locator('.s-note-bar .s-menu').count()) === 0));
} catch (e) { check('script ran to the end', false, e.stack || e.message); }
await finish();

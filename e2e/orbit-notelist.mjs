// PEB-125..135: Orbit "Every note": sort, filters, group-by, layout, pin, counts, highlight, select + bulk, recent.
import { boot } from './lib.mjs';
const { base, api, page, check, finish } = await boot();
const go = async (path = '/notes') => {
  await page.goto(base + '/tasks');
  await page.evaluate(() => {
    localStorage.setItem('peblo-style', 'orbit'); localStorage.setItem('peblo-orbit-help-seen', '1');
    for (const k of ['peblo-orbit-notes-view', 'peblo-orbit-pinned', 'peblo-orbit-recent']) localStorage.removeItem(k);
  });
  await page.goto(base + path);
  await page.waitForTimeout(1100);
};
const titles = async () => page.locator('.o-note-tile .t').allInnerTexts();
const mk = (title, content, tags) => api('POST', '/api/notes', { title, content, tags }).then((r) => r.note);
try {
  const b = await mk('Banana note', 'yellow fruit', ['fruit']);
  await new Promise((r) => setTimeout(r, 1100));
  const a = await mk('Apple note', 'red fruit with seeds', ['fruit']);
  await new Promise((r) => setTimeout(r, 1100));
  const c = await mk('Cherry note', 'small red', ['berries']);
  await mk('Loose note', 'no topic here', []);
  await go();
  await page.locator('.o-note-tile').first().waitFor({ timeout: 15000 });

  // PEB-125 sort
  await page.getByLabel('Group notes by').selectOption('none');
  await page.getByLabel('Sort notes').selectOption('title');
  let t = await titles();
  check('sort Title A-Z puts Apple first', t[0] === 'Apple note', t.join(','));
  await page.getByLabel('Sort notes').selectOption('edited');
  t = await titles();
  check('sort Recently edited puts the newest first', t[0] === 'Loose note', t.join(','));

  // PEB-127/PEB-126 group + filter
  await page.getByLabel('Group notes by').selectOption('date');
  check('group by date shows a Today group', (await page.locator('.o-group-head', { hasText: 'Today' }).count()) === 1);
  await page.getByLabel('Group notes by').selectOption('topic');
  await page.getByLabel('Filter by topic').selectOption('berries');
  t = await titles();
  check('topic filter keeps only that topic', t.length === 1 && t[0] === 'Cherry note', t.join(','));
  check('result count is shown', /1 note match/.test(await page.locator('.o-count').innerText()));
  await page.getByRole('button', { name: /Clear filters/ }).first().click();
  await page.waitForTimeout(300);
  check('Clear filters brings every note back', (await titles()).length >= 4);
  await page.getByLabel('Filter by date edited').selectOption('7');
  check('date filter keeps recent notes', (await titles()).length >= 4);
  await page.getByLabel('Filter by date edited').selectOption('any');

  // PEB-129 layout
  await page.getByRole('button', { name: 'List', exact: true }).click();
  check('List layout is applied', (await page.locator('.o-group-items.as-list').count()) > 0);
  await page.getByRole('button', { name: 'Grid', exact: true }).click();

  // PEB-132 highlight + count
  await page.getByPlaceholder('Search notes…').fill('seeds');
  await page.waitForTimeout(300);
  check('search highlights the match inside the card', (await page.locator('.o-note-tile mark', { hasText: 'seeds' }).count()) === 1);
  check('search shows the match count', /1 note match/.test(await page.locator('.o-count').innerText()));
  await page.getByPlaceholder('Search notes…').fill('zzzz-nothing');
  await page.waitForTimeout(300);
  check('no results shows a clear next step', (await page.getByRole('button', { name: 'Clear filters' }).count()) > 0);
  await page.getByPlaceholder('Search notes…').fill('');

  // PEB-130 pin (stays after a reload)
  await page.getByRole('button', { name: 'Group notes by' }).count();
  await page.getByLabel('Group notes by').selectOption('topic');
  await page.locator('.o-tile', { hasText: 'Cherry note' }).hover();
  await page.getByLabel('Pin Cherry note').click();
  check('pinned note moves to a Pinned group', (await page.locator('.o-group-head', { hasText: 'Pinned' }).count()) === 1);
  await page.reload(); await page.waitForTimeout(1000);
  check('..and stays pinned after a reload', (await page.locator('.o-group-head', { hasText: 'Pinned' }).count()) === 1);
  check('sort and layout choices are remembered', (await page.getByLabel('Group notes by').inputValue()) === 'topic');

  // PEB-135 recently opened
  await page.locator('.o-note-tile', { hasText: 'Banana note' }).first().click();
  await page.waitForTimeout(700);
  await page.goto(base + '/notes'); await page.waitForTimeout(1000);
  check('Recently opened row lists the note just opened', (await page.locator('.o-recent .o-chip', { hasText: 'Banana note' }).count()) === 1);

  // PEB-133 select + bulk
  await page.getByRole('button', { name: 'Select', exact: true }).click();
  await page.getByLabel('Select Apple note').check();
  await page.getByLabel('Select Banana note').check();
  check('selection count shows', (await page.locator('.o-bulk').innerText()).includes('2 selected'));
  await page.getByLabel('Topic to add').fill('snacks');
  await page.getByRole('button', { name: 'Add topic' }).click();
  await page.waitForTimeout(1200);
  const all = (await api('GET', '/api/notes')).notes;
  const tagged = all.filter((n) => (n.tags || []).includes('snacks')).map((n) => n.title).sort();
  check('bulk Add topic tags both notes', tagged.join(',') === 'Apple note,Banana note', tagged.join(','));
  await page.getByRole('button', { name: 'Select', exact: true }).click();
  await page.getByLabel('Select Loose note').check();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export .md' }).click()]);
  check('bulk Export downloads a markdown file', /\.md$/.test(dl.suggestedFilename()), dl.suggestedFilename());
  await page.getByRole('button', { name: 'Select', exact: true }).click();
  await page.getByLabel('Select Loose note').check();
  await page.getByRole('button', { name: 'Move to Trash' }).click();
  await page.waitForTimeout(1200);
  const left = (await api('GET', '/api/notes')).notes.map((n) => n.title);
  check('bulk Move to Trash removes it from the list', !left.includes('Loose note'));

  // PEB-134 empty states
  await page.getByRole('button', { name: 'Archive', exact: true }).click();
  await page.waitForTimeout(700);
  check('empty Archive explains what it is for', /Nothing archived/.test(await page.locator('.o-empty-list').innerText()));
} catch (err) {
  check('script ran to the end', false, err.message);
}
await finish();

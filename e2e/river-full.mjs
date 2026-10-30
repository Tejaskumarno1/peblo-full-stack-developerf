// River, full pass: notes (create/edit/pin/archive/trash/restore/delete forever, bulk, search), tasks (add/done/undo/delete,
// repeating, bulk, search), river home (drawer, drag/drop, reminders, links), capture dialog, shortcuts while typing,
// forced API failures (500) and browser console errors.
// Run with: PEBLO_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55432/peblo_test_river node e2e/river-full.mjs
import { boot, REPO } from './lib.mjs';
import path from 'path';
import fs from 'fs';

process.env.PEBLO_TEST_DATABASE_URL ||= 'postgresql://postgres:postgres@127.0.0.1:55432/peblo_test_river';
process.env.STYLE = 'river';
const { base, api, page, check, finish } = await boot();
const shotDir = path.join(REPO, '.shots');
try { fs.mkdirSync(shotDir, { recursive: true }); } catch {}
const shot = (n) => page.screenshot({ path: path.join(shotDir, n + '.png') }).catch(() => {});

const pageErrors = [];
const consoleErrors = [];
const deletes = [];
page.on('pageerror', (e) => pageErrors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|Request failed with status code 500|Auto-save failed|Failed to (archive|delete|restore) note/.test(m.text())) consoleErrors.push(m.text()); });
page.on('request', (r) => { if (r.method() === 'DELETE' && /\/api\/notes\//.test(r.url())) deletes.push(r.url()); });

const until = async (fn, ms = 8000) => { const t = Date.now(); while (Date.now() - t < ms) { try { if (await fn()) return true; } catch {} await page.waitForTimeout(200); } return false; };
const sleep = (ms) => page.waitForTimeout(ms);
const eod = (n = 0) => { const d = new Date(); d.setDate(d.getDate() + n); d.setHours(23, 59, 0, 0); return d; };
const hhmm = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
const mkNote = async (title, extra = {}) => (await api('POST', '/api/notes', { title, content: 'body of ' + title, tags: [], ...extra })).note;
const getNote = async (id) => (await api('GET', '/api/notes/' + id)).note;
const todos = async () => (await api('GET', '/api/todos')).todos || [];
const byText = async (t) => (await todos()).filter((x) => x.text === t);
const goto = async (p) => { await page.goto(base + p); };
const failing = async (pattern, method, status = 500) => {
  const h = (route) => (route.request().method() === method ? route.fulfill({ status, contentType: 'application/json', body: '{"error":"boom"}' }) : route.fallback());
  await page.route(pattern, h);
  return () => page.unroute(pattern, h);
};
const visibleErr = async () => {
  const txt = await page.locator('body').innerText();
  return /could not|couldn.t|went wrong|try again|boom|failed|error/i.test(txt);
};
const section = async (name, fn) => {
  const before = pageErrors.length;
  try { await fn(); } catch (e) { check(`${name}: finished without crashing`, false, String(e).slice(0, 400)); await shot('river-full-' + name.replace(/\W+/g, '-')); }
  check(`${name}: no uncaught page errors`, pageErrors.length === before, pageErrors.slice(before).join(' | '));
};
const clearTodos = async () => { for (const t of await todos()) await api('DELETE', `/api/todos/${t.id}?scope=all`); };
const clickMore = async () => { await page.getByRole('button', { name: 'More', exact: true }).click(); };

await page.setViewportSize({ width: 1440, height: 900 });

/* ---------------------------------------------------------------- NOTES */
await section('notes create and edit', async () => {
  await goto('/notes');
  await page.locator('#r-note-search').waitFor({ timeout: 15000 });
  await page.getByRole('button', { name: 'New note', exact: true }).click();
  await page.locator('#r-note-title').waitFor({ timeout: 10000 });
  await page.fill('#r-note-title', 'River UI note');
  await page.locator('.bn-editor').click();
  await page.keyboard.type('hello river body');
  const made = await until(async () => (await api('GET', '/api/notes')).notes.some((n) => n.title === 'River UI note' && /hello river body/.test(n.content || '')), 12000);
  check('a new note is created from the UI with title and body', made);
  await page.fill('#r-note-title', 'River UI note v2');
  check('editing the title saves it', await until(async () => (await api('GET', '/api/notes')).notes.some((n) => n.title === 'River UI note v2'), 10000));
});

await section('notes pin', async () => {
  const n = (await api('GET', '/api/notes')).notes.find((x) => x.title === 'River UI note v2');
  await goto('/notes/' + n.id);
  await page.locator('#r-note-title').waitFor({ timeout: 12000 });
  await clickMore();
  await page.getByRole('menuitem', { name: 'Pin to Home' }).click();
  check('Pin to Home sets meta.pinned', await until(async () => (await getNote(n.id)).meta?.pinned === true));
  await clickMore();
  await page.getByRole('menuitem', { name: 'Unpin from Home' }).click();
  check('Unpin clears it', await until(async () => !(await getNote(n.id)).meta?.pinned));
  for (let i = 0; i < 3; i++) await mkNote('Pinned ' + i, { meta: { pinned: true } });
  await goto('/notes/' + n.id);
  await page.locator('#r-note-title').waitFor({ timeout: 12000 });
  await sleep(1500);
  await clickMore();
  await page.getByRole('menuitem', { name: 'Pin to Home' }).click();
  check('a 4th pin is refused with a message', await page.getByText(/up to 3 notes/).isVisible().catch(() => false));
  check('and the note stays unpinned', !(await getNote(n.id)).meta?.pinned);
});

await section('notes archive trash restore delete forever', async () => {
  const n = await mkNote('Life cycle note');
  await goto('/notes/' + n.id);
  await page.locator('#r-note-title').waitFor({ timeout: 12000 });
  await clickMore();
  await page.getByRole('menuitem', { name: 'Archive' }).click();
  check('Archive from the note menu archives it', await until(async () => (await getNote(n.id)).isArchived === true));
  await goto('/notes/' + n.id);
  await page.locator('#r-note-title').waitFor({ timeout: 12000 });
  await clickMore();
  await page.getByRole('menuitem', { name: 'Unarchive' }).click();
  check('Unarchive from the note menu brings it back', await until(async () => (await getNote(n.id)).isArchived === false));
  await goto('/notes/' + n.id);
  await page.locator('#r-note-title').waitFor({ timeout: 12000 });
  deletes.length = 0;
  await clickMore();
  await page.getByRole('menuitem', { name: 'Move to Trash' }).click();
  check('Move to Trash trashes it', await until(async () => (await getNote(n.id)).isDeleted === true));
  check('and the request is not a permanent delete', deletes.length >= 1 && !/permanent/.test(deletes[0]), deletes[0]);
  // server: a plain DELETE on a trashed note must not remove it
  await api('DELETE', '/api/notes/' + n.id);
  check('a repeated plain DELETE does not erase a trashed note', !!(await getNote(n.id)));
  await goto('/notes/' + n.id);
  await page.locator('#r-note-title').waitFor({ timeout: 12000 });
  await clickMore();
  await page.getByRole('menuitem', { name: 'Restore' }).click();
  check('Restore from a trashed note', await until(async () => (await getNote(n.id)).isDeleted === false));
  await api('DELETE', '/api/notes/' + n.id);
  await goto('/notes/' + n.id);
  await page.locator('#r-note-title').waitFor({ timeout: 12000 });
  deletes.length = 0;
  await clickMore();
  await page.getByRole('menuitem', { name: 'Delete forever' }).click();
  check('Delete forever on an open trashed note erases it', await until(async () => !(await getNote(n.id))));
  check('and the UI sent ?permanent=1', deletes.some((u) => /permanent=1/.test(u)), deletes.join(','));
});

await section('notes archive and trash lists', async () => {
  const a = await mkNote('List archive me');
  const b = await mkNote('List trash me');
  const c = await mkNote('List trash me too');
  await api('POST', `/api/notes/${a.id}/archive`);
  await api('DELETE', `/api/notes/${b.id}`);
  await api('DELETE', `/api/notes/${c.id}`);
  await goto('/notes');
  await page.locator('#r-note-search').waitFor({ timeout: 12000 });
  await page.locator('.r-filters').getByRole('button', { name: 'Archive', exact: true }).click();
  await page.getByText('List archive me').first().waitFor({ timeout: 10000 });
  await page.getByRole('button', { name: 'Unarchive' }).first().click();
  check('Unarchive in the Archive list', await until(async () => (await getNote(a.id)).isArchived === false));
  await page.locator('.r-filters').getByRole('button', { name: 'Trash', exact: true }).click();
  await page.getByText('List trash me', { exact: true }).first().waitFor({ timeout: 10000 });
  await page.locator('.r-rowx', { hasText: 'List trash me too' }).getByRole('button', { name: 'Restore' }).click();
  check('Restore in the Trash list', await until(async () => (await getNote(c.id)).isDeleted === false));
  deletes.length = 0;
  await page.locator('.r-rowx', { hasText: 'List trash me' }).first().getByRole('button', { name: 'Delete forever' }).click();
  check('Delete forever in the Trash list erases the note', await until(async () => !(await getNote(b.id))));
  check('and sends ?permanent=1', deletes.some((u) => /permanent=1/.test(u)), deletes.join(','));
  await api('DELETE', `/api/notes/${c.id}`);
  await page.locator('.r-filters').getByRole('button', { name: 'All', exact: true }).click();
  await page.locator('.r-filters').getByRole('button', { name: 'Trash', exact: true }).click();
  await page.getByRole('button', { name: 'Empty Trash' }).waitFor({ timeout: 8000 });
  await page.getByRole('button', { name: 'Empty Trash' }).click();
  check('Empty Trash erases everything in it', await until(async () => !(await getNote(c.id)) && ((await api('GET', '/api/notes?deleted=true')).notes || []).length === 0));
});

await section('notes bulk actions', async () => {
  const ids = [];
  for (const t of ['Bulk N1', 'Bulk N2', 'Bulk N3']) ids.push((await mkNote(t, { tags: ['bulkn'] })).id);
  await goto('/notes');
  await page.locator('#r-note-search').waitFor({ timeout: 12000 });
  const filt = (name) => page.locator('.r-filters').getByRole('button', { name, exact: true });
  const bulk = (name) => page.locator('.r-bulk').getByRole('button', { name, exact: true });
  await page.locator('.r-filters button', { hasText: '#bulkn' }).click();
  await page.getByRole('button', { name: 'Select', exact: true }).click();
  await page.locator('.r-row', { hasText: 'Bulk N1' }).first().click();
  await page.locator('.r-row', { hasText: 'Bulk N2' }).first().click();
  check('Select shows the count', await page.locator('.r-bulk b', { hasText: '2 selected' }).isVisible());
  check('picking does not open the note', /\/notes$/.test(page.url()), page.url());
  await bulk('Archive').click();
  check('bulk Archive archives both picked notes', await until(async () => (await getNote(ids[0])).isArchived && (await getNote(ids[1])).isArchived && !(await getNote(ids[2])).isArchived));
  await filt('Archive').click();
  await page.getByRole('button', { name: 'Select', exact: true }).click();
  await bulk('All').click();
  await bulk('Unarchive').click();
  check('bulk Unarchive restores them', await until(async () => !(await getNote(ids[0])).isArchived && !(await getNote(ids[1])).isArchived));
  await filt('All').click();
  await page.locator('.r-filters button', { hasText: '#bulkn' }).click();
  await page.getByRole('button', { name: 'Select', exact: true }).click();
  await bulk('All').click();
  await bulk('Trash').click();
  check('bulk Trash moves all three to the Trash (not erased)', await until(async () => (await Promise.all(ids.map(getNote))).every((x) => x && x.isDeleted)));
  await filt('Trash').click();
  await page.getByRole('button', { name: 'Select', exact: true }).click();
  await bulk('All').click();
  await bulk('Restore').click();
  check('bulk Restore brings them back', await until(async () => (await Promise.all(ids.map(getNote))).every((x) => x && !x.isDeleted)));
  for (const id of ids) await api('DELETE', '/api/notes/' + id);
  deletes.length = 0;
  await page.reload();
  await filt('Trash').click();
  await page.getByRole('button', { name: 'Select', exact: true }).click();
  await bulk('All').click();
  await bulk('Delete forever').click();
  check('bulk Delete forever erases them', await until(async () => (await Promise.all(ids.map(getNote))).every((x) => !x)));
  check('and sends ?permanent=1 for each', deletes.filter((u) => /permanent=1/.test(u)).length >= 3, deletes.length);
});

await section('notes search and shortcuts while typing', async () => {
  await mkNote('Zebra crossing', { tags: ['animals'], content: 'unique-needle-word inside' });
  await goto('/notes');
  const box = page.locator('#r-note-search');
  await box.waitFor({ timeout: 12000 });
  await box.fill('zebra');
  await sleep(900);
  check('search finds a note by title', (await page.locator('.r-flat .r-row', { hasText: 'Zebra crossing' }).count()) === 1);
  await box.fill('unique-needle-word');
  await sleep(900);
  check('search finds a note by its text', (await page.locator('.r-flat .r-row', { hasText: 'Zebra crossing' }).count()) === 1);
  await box.fill('animals');
  await sleep(900);
  check('search finds a note by tag', (await page.locator('.r-flat .r-row', { hasText: 'Zebra crossing' }).count()) === 1);
  await box.fill('qqqq-nothing-here');
  await sleep(900);
  check('no match says so', await page.getByText(/No notes match/).first().isVisible());
  await page.keyboard.press('Escape');
  check('Escape clears the search box', (await box.inputValue()) === '');
  await box.click();
  await page.keyboard.type('ncj?/ gt');
  await sleep(300);
  check('plain letter keys typed in search do not open capture or navigate', (await page.locator('#r-capture-input').count()) === 0 && /\/notes$/.test(page.url()) && (await box.inputValue()) === 'ncj?/ gt', await box.inputValue());
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+Shift+Space');
  check('Ctrl+Shift+Space opens capture on Notes', await page.locator('#r-capture-input').isVisible().catch(() => false));
  await page.keyboard.press('Escape');
  check('Escape closes capture', (await page.locator('#r-capture-input').count()) === 0);
  const z = (await api('GET', '/api/notes')).notes.find((x) => x.title === 'Zebra crossing');
  await goto('/notes/' + z.id);
  await page.locator('#r-note-title').waitFor({ timeout: 12000 });
  await page.locator('#r-note-title').click();
  await page.keyboard.press('End');
  await page.keyboard.type(' ncj');
  check('letters typed in a note title do not trigger shortcuts', (await page.locator('#r-capture-input').count()) === 0 && (await page.locator('#r-note-title').inputValue()) === 'Zebra crossing ncj');
});

/* ---------------------------------------------------------------- TASKS */
await section('tasks add, done, undo, delete', async () => {
  await api('POST', '/api/todos', { text: 'TL alpha', deadline: eod(0).toISOString() });
  await api('POST', '/api/todos', { text: 'TL beta', deadline: eod(2).toISOString() });
  await goto('/tasks');
  await page.locator('#r-task-add').waitFor({ timeout: 15000 });
  await page.fill('#r-task-add', 'revise BCNF tomorrow !high #exams');
  const pre = (await page.locator('.r-tl-pre').allInnerTexts()).join(' ');
  check('the add box previews the date, priority and tag', /High/.test(pre) && pre.includes('#exams'), pre);
  await page.keyboard.press('Enter');
  check('adding a task saves text, priority and tag', await until(async () => (await todos()).some((t) => /revise BCNF/.test(t.text) && t.priority === 'high' && JSON.stringify(t.tags || t.todoTags || []).includes('exams'))));
  check('and the add box is cleared', (await page.locator('#r-task-add').inputValue()) === '');
  const rowA = page.locator('.r-tl-row', { hasText: 'TL alpha' });
  await rowA.locator('input[type=checkbox]').click();
  check('ticking a task completes it', await until(async () => (await byText('TL alpha'))[0]?.completed === true));
  check('and shows a Marked done toast', await page.locator('.pb-undo', { hasText: 'Marked done' }).isVisible());
  await page.locator('.pb-undo button', { hasText: 'Undo' }).click();
  check('Undo reopens it', await until(async () => (await byText('TL alpha'))[0]?.completed === false));
  // delete + undo
  await page.locator('.r-tl-row', { hasText: 'TL beta' }).getByRole('button', { name: /Delete: TL beta/ }).click();
  check('Delete hides the row at once', (await page.locator('.r-tl-row', { hasText: 'TL beta' }).count()) === 0);
  check('but the task still exists during the undo time', (await byText('TL beta')).length === 1);
  await page.locator('.pb-undo button', { hasText: 'Undo' }).click();
  check('Undo brings the row back', (await page.locator('.r-tl-row', { hasText: 'TL beta' }).count()) === 1);
  await page.locator('.r-tl-row', { hasText: 'TL beta' }).getByRole('button', { name: /Delete: TL beta/ }).click();
  check('after the undo time the task is deleted', await until(async () => (await byText('TL beta')).length === 0, 10000));
});

await section('tasks repeating', async () => {
  const start = new Date(Date.now() + 3600000);
  await api('POST', '/api/todos', { text: 'TL repeat', deadline: start.toISOString(), recurrence: 'daily' });
  const n0 = (await byText('TL repeat')).length;
  check('a daily task makes several occurrences', n0 >= 2, n0);
  await goto('/tasks');
  await page.locator('.r-tl-row', { hasText: 'TL repeat' }).first().waitFor({ timeout: 15000 });
  await page.locator('.r-tl-row', { hasText: 'TL repeat' }).first().getByRole('button', { name: /Delete:/ }).click();
  await page.getByRole('button', { name: 'Cancel' }).click();
  check('Cancel on the series question deletes nothing', (await byText('TL repeat')).length === n0);
  await page.locator('.r-tl-row', { hasText: 'TL repeat' }).first().getByRole('button', { name: /Delete:/ }).click();
  await page.getByRole('button', { name: 'Just this one' }).click();
  check('Just this one removes exactly one occurrence', await until(async () => (await byText('TL repeat')).length === n0 - 1), (await byText('TL repeat')).length);
  await page.locator('.r-tl-row', { hasText: 'TL repeat' }).first().getByRole('button', { name: /Delete:/ }).click();
  await page.getByRole('button', { name: 'All in the series' }).click();
  check('All in the series removes every occurrence', await until(async () => (await byText('TL repeat')).length === 0));
});

await section('tasks bulk, search, groups', async () => {
  for (const t of ['Bulk A', 'Bulk B', 'Bulk C']) await api('POST', '/api/todos', { text: t, priority: 'low' });
  await goto('/tasks');
  await page.locator('#r-task-search').waitFor({ timeout: 15000 });
  await page.fill('#r-task-search', 'Bulk');
  check('search narrows the list', (await page.locator('.r-tl-row').count()) === 3);
  await page.fill('#r-task-search', 'zzzz-none');
  check('search with no hits says so', await page.getByText('No tasks match your search.').isVisible());
  await page.keyboard.press('Escape');
  check('Escape clears task search', (await page.locator('#r-task-search').inputValue()) === '');
  await page.locator('#r-task-search').click();
  await page.keyboard.type('Bulk');
  await page.getByRole('button', { name: 'Select', exact: true }).click();
  await page.getByRole('button', { name: 'All shown' }).click();
  check('All shown selects the three', await page.locator('.r-tl-bulk b', { hasText: '3 selected' }).isVisible());
  await page.getByRole('button', { name: 'High priority' }).click();
  check('bulk High priority', await until(async () => (await Promise.all(['Bulk A', 'Bulk B', 'Bulk C'].map(byText))).every((l) => l[0]?.priority === 'high')));
  await page.locator('.pb-undo button', { hasText: 'Undo' }).click();
  check('Undo puts priority back', await until(async () => (await Promise.all(['Bulk A', 'Bulk B', 'Bulk C'].map(byText))).every((l) => l[0]?.priority === 'low')));
  await page.getByRole('button', { name: 'All shown' }).click();
  await page.getByRole('button', { name: 'Move to tomorrow' }).click();
  const tm = eod(1).getDate();
  check('bulk Move to tomorrow', await until(async () => (await Promise.all(['Bulk A', 'Bulk B', 'Bulk C'].map(byText))).every((l) => l[0]?.deadline && new Date(l[0].deadline).getDate() === tm)));
  await page.getByRole('button', { name: 'All shown' }).click();
  await page.getByRole('button', { name: 'Mark done' }).click();
  check('bulk Mark done', await until(async () => (await Promise.all(['Bulk A', 'Bulk B', 'Bulk C'].map(byText))).every((l) => l[0]?.completed === true)));
  await page.locator('.pb-undo button', { hasText: 'Undo' }).click();
  check('Undo reopens them', await until(async () => (await Promise.all(['Bulk A', 'Bulk B', 'Bulk C'].map(byText))).every((l) => l[0]?.completed === false)));
  await page.getByRole('button', { name: 'All shown' }).click();
  await page.locator('.r-tl-bulk').getByRole('button', { name: 'Delete', exact: true }).click();
  check('bulk Delete hides the rows', (await page.locator('.r-tl-row').count()) === 0);
  check('and erases the tasks after the undo time', await until(async () => (await byText('Bulk A')).length + (await byText('Bulk B')).length + (await byText('Bulk C')).length === 0, 11000));
  // group collapse
  await api('POST', '/api/todos', { text: 'Group probe', deadline: eod(0).toISOString() });
  await page.reload();
  await page.locator('.r-tl-gh').first().waitFor({ timeout: 15000 });
  const gh = page.locator('.r-tl-gh').first();
  const open0 = await gh.getAttribute('aria-expanded');
  await gh.click();
  check('a group header collapses and expands', (await gh.getAttribute('aria-expanded')) !== open0);
});

/* ---------------------------------------------------------------- RIVER HOME */
await section('river home drawer', async () => {
  await clearTodos();
  await api('POST', '/api/todos', { text: 'Home task one', deadline: eod(0).toISOString() });
  await api('POST', '/api/todos', { text: 'Home task two', deadline: eod(0).toISOString() });
  await goto('/');
  await page.locator('.r-task', { hasText: 'Home task one' }).waitFor({ timeout: 15000 });
  await page.locator('.r-task', { hasText: 'Home task one' }).locator('button').first().click();
  await page.waitForFunction(() => document.querySelector('#rv-sel')?.textContent === 'Home task one');
  await page.getByRole('button', { name: 'Mark done', exact: true }).click();
  check('drawer Mark done completes the task', await until(async () => (await byText('Home task one'))[0]?.completed === true));
  await page.getByRole('button', { name: 'Not done yet', exact: true }).click();
  check('and Not done yet reopens it', await until(async () => (await byText('Home task one'))[0]?.completed === false));
  // repeating task delete from the drawer
  await api('POST', '/api/todos', { text: 'Home repeat', deadline: new Date(Date.now() + 1800000).toISOString(), recurrence: 'daily' });
  const n0 = (await byText('Home repeat')).length;
  await page.reload();
  await page.locator('.r-task', { hasText: 'Home repeat' }).first().waitFor({ timeout: 15000 });
  await page.locator('.r-task', { hasText: 'Home repeat' }).first().locator('button').first().click();
  await page.waitForFunction(() => document.querySelector('#rv-sel')?.textContent === 'Home repeat');
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await page.getByRole('button', { name: 'Just this one' }).click();
  check('drawer Delete asks about the series and removes one occurrence', await until(async () => (await byText('Home repeat')).length === n0 - 1));
  const left = await byText('Home repeat');
  if (left[0]) await api('DELETE', `/api/todos/${left[0].id}?scope=all`);
  // link safety in the drawer
  const st = new Date(Date.now() + 5400000);
  const en = new Date(st.getTime() + 1800000);
  const mk = (text, link) => api('POST', '/api/todos', { text, deadline: st.toISOString(), startTime: hhmm(st), endTime: hhmm(en), meta: { link } });
  await mk('Link ok meet', 'https://meet.google.com/abc-defg-hij');
  await mk('Link js meet', 'javascript:alert(1)');
  await mk('Link ftp meet', 'ftp://example.com/x');
  await page.reload();
  const pickMeeting = async (t) => { await page.locator('button', { hasText: t }).first().click(); await page.waitForFunction((x) => document.querySelector('#rv-sel')?.textContent === x, t); };
  await pickMeeting('Link ok meet');
  check('an https meeting link shows a Join button', (await page.locator('a.join[href="https://meet.google.com/abc-defg-hij"]').count()) === 1);
  await pickMeeting('Link js meet');
  check('a javascript: link is not clickable', (await page.locator('a.join').count()) === 0 && (await page.locator('a[href^="javascript:"]').count()) === 0);
  await pickMeeting('Link ftp meet');
  check('an ftp: link is not clickable', (await page.locator('a.join').count()) === 0 && (await page.locator('a[href^="ftp:"]').count()) === 0);
});

await section('river reminders', async () => {
  await clearTodos();
  const soon = new Date(Date.now() + 3 * 60000);
  const end = new Date(soon.getTime() + 1800000);
  const mk = (text, link) => api('POST', '/api/todos', { text, deadline: soon.toISOString(), startTime: hhmm(soon), endTime: hhmm(end), meta: { link, remindMin: 5 } });
  await mk('Remind secure', 'https://meet.google.com/rem-aaaa-bbb');
  await mk('Remind plain', 'http://zoom.us/j/123');
  await mk('Remind js', 'javascript:alert(2)');
  await mk('Remind data', 'data:text/html,hi');
  await goto('/');
  await page.evaluate(() => localStorage.removeItem('peblo-meeting-reminded'));
  await page.reload();
  const region = page.getByRole('region', { name: 'Meeting reminders' });
  await region.waitFor({ timeout: 20000 });
  await sleep(800);
  check('a reminder card shows for each meeting starting soon', (await region.locator('.r-remind-card').count()) === 4, await region.locator('.r-remind-card').count());
  const card = (t) => region.locator('.r-remind-card', { hasText: t });
  check('https link: Join Google Meet is a link', (await card('Remind secure').locator('a[href="https://meet.google.com/rem-aaaa-bbb"]').count()) === 1);
  check('http link: clickable', (await card('Remind plain').locator('a[href="http://zoom.us/j/123"]').count()) === 1);
  check('javascript: link: no link on the card', (await card('Remind js').locator('a').count()) === 0);
  check('data: link: no link on the card', (await card('Remind data').locator('a').count()) === 0);
  check('the join link opens safely (noopener)', /noopener/.test((await card('Remind secure').locator('a').getAttribute('rel')) || ''));
  await card('Remind js').locator('.r-btns').getByRole('button', { name: 'Dismiss', exact: true }).click();
  check('Dismiss removes only that card', (await region.locator('.r-remind-card').count()) === 3 && (await card('Remind js').count()) === 0);
  await page.reload();
  await sleep(1500);
  check('a dismissed reminder is not shown again after a reload', (await page.getByRole('region', { name: 'Meeting reminders' }).locator('.r-remind-card', { hasText: 'Remind js' }).count()) === 0);
});

await section('river drag and drop and move', async () => {
  await clearTodos();
  await api('POST', '/api/todos', { text: 'Drag me', priority: 'medium' });
  await goto('/');
  await page.evaluate(() => localStorage.setItem('peblo-river-zoom', 'week'));
  await page.reload();
  const pebble = page.locator('.r-pebble', { hasText: 'Drag me' });
  await pebble.waitFor({ timeout: 15000 });
  await pebble.dragTo(page.locator('.r-lane.tasks'), { targetPosition: { x: 430, y: 40 } });
  check('dragging an unscheduled task onto a day gives it a date', await until(async () => !!(await byText('Drag me'))[0]?.deadline), JSON.stringify((await byText('Drag me'))[0]?.deadline));
  await api('POST', '/api/todos', { text: 'Drag fail', priority: 'medium' });
  await page.reload();
  const p2 = page.locator('.r-pebble', { hasText: 'Drag fail' });
  await p2.waitFor({ timeout: 15000 });
  const un = await failing('**/api/todos/*', 'PATCH');
  await p2.dragTo(page.locator('.r-lane.tasks'), { targetPosition: { x: 430, y: 40 } });
  check('a failed drop shows an error and leaves the task unscheduled', (await page.locator('.r-toast', { hasText: /Could not move/ }).isVisible().catch(() => false)) && !(await byText('Drag fail'))[0]?.deadline);
  await un();
  await page.evaluate(() => localStorage.setItem('peblo-river-zoom', 'day'));
  await api('POST', '/api/todos', { text: 'Move probe', deadline: eod(0).toISOString() });
  await goto('/');
  await page.locator('.r-task', { hasText: 'Move probe' }).locator('button').first().click();
  await page.waitForFunction(() => document.querySelector('#rv-sel')?.textContent === 'Move probe');
  await page.getByRole('button', { name: 'Move', exact: true }).click();
  const un2 = await failing('**/api/todos/*', 'PATCH');
  await page.locator('.r-move button[type="submit"]').click();
  check('Move form shows an error when the server fails', await page.locator('.r-move [role=alert]').isVisible().catch(() => false));
  await un2();
});

await section('river quick add on the lane', async () => {
  await goto('/');
  await page.locator('.r-lane.tasks').waitFor({ timeout: 15000 });
  await page.locator('.r-lane.tasks').dblclick({ position: { x: 700, y: 8 } });
  const inp = page.locator('#r-quick-input');
  const shown = await inp.waitFor({ timeout: 5000 }).then(() => true).catch(() => false);
  check('double-click on the Tasks lane opens quick add', shown);
  if (shown) {
    await inp.fill('Quick lane task');
    const un = await failing('**/api/todos', 'POST');
    await page.keyboard.press('Enter');
    check('quick add shows an error when the server fails', await page.locator('.r-quick [role=alert]').waitFor({ timeout: 4000 }).then(() => true).catch(() => false));
    await un();
    await page.keyboard.press('Enter');
    check('and works when retried', await until(async () => (await byText('Quick lane task')).length === 1));
  }
});

/* ---------------------------------------------------------------- CAPTURE */
await section('capture dialog', async () => {
  await goto('/');
  await page.locator('.r-river').waitFor({ timeout: 15000 });
  await page.getByRole('button', { name: 'Capture a task, meeting or note' }).click();
  const inp = page.locator('#r-capture-input');
  check('the + button opens capture', await inp.waitFor({ timeout: 5000 }).then(() => true).catch(() => false));
  const tabs = (await page.getByRole('tab').allInnerTexts()).join(',');
  check('capture has Task, Meeting and Note tabs', tabs === 'Meeting,Task,Note', tabs);
  const submit = page.locator('.r-capture button[type=submit]');
  check('the add button is disabled while empty', await submit.isDisabled());
  await inp.focus();
  const sel0 = (await page.getByRole('tab', { selected: true }).allInnerTexts()).join();
  await page.keyboard.press('Tab');
  const sel = await page.getByRole('tab', { selected: true }).allInnerTexts();
  check('Tab on the title cycles the mode', sel.join() !== sel0 && sel.length === 1, sel0 + ' -> ' + sel.join());
  await page.getByRole('tab', { name: 'Task' }).click();
  await inp.fill('Capture task tomorrow !high #cap');
  await page.keyboard.press('Enter');
  check('Enter adds the task', await until(async () => (await todos()).some((t) => /Capture task/.test(t.text) && t.priority === 'high')));
  await inp.waitFor({ state: 'detached', timeout: 4000 }).catch(() => {});
  // failure
  await page.getByRole('button', { name: 'Capture a task, meeting or note' }).click();
  await inp.waitFor({ timeout: 5000 });
  const un = await failing('**/api/todos', 'POST');
  await inp.fill('Capture will fail');
  await page.keyboard.press('Enter');
  await sleep(1200);
  check('a failed save keeps the dialog open with the text', (await inp.count()) === 1 && (await inp.inputValue()) === 'Capture will fail');
  check('and says it failed', await visibleErr(), (await page.locator('.r-capture-status').allInnerTexts()).join('|'));
  await un();
  await page.keyboard.press('Escape');
  check('Escape closes the dialog', (await page.locator('#r-capture-input').count()) === 0);
  // note mode
  await page.getByRole('button', { name: 'Capture a task, meeting or note' }).click();
  await page.getByRole('tab', { name: 'Note' }).click();
  await page.locator('#r-capture-input').fill('Captured note title');
  await page.locator('textarea.r-cap-body').fill('captured note body');
  await page.keyboard.press('Control+Enter');
  check('Ctrl+Enter saves a note', await until(async () => (await api('GET', '/api/notes')).notes.some((n) => n.title === 'Captured note title' && /captured note body/.test(n.content))));
  // meeting with a full https link, then one typed without https://
  const openMeeting = async () => {
    await page.locator('#r-capture-input').waitFor({ state: 'detached', timeout: 3000 }).catch(() => {});
    if ((await page.locator('#r-capture-input').count()) === 0) await page.getByRole('button', { name: 'Capture a task, meeting or note' }).click();
    await page.locator('#r-capture-input').waitFor({ timeout: 5000 });
    if ((await page.getByRole('tab', { name: 'Meeting' }).getAttribute('aria-selected')) !== 'true') await page.getByRole('tab', { name: 'Meeting' }).click({ timeout: 5000, force: true });
  };
  await openMeeting();
  await page.locator('#r-capture-input').fill('Capture full tomorrow 3pm');
  await page.getByLabel('Meeting link').fill('https://meet.google.com/aaa-bbbb-ccc');
  await page.locator('#r-capture-input').press('Enter');
  check('a meeting with a full https link saves', await until(async () => (await todos()).some((t) => /Capture full/.test(t.text) && t.meta?.link === 'https://meet.google.com/aaa-bbbb-ccc'), 6000));
  await sleep(500);
  await openMeeting();
  await page.locator('#r-capture-input').fill('Capture meet tomorrow 4pm');
  const lk = page.getByLabel('Meeting link');
  await lk.fill('meet.google.com/abc-defg-hij');
  const valid = await lk.evaluate((el) => el.validity.valid);
  await page.locator('#r-capture-input').press('Enter');
  const saved = await until(async () => (await todos()).some((t) => /Capture meet/.test(t.text)), 6000);
  check('a meeting link typed without https:// still saves (https is added)', saved, 'input valid=' + valid);
  const m = (await todos()).find((t) => /Capture meet/.test(t.text));
  check('and the stored link is https', !!m && m.meta?.link === 'https://meet.google.com/abc-defg-hij', JSON.stringify(m && m.meta));
  if (!saved) await shot('river-full-capture-link');
  await page.keyboard.press('Escape');
  await goto('/');
  await page.locator('.r-river').waitFor({ timeout: 15000 });
  await page.keyboard.press('Control+Shift+Space');
  check('Ctrl+Shift+Space opens capture on the river', await page.locator('#r-capture-input').isVisible().catch(() => false));
});

/* ---------------------------------------------------------------- FAILURES */
await section('notes api failures', async () => {
  const a = await mkNote('Fail archive me');
  const t = await mkNote('Fail trash me');
  await api('POST', `/api/notes/${a.id}/archive`);
  await api('DELETE', `/api/notes/${t.id}`);
  await goto('/notes');
  await page.locator('#r-note-search').waitFor({ timeout: 12000 });
  await page.locator('.r-filters').getByRole('button', { name: 'Archive', exact: true }).click();
  await page.getByText('Fail archive me').first().waitFor({ timeout: 10000 });
  let un = await failing('**/api/notes/*/archive', 'POST');
  await page.getByRole('button', { name: 'Unarchive' }).first().click();
  await sleep(1000);
  check('Unarchive failing shows an error', await visibleErr());
  check('and the note stays archived', (await getNote(a.id)).isArchived === true);
  await un();
  await page.locator('.r-filters').getByRole('button', { name: 'Trash', exact: true }).click();
  await page.getByText('Fail trash me').first().waitFor({ timeout: 10000 });
  un = await failing('**/api/notes/*/restore', 'POST');
  await page.locator('.r-rowx', { hasText: 'Fail trash me' }).getByRole('button', { name: 'Restore' }).click();
  await sleep(1000);
  check('Restore failing shows an error', await visibleErr());
  await un();
  un = await failing('**/api/notes/*', 'DELETE');
  await page.locator('.r-rowx', { hasText: 'Fail trash me' }).getByRole('button', { name: 'Delete forever' }).click();
  await sleep(1000);
  check('Delete forever failing shows an error', await visibleErr());
  check('and the note still exists', !!(await getNote(t.id)));
  await page.getByRole('button', { name: 'Empty Trash' }).click();
  await sleep(1000);
  check('Empty Trash failing shows an error', await visibleErr());
  await un();
  await goto('/notes/' + a.id);
  await page.locator('#r-note-title').waitFor({ timeout: 12000 });
  un = await failing('**/api/notes/*/archive', 'POST');
  await clickMore();
  await page.getByRole('menuitem', { name: 'Unarchive' }).click();
  await sleep(1000);
  check('Unarchive from the note menu failing shows an error', await visibleErr());
  await un();
  await goto('/notes');
  await page.locator('#r-note-search').waitFor({ timeout: 12000 });
  un = await failing('**/api/notes/*/archive', 'POST');
  await page.getByRole('button', { name: 'Select', exact: true }).click();
  await page.locator('.r-row', { hasText: 'Fail' }).first().click().catch(() => {});
  await page.locator('.r-bulk').getByRole('button', { name: 'Archive', exact: true }).click().catch(() => {});
  await sleep(800);
  check('bulk Archive failing says something went wrong', await page.getByText('Something went wrong').isVisible().catch(() => false));
  await un();
  const s = await mkNote('Fail save');
  await goto('/notes/' + s.id);
  await page.locator('#r-note-title').waitFor({ timeout: 12000 });
  un = await failing('**/api/notes/*', 'PATCH');
  await page.fill('#r-note-title', 'Fail save edited');
  await sleep(4000);
  check('a failed autosave is reported, not silent', (await page.locator('.r-saved.bad').isVisible().catch(() => false)) || (await visibleErr()));
  await un();
});

await section('tasks api failures', async () => {
  await api('POST', '/api/todos', { text: 'Fail task', deadline: eod(0).toISOString() });
  await goto('/tasks');
  await page.locator('.r-tl-row', { hasText: 'Fail task' }).waitFor({ timeout: 15000 });
  let un = await failing('**/api/todos/*', 'PATCH');
  await page.locator('.r-tl-row', { hasText: 'Fail task' }).locator('input[type=checkbox]').check({ force: true }).catch(() => {});
  await sleep(1000);
  check('ticking a task while the server fails shows an error', await visibleErr());
  await un();
  check('and the task is not completed', (await byText('Fail task'))[0]?.completed === false);
  await page.reload();
  await page.locator('.r-tl-row', { hasText: 'Fail task' }).waitFor({ timeout: 15000 });
  un = await failing('**/api/todos', 'POST');
  await page.fill('#r-task-add', 'Fail add');
  await page.keyboard.press('Enter');
  await sleep(1000);
  check('adding a task while the server fails shows an error', await visibleErr());
  check('and keeps what was typed', (await page.locator('#r-task-add').inputValue()) === 'Fail add');
  await un();
  await page.fill('#r-task-add', '');
  un = await failing('**/api/todos/*', 'DELETE');
  await page.locator('.r-tl-row', { hasText: 'Fail task' }).getByRole('button', { name: /Delete:/ }).click();
  await sleep(7500);
  check('delete failing brings the row back', (await page.locator('.r-tl-row', { hasText: 'Fail task' }).count()) === 1);
  check('and says it failed', await visibleErr());
  await un();
  un = await failing('**/api/todos/*', 'PATCH');
  await page.getByRole('button', { name: 'Select', exact: true }).click();
  await page.getByRole('button', { name: 'All shown' }).click();
  await page.getByRole('button', { name: 'Mark done' }).click();
  await sleep(1000);
  check('bulk Mark done failing shows an error', await visibleErr());
  await un();
});

await section('home api failures', async () => {
  await clearTodos();
  await api('POST', '/api/todos', { text: 'Home fail', deadline: eod(0).toISOString() });
  await goto('/');
  await page.locator('.r-task', { hasText: 'Home fail' }).waitFor({ timeout: 15000 });
  await page.locator('.r-task', { hasText: 'Home fail' }).locator('button').first().click();
  await page.waitForFunction(() => document.querySelector('#rv-sel')?.textContent === 'Home fail');
  let un = await failing('**/api/todos/*', 'PATCH');
  await page.locator('.r-task', { hasText: 'Home fail' }).locator('input[type=checkbox]').check({ force: true }).catch(() => {});
  check('tick failing shows the toast', await page.locator('.r-toast', { hasText: /Could not update/ }).isVisible().catch(() => false));
  await un();
  un = await failing('**/api/todos/*', 'DELETE');
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await sleep(800);
  check('drawer Delete failing shows the error and keeps the task', (await page.locator('.r-toast').isVisible().catch(() => false)) && (await byText('Home fail')).length === 1);
  await un();
  un = await failing('**/api/todos/range*', 'GET');
  await page.reload();
  await sleep(2000);
  check('the river survives its list request failing', (await page.locator('header.r-head').count()) === 1);
  await un();
  un = await failing('**/api/notes*', 'GET');
  await page.goto(base + '/notes');
  await sleep(2000);
  check('the notes screen survives its list request failing', (await page.locator('header.r-head').count()) === 1);
  await un();
  un = await failing('**/api/todos*', 'GET');
  await page.goto(base + '/tasks');
  await sleep(2000);
  check('the tasks screen survives its list request failing', (await page.locator('header.r-head').count()) === 1);
  await un();
});

check('no React or console errors in the whole run', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
check('no uncaught page errors in the whole run', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
await finish();

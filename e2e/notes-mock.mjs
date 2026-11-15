// Soft notes page against a fake in-memory API (no server, no database): tabs, folders, drafts, saving, delete + undo.
// Run:  npm run build:client  &&  node e2e/notes-mock.mjs
import http from 'http';
import fs from 'fs';
import path from 'path';
import { chromium } from 'playwright-core';
import { hashText } from '../client/src/utils/unsavedCopy.js';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const DIST = path.join(REPO, 'client', 'dist');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.json': 'application/json' };

// ---- static server for the built client (single page app: unknown paths get index.html)
const server = http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0]);
  let f = path.join(DIST, u);
  if (!f.startsWith(DIST) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(DIST, 'index.html');
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

// ---- the fake API
const now = () => new Date().toISOString();
let seq = 0;
const mk = (title, content, extra = {}) => ({ id: `n${++seq}`, title, content, tags: [], meta: {}, isDeleted: false, isArchived: false, taskCount: 0, createdAt: now(), updatedAt: now(), ...extra });
const notes = [
  mk('Sprint plan', 'Goals for the sprint', { meta: { folder: 'Project Alpha' }, tags: ['alpha'] }),
  mk('Kickoff notes', 'Agenda and questions', { meta: { folder: 'Project Alpha' }, tags: ['alpha', 'beta'] }),
  mk('Biology revision', 'Cell structure', { tags: ['beta'] }),
  mk('', '# Plan for Monday\nbuy milk', {}),
];
// two team notes, reachable by address only (kept out of the list so the checks above count the same rows)
const teamNote = mk('Team roadmap', 'Q3 goals for the whole team', { id: 't1', hidden: true });
const lockedNote = mk('Locked roadmap', 'Nobody may see this history', { id: 't2', hidden: true });
notes.push(teamNote, lockedNote);
const light = (n) => { const { content, ...rest } = n; return { ...rest, snippet: content.replace(/[#*_>`]/g, '').replace(/\s+/g, ' ').trim().slice(0, 140), wordCount: content.split(/\s+/).filter(Boolean).length, light: true }; };
const user = { id: 'u1', email: 'tester@peblo.test', name: 'Tester', settings: { uiStyle: 'soft', noteLayout: 'classic', noteFolders: [{ id: 'f1', name: 'Project Alpha', color: 'mint' }, { id: 'f2', name: 'Ideas', color: 'lilac' }] } };
const reqs = [];
let failPatches = 0;
const failIds = new Set(); // PATCH on these notes always fails with 500
const rate429 = new Set(); // the first PATCH on these notes answers 429 (too many requests)
let withTeam = false; // the fake account belongs to a team once a check turns this on

const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
async function handle(route) {
  const req = route.request();
  const url = new URL(req.url());
  const p = url.pathname.replace(/^\/api/, '');
  const method = req.method();
  let body = null; try { body = req.postDataJSON(); } catch { /* none */ }
  reqs.push({ method, path: p, body, q: Object.fromEntries(url.searchParams), space: req.headers()['x-peblo-space'] });
  if (p === '/profile' && method === 'GET') return json(route, { user });
  if (p === '/profile' && method === 'PUT') { Object.assign(user.settings, body?.settings || {}); return json(route, { user }); }
  if (p === '/config') return json(route, { publicUrl: '' });
  if (p === '/workspaces') return json(route, { me: { id: 'u1' }, orgs: withTeam ? [{ id: 'o1', name: 'Acme', kind: 'org', role: 'member', spaces: [{ id: 'team-x', name: 'Team X', kind: 'team', role: 'member' }] }] : [], invites: [] });
  if (p === '/notes' && method === 'GET') {
    const q = Object.fromEntries(url.searchParams);
    let list = notes.filter((n) => !n.hidden && (q.deleted ? n.isDeleted : !n.isDeleted) && (q.archived ? n.isArchived : !n.isArchived));
    if (q.search) list = list.filter((n) => (n.title + n.content).toLowerCase().includes(q.search.toLowerCase()));
    return json(route, { notes: q.fields === 'list' ? list.map(light) : list });
  }
  if (p === '/notes' && method === 'POST') { const n = mk(body.title || 'Untitled', body.content || '', { tags: body.tags || [], meta: body.meta || {} }); notes.unshift(n); return json(route, { note: n }, 201); }
  let m = /^\/notes\/([^/]+)$/.exec(p);
  if (m) {
    const n = notes.find((x) => x.id === m[1]);
    if (!n) return json(route, { error: 'nope' }, 404);
    if (method === 'GET') return json(route, { note: n });
    if (method === 'PATCH') {
      if (failIds.has(n.id)) return json(route, { error: 'Server said no' }, 500);
      if (rate429.has(n.id)) { rate429.delete(n.id); return json(route, { error: 'Too many requests' }, 429); }
      if (failPatches > 0) { failPatches--; return json(route, { error: 'boom' }, 500); }
      for (const k of ['title', 'content', 'tags']) if (k in body) n[k] = body[k];
      if (body.meta) for (const [k, v] of Object.entries(body.meta)) { if (v === '' || v === false || v == null) delete n.meta[k]; else n.meta[k] = v; }
      if ('isArchived' in body) n.isArchived = body.isArchived;
      n.updatedAt = now();
      return json(route, { note: n, updatedAt: n.updatedAt, content: n.content, status: 'saved' });
    }
    if (method === 'DELETE') { if (url.searchParams.get('permanent')) notes.splice(notes.indexOf(n), 1); else n.isDeleted = true; return json(route, { ok: true }); }
  }
  m = /^\/notes\/([^/]+)\/restore$/.exec(p);
  if (m && method === 'POST') { const n = notes.find((x) => x.id === m[1]); if (n) n.isDeleted = false; return json(route, { note: n }); }
  if (/^\/notes\/t1\/backups$/.test(p)) return json(route, { backups: [{ id: 'b1', createdAt: now(), size: 20, preview: 'Q2 goals', label: null, savedBy: 'Mate' }, { id: 'b2', createdAt: now(), size: 18, preview: 'Q1 goals', label: 'Kickoff', savedBy: 'Tester' }] });
  if (/^\/notes\/t2\/backups$/.test(p)) return json(route, { error: 'This note is private. Ask the author to share it with you.', code: 'no_access' }, 403);
  if (/^\/notes\/[^/]+\/backups/.test(p)) return json(route, { backups: [] });
  if (/^\/notes\/[^/]+\/mentions$/.test(p)) return json(route, { mentions: [] });
  if (p.startsWith('/todos')) return json(route, { todos: [] });
  return json(route, {});
}

// ---- browser
const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const browser = await chromium.launch({ executablePath: CHROME, headless: !process.env.HEADED });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript(() => { try { localStorage.setItem('peblo-token', 'test-token'); localStorage.setItem('peblo-style', 'soft'); localStorage.setItem('peblo-theme', 'light'); localStorage.setItem('peblo-collab', 'off'); } catch { /* ignore */ } });
const page = await ctx.newPage();
await page.route('**/api/**', handle);
const logs = [];
page.on('pageerror', (e) => logs.push('pageerror: ' + e.message + ' ' + (e.stack || '').split('\n').slice(0, 4).join(' / ')));
page.on('console', (m) => { if (m.type() === 'error') logs.push('console: ' + m.text().slice(0, 400)); });
let dialogs = 0;
page.on('dialog', (d) => { dialogs++; d.accept(); });

let failures = 0;
const check = (name, ok, extra) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`); if (!ok) { failures++; if (extra !== undefined) console.log('      ', String(extra).slice(0, 300)); } };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const TO = { timeout: 20000 };
const tabs = () => page.locator('[data-testid="note-tab"] b').allInnerTexts();

try {
  // 1. open three notes, then close every tab
  for (const id of ['n1', 'n2', 'n3']) { await page.goto(`${base}/notes/${id}`); await page.locator('[data-testid="note-tabs"]').waitFor(TO); await wait(500); }
  let t = await tabs();
  check('three open notes are three tabs', t.length === 3, t.join('|'));
  // Enter on a tab's close button closes that tab (it must not be taken as "open this tab")
  await page.locator('[data-testid="tab-close"]').first().focus(); await page.keyboard.press('Enter'); await wait(400);
  check('Enter on the close button closes the tab', (await page.locator('[data-testid="note-tab"]').count()) === 2);
  for (let i = 0; i < 2; i++) { await page.locator('[data-testid="tab-close"]').first().click(); await wait(400); }
  await page.locator('.s-note-empty').waitFor(TO);
  check('closing the last tab shows the empty page', await page.locator('.s-note-empty').isVisible());
  await wait(2500);
  check('the closed note does not come back by itself', await page.locator('.s-note-empty').isVisible() && !(await page.locator('textarea.s-note-title').count()));
  check('the address goes back to /notes', new URL(page.url()).pathname === '/notes', page.url());
  check('the tab strip stays so + still works', await page.locator('[data-testid="tab-new"]').isVisible());

  // 2. a folder: bar, new note lands in it
  await page.locator('.np-chip.fold').first().click(); await wait(400);
  await page.locator('.np-card', { hasText: 'Project Alpha' }).first().click(); await wait(500);
  check('opening a folder shows the folder header with New note', await page.locator('.np-fhead [data-testid="folder-new-note"]').isVisible());
  check('the folder lists only its own notes', (await page.locator('.s-note-row').count()) === 2, await page.locator('.s-note-row').count());
  await page.screenshot({ path: 'e2e/notes-mock-folder.png' });
  await page.locator('[data-testid="folder-new-note"]').click(); await wait(500);
  check('New note in a folder opens an unsaved note with a draft tab', await page.locator('[data-testid="draft-tab"]').isVisible());
  await page.locator('textarea.s-note-title').fill('Folder draft'); await wait(300);
  await page.locator('textarea.s-note-title').press('Enter'); await wait(300);
  check('Enter in the title moves the cursor into the note body', await page.evaluate(() => !!document.activeElement && document.activeElement.isContentEditable));
  await page.keyboard.type('Hello from the folder'); await wait(2500);
  const created = reqs.filter((r) => r.method === 'POST' && r.path === '/notes').pop();
  check('the new note was created inside the folder', created?.body?.meta?.folder === 'Project Alpha', JSON.stringify(created?.body));
  check('the open note shows its folder', (await page.locator('.s-crumb').innerText()).includes('Project Alpha'));

  // 3. empty folder gets a New note button
  await page.getByRole('button', { name: 'Back to folders' }).click(); await wait(400);
  await page.locator('.np-card', { hasText: 'Ideas' }).first().click(); await wait(500);
  check('an empty folder offers "New note in Ideas"', (await page.locator('[data-testid="empty-new-note"]').innerText()).includes('Ideas'));

  // 4. the "..." menu works on a new note
  await page.getByRole('button', { name: 'Show all notes' }).click(); await wait(300);
  if (!(await page.locator('[data-testid="tab-new"]').count())) throw new Error('tab strip missing after leaving the folder');
  await page.locator('[data-testid="tab-new"]').click(); await wait(500);
  await page.getByRole('button', { name: 'More' }).click(); await wait(300);
  check('the menu opens on a new unsaved note', await page.locator('.s-menu').getByText('Move to folder').isVisible());
  await page.keyboard.press('Escape');

  // 5. saving fails, Retry brings it back
  await page.goto(`${base}/notes/n3`); await page.locator('textarea.s-note-title').waitFor(TO); await wait(600);
  failPatches = 6;
  await page.locator('textarea.s-note-title').fill('Biology revision v2'); await wait(2500);
  check('a failed save says so and offers Retry', await page.locator('[data-testid="save-retry"]').isVisible());
  failPatches = 0;
  await page.locator('[data-testid="save-retry"]').click(); await wait(1500);
  check('Retry saves the note', notes.find((n) => n.id === 'n3').title === 'Biology revision v2', notes.find((n) => n.id === 'n3').title);
  check('"Saved" shows after the save', !(await page.locator('[data-testid="save-retry"]').count()));

  // 6. trash has no confirm and can be undone
  dialogs = 0;
  await page.getByRole('button', { name: 'More' }).click();
  await page.locator('.s-menu').getByText('Move to Trash').click(); await wait(800);
  check('Move to Trash asks nothing', dialogs === 0, dialogs);
  check('the note is in the Trash', notes.find((n) => n.id === 'n3').isDeleted === true);
  await page.locator('[data-testid="toast-undo"]').click(); await wait(800);
  check('Undo puts the note back', notes.find((n) => n.id === 'n3').isDeleted === false && page.url().endsWith('/notes/n3'), page.url());

  // 7. untitled note uses its first line
  await page.goto(`${base}/notes`); await page.locator('.s-note-row').first().waitFor(TO);
  const rowTexts = await page.locator('.s-note-row .t').allInnerTexts();
  check('an untitled note is named by its first line', rowTexts.some((x) => x.includes('Plan for Monday')), rowTexts.join('|'));

  // 7b. right-click menu, arrow keys, tab shortcut, drag a note onto a folder
  await page.locator('.s-note-row').first().click({ button: 'right' }); await wait(300);
  check('right-clicking a note row opens its menu', await page.locator('[data-testid="row-menu"]').isVisible());
  const menuText = await page.locator('[data-testid="row-menu"]').innerText();
  for (const w of ['Open', 'Move to folder', 'Duplicate', 'Archive', 'Move to Trash']) check(`row menu has "${w}"`, menuText.includes(w), menuText);
  await page.locator('[data-testid="rm-pin"]').click(); await wait(600);
  check('Pin from the row menu pins that note', reqs.some((r) => r.method === 'PATCH' && r.body?.meta?.pinned === true));
  await page.keyboard.press('Escape');
  await page.locator('.s-notes-rows .s-note-row').first().focus();
  await page.keyboard.press('ArrowDown'); await wait(150);
  check('ArrowDown moves from one note row to the next', await page.evaluate(() => { const r = [...document.querySelectorAll('.s-notes-rows .s-note-row')]; return r.indexOf(document.activeElement) === 1; }));
  await page.goto(`${base}/notes/n1`); await page.locator('[data-testid="note-tabs"]').waitFor(TO); await wait(600);
  const tabsBefore = (await tabs()).length;
  await page.keyboard.press('Alt+w'); await wait(700);
  check('Alt+W closes the open tab', (await tabs()).length === tabsBefore - 1, `${tabsBefore} -> ${(await tabs()).length}`);
  await page.goto(`${base}/notes`); await page.locator('.s-note-row').first().waitFor(TO);
  const bio = page.locator('.s-notes-rows .s-note-row', { hasText: 'Biology revision' }).first();
  await bio.waitFor(TO);
  const box = await bio.boundingBox();
  await page.mouse.move(box.x + 30, box.y + 20); await page.mouse.down(); await page.mouse.move(box.x + 60, box.y + 60, { steps: 6 });
  await page.locator('[data-testid="drop-tray"]').waitFor(TO);
  check('dragging a note shows a tray of folders', (await page.locator('[data-testid="drop-folder"]').count()) >= 2);
  const target = await page.locator('[data-testid="drop-folder"]', { hasText: 'Ideas' }).first().boundingBox();
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 10 }); await page.mouse.up(); await wait(900);
  check('dragging a note onto a folder moves it there', notes.find((n) => n.id === 'n3').meta.folder === 'Ideas', JSON.stringify(notes.find((n) => n.id === 'n3').meta));

  // 7c. a save started in Personal stays in Personal even if the space is switched meanwhile (no lost last words)
  await page.goto(`${base}/notes/n1`); await page.locator('textarea.s-note-title').waitFor(TO); await wait(700);
  await page.evaluate(() => localStorage.setItem('peblo-space', 'team-x')); // another window switched space
  await page.locator('textarea.s-note-title').fill('Sprint plan, space safe'); await wait(2500);
  const lastPatch = reqs.filter((r) => r.method === 'PATCH' && r.path === '/notes/n1').pop();
  check('the save carries no team space header after a space switch', lastPatch && lastPatch.space === undefined, JSON.stringify(lastPatch && { space: lastPatch.space, title: lastPatch.body?.title }));
  check('and the title was saved', notes.find((n) => n.id === 'n1').title === 'Sprint plan, space safe');
  await page.evaluate(() => localStorage.removeItem('peblo-space'));

  // 7d. dark theme screenshot of the list (contrast fixes), no assertion
  await page.goto(`${base}/notes`); await page.locator('.s-note-row').first().waitFor(TO);
  await page.locator('.soft-round[aria-label^="Switch to"]').first().click(); await wait(800);
  check('the theme button switches to the dark theme', await page.evaluate(() => document.documentElement.classList.contains('theme-dark') || document.body.classList.contains('theme-dark')));
  await page.screenshot({ path: 'e2e/notes-mock-dark.png' });
  await page.locator('.soft-round[aria-label^="Switch to"]').first().click(); await wait(300); // midnight
  await page.locator('.soft-round[aria-label^="Switch to"]').first().click(); await wait(300); // back to light

  // 7e. tag filter: pick tags, Any / All, chips, Clear
  await page.goto(`${base}/notes`); await page.locator('.s-note-row').first().waitFor(TO);
  const rowCount = () => page.locator('.s-notes-rows .s-note-row').count();
  const total0 = await rowCount();
  await page.locator('[data-testid="tag-filter-btn"]').click();
  await page.locator('[data-testid="tag-picker"] label', { hasText: '#alpha' }).locator('input').check(); await wait(300);
  check('picking a tag filters the list and shows a chip', (await page.locator('[data-testid="tag-chip"]').count()) === 1 && (await rowCount()) === 2, `${await rowCount()} rows`);
  await page.locator('[data-testid="tag-picker"] label', { hasText: '#beta' }).locator('input').check(); await wait(300);
  check('Any: notes with alpha or beta', (await rowCount()) === 3, await rowCount());
  await page.locator('[data-testid="tag-match-all"]').click(); await wait(300);
  check('All: only notes with both tags', (await rowCount()) === 1, await rowCount());
  await page.keyboard.press('Escape'); await wait(200);
  check('Escape closes the tag picker', !(await page.locator('[data-testid="tag-picker"]').count()));
  await page.locator('[data-testid="tag-chip"]', { hasText: 'beta' }).getByRole('button').click(); await wait(300);
  check('removing a chip widens the list again', (await page.locator('[data-testid="tag-chip"]').count()) === 1 && (await rowCount()) === 2, await rowCount());
  await page.locator('[data-testid="tag-clear"]').click(); await wait(300);
  check('Clear removes every tag filter', (await page.locator('[data-testid="tag-chip"]').count()) === 0 && (await rowCount()) === total0, `${await rowCount()} vs ${total0}`);

  // 7f. selection: shift-click range, Ctrl+A, Escape
  await page.getByRole('button', { name: 'Select notes' }).click(); await wait(200);
  const rows = page.locator('.s-notes-rows .s-note-row');
  await rows.nth(0).click(); await rows.nth(3).click({ modifiers: ['Shift'] }); await wait(200);
  check('shift-click selects the range between two rows', (await page.locator('.s-notes-rows .s-note-row.sel').count()) === 4, await page.locator('.s-notes-rows .s-note-row.sel').count());
  await rows.nth(2).click({ modifiers: ['Shift'] }); await wait(200);
  check('shift-click on a ticked row clears the range', (await page.locator('.s-notes-rows .s-note-row.sel').count()) === 2, await page.locator('.s-notes-rows .s-note-row.sel').count());
  await page.keyboard.press('Control+a'); await wait(200);
  check('Ctrl+A selects every shown note', (await page.locator('.s-notes-rows .s-note-row.sel').count()) === total0, `${await page.locator('.s-notes-rows .s-note-row.sel').count()} of ${total0}`);
  await page.keyboard.press('Escape'); await wait(200);
  check('Escape leaves select mode', !(await page.locator('.np-selhead').count()));

  // 7g. shortcuts: "/" and Ctrl+Shift+F focus the search box
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  await page.keyboard.press('/'); await wait(150);
  check('"/" focuses the notes search box', await page.evaluate(() => document.activeElement?.getAttribute('aria-label') === 'Search notes'));
  await page.keyboard.type('x'); await wait(100);
  check('"/" typed in the search box is just text', (await page.locator('.s-nsearch input').inputValue()) === 'x');
  await page.locator('.s-nsearch input').fill(''); await page.locator('.s-notes-rows .s-note-row').first().focus();
  await page.keyboard.press('Control+Shift+F'); await wait(150);
  check('Ctrl+Shift+F in the list focuses the search box', await page.evaluate(() => document.activeElement?.getAttribute('aria-label') === 'Search notes'));
  await page.locator('.s-nsearch input').blur();

  // 7h. bulk archive with one failure and one 429: "2 of 3 done, 1 failed", Show lists the failed note
  await page.getByRole('button', { name: 'Select notes' }).click(); await wait(200);
  const idsByTitle = (t) => notes.find((n) => n.title === t).id;
  const t1 = 'Sprint plan, space safe'; const t2 = 'Kickoff notes'; const t3 = 'Biology revision v2';
  failIds.add(idsByTitle(t1)); rate429.add(idsByTitle(t2));
  for (const t of [t1, t2, t3]) await page.locator('.s-notes-rows .s-note-row', { hasText: t }).first().click();
  await page.getByRole('toolbar', { name: 'Bulk actions' }).getByRole('button', { name: 'Archive' }).click(); await wait(2500);
  const toastText = await page.locator('.s-toast').innerText();
  check('a partly failed bulk action says "2 of 3 done, 1 failed"', toastText.includes('2 of 3 done, 1 failed'), toastText);
  check('the 429 was retried and that note was archived', notes.find((n) => n.title === t2).isArchived === true);
  check('the failing note was not archived', notes.find((n) => n.title === t1).isArchived === false);
  await page.locator('[data-testid="toast-undo"]', { hasText: 'Show' }).click(); await wait(300);
  const dlg = page.locator('[data-testid="bulk-fail-dialog"]');
  check('Show opens a dialog naming the failed note and why', (await dlg.isVisible()) && (await dlg.innerText()).includes(t1) && (await dlg.innerText()).includes('Server said no'), await dlg.innerText());
  check('the dialog is modal and has focus', (await dlg.getAttribute('aria-modal')) === 'true' && await page.evaluate(() => !!document.activeElement?.closest('[data-testid="bulk-fail-dialog"]')));
  await page.keyboard.press('Escape'); await wait(200);
  check('Escape closes the dialog', !(await dlg.count()));
  failIds.clear(); for (const n of notes) n.isArchived = false;

  // 7i. menus take focus and use the arrow keys
  await page.goto(`${base}/notes`); await page.locator('.s-notes-rows .s-note-row').first().waitFor(TO);
  const firstRow = page.locator('.s-notes-rows .s-note-row').first();
  await firstRow.click({ button: 'right' }); await wait(300);
  check('the row menu focuses its first item', await page.evaluate(() => document.activeElement?.textContent === 'Open' && document.activeElement.getAttribute('role') === 'menuitem'));
  await page.keyboard.press('ArrowDown'); await wait(100);
  check('ArrowDown moves to the next item', await page.evaluate(() => document.activeElement?.getAttribute('data-testid') === 'rm-pin'));
  await page.keyboard.press('End'); await wait(100);
  check('End goes to the last item', await page.evaluate(() => { const m = [...document.querySelectorAll('[data-testid="row-menu"] [role="menuitem"]')]; return document.activeElement === m[m.length - 1]; }));
  await page.keyboard.press('Home'); await wait(100);
  check('Home goes to the first item', await page.evaluate(() => document.activeElement?.textContent === 'Open'));
  await page.keyboard.press('Escape'); await wait(200);
  check('Escape closes the row menu', !(await page.locator('[data-testid="row-menu"]').count()));
  await page.getByRole('button', { name: 'View options' }).click(); await wait(200);
  check('the View popover is modal and takes focus', (await page.locator('.np-pop').getAttribute('aria-modal')) === 'true' && await page.evaluate(() => !!document.activeElement?.closest('.np-pop')));
  await page.keyboard.press('Escape'); await wait(200);
  check('closing the View popover returns focus to its button', await page.evaluate(() => document.activeElement?.getAttribute('aria-label') === 'View options'));

  // 7j. appearance: accent colour, dark-mode schedule, account sync, high contrast in River
  await page.goto(`${base}/settings/appearance`); await page.locator('.ax-swatches').waitFor(TO); await wait(500);
  const cssVar = (sel, v) => page.evaluate(([s, n]) => getComputedStyle(document.querySelector(s)).getPropertyValue(n).trim().toUpperCase(), [sel, v]);
  await page.locator('.ax-sw[aria-label="Indigo"]').click(); await wait(600);
  check('picking an accent changes --s-accent', (await cssVar('.soft', '--s-accent')) === '#4F46E5', await cssVar('.soft', '--s-accent'));
  check('and --s-on-accent is readable text', ['#FFFFFF', '#1A1210'].includes(await cssVar('.soft', '--s-on-accent')));
  check('the accent was saved on the account through PUT /profile', user.settings.accent === '#4F46E5' && reqs.some((r) => r.method === 'PUT' && r.path === '/profile' && r.body?.settings?.accent === '#4F46E5'), JSON.stringify(user.settings.accent));
  check('the accent is kept for the pre-paint script', await page.evaluate(() => localStorage.getItem('peblo-accent') === '#4F46E5' && (localStorage.getItem('peblo-accent-css') || '').includes('--s-accent')));
  await page.fill('#ax-hex', '#0F766E'); await wait(200);
  check('typing a custom colour previews it live', (await cssVar('.soft', '--s-accent')) === '#0F766E');
  await page.fill('#ax-hex', '#zzz'); await wait(200);
  check('a bad hex is refused with a message', (await page.locator('.ax-err').innerText()).length > 0 && (await cssVar('.soft', '--s-accent')) === '#0F766E');
  await page.fill('#ax-hex', '#be185d'); await page.getByRole('button', { name: 'Apply' }).click(); await wait(600);
  check('Apply saves the custom colour', user.settings.accent === '#BE185D', user.settings.accent);
  await page.reload(); await page.locator('.ax-swatches').waitFor(TO);
  check('the accent survives a reload', (await cssVar('.soft', '--s-accent')) === '#BE185D');
  await page.evaluate(() => document.documentElement.classList.add('theme-dark'));
  const darkAccent = await cssVar('.soft', '--s-accent');
  check('the dark variant is lighter than the chosen colour', darkAccent !== '#BE185D' && darkAccent.length === 7, darkAccent);
  await page.evaluate(() => document.documentElement.classList.remove('theme-dark'));
  await page.getByRole('button', { name: 'Reset' }).click(); await wait(600);
  check('Reset returns to the default accent and clears the account value', (await cssVar('.soft', '--s-accent')) === '#C4441C' && !user.settings.accent, user.settings.accent);

  // dark-mode schedule
  await page.getByRole('radio', { name: /Auto by time/ }).click(); await page.locator('[data-testid="dark-schedule"]').waitFor(TO); await wait(500);
  check('choosing Auto by time saves theme auto on the account', user.settings.theme === 'auto', user.settings.theme);
  const at = async (offH) => page.evaluate((o) => { const d = new Date(Date.now() + o * 3600000); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; }, offH);
  await page.locator('input[aria-label="Dark from"]').fill(await at(-1)); await wait(300);
  await page.locator('input[aria-label="Dark until"]').fill(await at(1)); await wait(800);
  check('inside the dark window the dark class is applied', await page.evaluate(() => document.documentElement.classList.contains('theme-dark')));
  check('the schedule is saved on the account', user.settings.themeSchedule?.from && user.settings.themeSchedule?.to && user.settings.themeSchedule.from !== user.settings.themeSchedule.to, JSON.stringify(user.settings.themeSchedule));
  await page.locator('input[aria-label="Dark from"]').fill(await at(2)); await wait(300);
  await page.locator('input[aria-label="Dark until"]').fill(await at(3)); await wait(800);
  check('outside the window it is light again', !(await page.evaluate(() => document.documentElement.classList.contains('theme-dark'))));
  await page.locator('input[aria-label="Dark from"]').fill(await at(-1)); await wait(300);
  await page.locator('input[aria-label="Dark until"]').fill(await at(1)); await wait(600);
  await page.reload(); await page.locator('.ax-swatches').waitFor(TO);
  check('after a reload the scheduled dark theme is still applied', await page.evaluate(() => document.documentElement.classList.contains('theme-dark')));
  await page.getByRole('radio', { name: /^Light/ }).click(); await wait(500);

  // accessibility: synced to the account, high contrast reaches River, Orbit and Studio
  await page.getByRole('radio', { name: 'XL' }).click(); await wait(600);
  check('text size is saved on the account (settings.a11y)', user.settings.a11y?.size === 'XL', JSON.stringify(user.settings.a11y));
  await page.getByRole('switch', { name: 'High contrast' }).click(); await wait(500);
  const hc = await page.evaluate(() => {
    const out = {};
    for (const [cls, fg, line] of [['river', '--r-fg', '--r-line'], ['orbit', '--o-fg', '--o-line']]) {
      const el = document.createElement('div'); el.className = cls; document.body.appendChild(el);
      const cs = getComputedStyle(el); out[cls] = cs.getPropertyValue(fg).trim() === cs.getPropertyValue(line).trim() && cs.getPropertyValue(fg).trim() !== ''; el.remove();
    }
    return out;
  });
  check('high contrast makes River lines and Orbit lines solid', hc.river && hc.orbit, JSON.stringify(hc));
  await page.getByRole('switch', { name: 'High contrast' }).click(); await page.getByRole('radio', { name: 'M', exact: true }).click(); await wait(500);
  // density: one value
  await page.getByRole('switch', { name: 'Compact' }).click(); await wait(500);
  check('the Compact switch writes noteDensity', user.settings.noteDensity === 'compact' && (await page.evaluate(() => document.documentElement.getAttribute('data-compact'))) === '1', user.settings.noteDensity);
  await page.goto(`${base}/notes`); await page.locator('.s-note-row').first().waitFor(TO);
  check('the notes list reads the same density', (await page.locator('.s-notes-list.compact').count()) > 0);
  await page.locator('button[aria-label="View options"]').click();
  await page.locator('.np-pop').getByRole('radio', { name: 'Cozy' }).click(); await wait(600);
  check('the View menu density writes the same value', user.settings.noteDensity === 'cozy', user.settings.noteDensity);
  await page.keyboard.press('Escape');
  check('the note menu no longer has its own Text size', (await page.getByText(/^Text size:/).count()) === 0);
  await page.evaluate(() => { localStorage.setItem('peblo-theme', 'light'); });
  // 9. light list (R34): the list carries no text, previews come from `snippet`, the open note loads whole
  await page.goto(`${base}/notes`); await page.locator('.s-note-row').first().waitFor(TO); await wait(500);
  const listReqs = reqs.filter((r) => r.method === 'GET' && r.path === '/notes' && !r.q.search);
  check('the list and the sidebar ask for the light shape', listReqs.length > 0 && listReqs.every((r) => r.q.fields === 'list'), JSON.stringify(listReqs.map((r) => r.q)));
  const previews = await page.locator('.s-notes-rows .s-note-row .s').allInnerTexts();
  check('row previews render from the snippet (the fake API sent no content)', previews.some((x) => x.includes('Goals for the sprint')) || previews.some((x) => x.includes('Agenda and questions')), previews.join('|'));
  reqs.length = 0;
  await page.locator('.s-notes-rows .s-note-row', { hasText: 'Kickoff notes' }).first().click(); await wait(1200);
  check('opening a row loads the whole note', reqs.some((r) => r.method === 'GET' && r.path === '/notes/n2'), JSON.stringify(reqs.map((r) => r.path)));
  check('the editor shows the text, not an empty body', (await page.locator('[contenteditable="true"]').first().innerText()).includes('Agenda and questions'));
  await page.locator('textarea.s-note-title').fill('Kickoff notes v2'); await wait(2500);
  check('saving keeps the full text', notes.find((n) => n.id === 'n2').content === 'Agenda and questions' && notes.find((n) => n.id === 'n2').title === 'Kickoff notes v2');
  check('the row shows the new title without a refetch of the library', (await page.locator('.s-notes-rows .s-note-row .t', { hasText: 'Kickoff notes v2' }).count()) > 0 && reqs.filter((r) => r.method === 'GET' && r.path === '/notes').length === 0, reqs.filter((r) => r.method === 'GET' && r.path === '/notes').length);
  // search needs two characters and shows a Searching state
  reqs.length = 0;
  await page.locator('.s-nsearch input, input[type="search"]').first().fill('k'); await wait(700);
  check('one character does not search', !reqs.some((r) => r.q.search));
  await page.locator('.s-nsearch input, input[type="search"]').first().fill('Kickoff'); await wait(900);
  check('two or more characters search once', reqs.filter((r) => r.q.search).length === 1 && reqs.find((r) => r.q.search).q.fields === 'list');
  await page.locator('.s-nsearch input, input[type="search"]').first().fill(''); await wait(400);

  // 10. version history of a team note (R10): shown, and a refusal is explained
  await page.addInitScript(() => { try { if (/^\/notes\/t\d/.test(location.pathname)) localStorage.setItem('peblo-space', 'team-x'); else localStorage.removeItem('peblo-space'); } catch { /* ignore */ } }); // the two team notes are opened inside a team space
  withTeam = true; reqs.length = 0;
  await page.goto(`${base}/notes/t1`); await page.locator('textarea.s-note-title').waitFor(TO); await wait(900);
  check('the versions list is asked for in the team space', reqs.some((r) => r.path === '/notes/t1/backups' && r.space === 'team-x'), JSON.stringify(reqs.map((r) => [r.path, r.space])));
  check('a team note shows its kept versions', (await page.locator('.s-versions').first().innerText()).includes('2 versions kept'), await page.locator('.s-versions').first().innerText());
  await page.locator('.s-versions').first().click(); await wait(300);
  check('Compare is offered for a team note version', (await page.locator('.rl-ver [role="menuitem"]', { hasText: 'Compare' }).count()) === 2);
  await page.keyboard.press('Escape');
  await page.goto(`${base}/notes/t2`); await page.locator('textarea.s-note-title').waitFor(TO); await wait(900);
  check('a refused history says so clearly', (await page.locator('.s-versions').first().innerText()).includes('do not have access'), await page.locator('.s-versions').first().innerText());
  withTeam = false; await page.goto(`${base}/notes`); await wait(300);
  // 7k. text that never reached the server is kept in localStorage and put back (and saved) on the next open
  const n3 = notes.find((n) => n.id === 'n3');
  const copyKey = 'peblo-unsaved:n3';
  const copy = { content: n3.content + ' Typed while offline', title: null, base: hashText(n3.content), at: Date.now() };
  await page.goto(`${base}/notes`); await page.evaluate(([k, v]) => localStorage.setItem(k, v), [copyKey, JSON.stringify(copy)]);
  await page.goto(`${base}/notes/n3`); await page.locator('textarea.s-note-title').waitFor(TO); await wait(3500);
  check('an unsaved local copy is restored and saved on open', n3.content.includes('Typed while offline'), n3.content);
  check('and the local copy is removed once saved', (await page.evaluate((k) => localStorage.getItem(k), copyKey)) === null);
  // a copy that equals the server text is just dropped
  await page.evaluate(([k, v]) => localStorage.setItem(k, v), [copyKey, JSON.stringify({ content: n3.content, base: hashText('x'), at: Date.now() })]);
  await page.goto(`${base}/notes/n3`); await page.locator('textarea.s-note-title').waitFor(TO); await wait(800);
  check('a copy the server already has is dropped without a prompt', (await page.evaluate((k) => localStorage.getItem(k), copyKey)) === null && dialogs === 0, 'dialogs ' + dialogs);

  // 7l. a space changed in another window reaches this one (storage event), without loops
  const page2 = await ctx.newPage(); await page2.route('**/api/**', handle);
  await page2.goto(`${base}/notes`); await page2.locator('.s-note-row').first().waitFor(TO); await wait(500);
  const mark = reqs.length;
  await page.evaluate(() => localStorage.setItem('peblo-space', 'team-y')); await wait(1500);
  const after = reqs.slice(mark).filter((r) => r.path === '/notes' && r.method === 'GET');
  check('a space change in another window reloads the lists in the space that was chosen', after.some((r) => r.space === 'team-y'), JSON.stringify(after.map((r) => r.space)));
  const settled = reqs.length; await wait(1500);
  check('and it does not loop', reqs.length - settled <= 2, 'extra requests: ' + (reqs.length - settled));
  await page.evaluate(() => localStorage.removeItem('peblo-space')); await wait(500);
  await page2.close();

  // 8. offline banner
  await ctx.setOffline(true); await wait(500);
  check('going offline shows the offline bar', await page.locator('[data-testid="offline-bar"]').isVisible());
  await ctx.setOffline(false); await wait(500);
  await wait(3500);
  check('coming back clears the offline bar', !(await page.locator('[data-testid="offline-bar"]').count()));
} catch (e) {
  failures++; console.log('FAIL  test crashed:', e.message.split('\n')[0]);
  console.log('page errors:', logs.filter((l) => l.startsWith('pageerror') || !/WebSocket/.test(l)).slice(0, 4));
  try { await page.screenshot({ path: 'e2e/notes-mock-crash.png' }); } catch { /* ignore */ }
}
await browser.close(); server.close();
console.log(failures ? `\n${failures} check(s) failed` : '\nAll notes-mock checks passed');
if (logs.length) console.log('browser errors:', logs.slice(0, 5));
process.exit(failures ? 1 : 0);

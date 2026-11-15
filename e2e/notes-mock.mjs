// Soft notes page against a fake in-memory API (no server, no database): tabs, folders, drafts, saving, delete + undo.
// Run:  npm run build:client  &&  node e2e/notes-mock.mjs
import http from 'http';
import fs from 'fs';
import path from 'path';
import { chromium } from 'playwright-core';

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
  mk('Kickoff notes', 'Agenda and questions', { meta: { folder: 'Project Alpha' } }),
  mk('Biology revision', 'Cell structure', {}),
  mk('', '# Plan for Monday\nbuy milk', {}),
];
const user = { id: 'u1', email: 'tester@peblo.test', name: 'Tester', settings: { uiStyle: 'soft', noteLayout: 'classic', noteFolders: [{ id: 'f1', name: 'Project Alpha', color: 'mint' }, { id: 'f2', name: 'Ideas', color: 'lilac' }] } };
const reqs = [];
let failPatches = 0;
// team features: off until section 9 turns them on, so the earlier checks still run in Personal
let teamOn = false;
let shareVerdict = { allowed: true };
const prefs = { muted: false };
const people = [{ id: 'u2', name: 'Ana Lee', avatar: null }, { id: 'u3', name: 'Bo Chen', avatar: null }];

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
  if (p === '/workspaces') return json(route, { me: { id: 'u1', name: 'Tester' }, orgs: teamOn ? [{ id: 'org1', name: 'Acme', status: 'active', role: 'owner', spaces: [{ id: 'team-x', kind: 'team', name: 'Design', role: 'lead', members: 3, defaultRole: 'member', publicLinks: true }] }] : [], invites: [] });
  if (p === '/workspaces/spaces/team-x/people-lite') return json(route, { people });
  if (p === '/workspaces/spaces/team-x/prefs') { if (method === 'PUT') prefs.muted = body.muted === true; return json(route, { muted: prefs.muted }); }
  if (p === '/workspaces/invites/lookup' && method === 'POST') return json(route, { state: 'ready', orgName: 'Acme', email: 'tester@peblo.test', inviterName: 'Ana Lee', role: 'member', signedInAs: 'tester@peblo.test' });
  if (p === '/workspaces/invites/mine') return json(route, { invites: [{ id: 'inv1', orgName: 'Acme', role: 'member', inviterName: 'Ana Lee', expiresAt: new Date(Date.now() + 5 * 86400000).toISOString(), expired: false }], verified: true, email: 'tester@peblo.test' });
  if (/^\/share\/note\/[^/]+\/allowed$/.test(p)) return json(route, shareVerdict);
  if (p === '/notes' && method === 'GET') {
    const q = Object.fromEntries(url.searchParams);
    let list = notes.filter((n) => (q.deleted ? n.isDeleted : !n.isDeleted) && (q.archived ? n.isArchived : !n.isArchived));
    if (q.search) list = list.filter((n) => (n.title + n.content).toLowerCase().includes(q.search.toLowerCase()));
    return json(route, { notes: list });
  }
  if (p === '/notes' && method === 'POST') { const n = mk(body.title || 'Untitled', body.content || '', { tags: body.tags || [], meta: body.meta || {} }); notes.unshift(n); return json(route, { note: n }, 201); }
  let m = /^\/notes\/([^/]+)$/.exec(p);
  if (m) {
    const n = notes.find((x) => x.id === m[1]);
    if (!n) return json(route, { error: 'nope' }, 404);
    if (method === 'GET') return json(route, { note: n });
    if (method === 'PATCH') {
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
  if (/^\/notes\/[^/]+\/backups/.test(p)) return json(route, { backups: [] });
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

  // 8. offline banner
  await ctx.setOffline(true); await wait(500);
  check('going offline shows the offline bar', await page.locator('[data-testid="offline-bar"]').isVisible());
  await ctx.setOffline(false); await wait(500);
  await wait(3500);
  check('coming back clears the offline bar', !(await page.locator('[data-testid="offline-bar"]').count()));

  // 9. a team space: @ offers people, a mention is stored as a link; mute is in the space menu; "Share link" is replaced by a reason when sharing is not allowed
  teamOn = true;
  await page.goto(`${base}/notes/n1`);
  await page.evaluate(() => localStorage.setItem('peblo-space', 'team-x'));
  await page.goto(`${base}/notes/n1`); await page.locator('textarea.s-note-title').waitFor(TO); await wait(900);
  await page.locator('.bn-editor[contenteditable="true"]').first().click(); await page.keyboard.press('End'); await page.keyboard.type(' @An'); await wait(900);
  const menuTxt = await page.locator('.bn-suggestion-menu').innerText().catch(() => '');
  check('typing @ in a team note lists the people of the team', menuTxt.includes('Ana Lee') && !menuTxt.includes('Bo Chen'), menuTxt);
  check('the people come under "Mention a person"', /mention a person/i.test(menuTxt), menuTxt);
  await page.keyboard.press('Enter'); await wait(2800);
  check('the mention shows as a chip in the editor', (await page.locator('.bn-editor a[href="peblo-user:u2"]').count()) === 1);
  check('the note is saved with the mention as a markdown link', notes.find((n) => n.id === 'n1').content.includes('[@Ana Lee](peblo-user:u2)'), notes.find((n) => n.id === 'n1').content);
  await page.goto(`${base}/notes/n1`); await page.locator('textarea.s-note-title').waitFor(TO); await wait(1200);
  check('the mention is still a chip after reopening the note', (await page.locator('.bn-editor a[href="peblo-user:u2"]').count()) === 1);
  // mute in the space pill menu
  await page.locator('[data-testid="space-pill"]').click(); await wait(300);
  await page.locator('[data-testid="space-mute"]').click(); await wait(500);
  check('"Mute this team" saves the preference', prefs.muted === true && reqs.some((r) => r.method === 'PUT' && r.path === '/workspaces/spaces/team-x/prefs' && r.body?.muted === true));
  await page.locator('[data-testid="space-pill"]').click(); await wait(300);
  check('the menu then offers to unmute', (await page.locator('[data-testid="space-mute"]').innerText()).includes('Unmute'));
  await page.keyboard.press('Escape');
  // share not allowed
  await page.getByRole('button', { name: 'More' }).click(); await wait(300);
  check('"Share link" is offered when sharing is allowed', (await page.locator('.s-menu').getByText('Share link').count()) > 0);
  await page.keyboard.press('Escape');
  shareVerdict = { allowed: false, code: 'org_policy', reason: 'Your organization has turned public links off.' };
  await page.goto(`${base}/notes/n1`); await page.locator('textarea.s-note-title').waitFor(TO); await wait(1200);
  await page.getByRole('button', { name: 'More' }).click(); await wait(300);
  check('"Share link" is hidden when sharing is not allowed', (await page.locator('.s-menu').getByText('Share link').count()) === 0);
  check('and the reason is shown instead', (await page.locator('[data-testid="share-blocked"]').innerText()).includes('turned public links off'));
  await page.keyboard.press('Escape');
  await page.evaluate(() => localStorage.removeItem('peblo-space')); teamOn = false;

  // 10. invites: the token is read from the URL fragment and removed from the address bar; an invite is also opened from the person's own list (no token anywhere)
  await page.goto(`${base}/invite#token=secret-token-123`); await page.locator('[data-testid="invite-accept"]').waitFor(TO); await wait(300);
  check('the invite token is removed from the address bar', !page.url().includes('secret-token-123'), page.url());
  const look = reqs.filter((r) => r.path === '/workspaces/invites/lookup').pop();
  check('the token goes in the request body, never in the query string', look?.body?.token === 'secret-token-123' && !Object.keys(look.q).length, JSON.stringify(look));
  await page.goto(`${base}/invite`); await page.locator('[data-testid="invite-list"]').waitFor(TO);
  check('/invite lists the invites waiting for the signed-in email', (await page.locator('[data-testid="invite-item"]').count()) === 1);
  await page.locator('[data-testid="invite-open-one"]').click(); await page.locator('[data-testid="invite-accept"]').waitFor(TO);
  const byId = reqs.filter((r) => r.path === '/workspaces/invites/lookup').pop();
  check('opening it from the list names the invite by id, not by token', byId?.body?.inviteId === 'inv1' && !byId.body.token, JSON.stringify(byId?.body));
} catch (e) {
  failures++; console.log('FAIL  test crashed:', e.message.split(String.fromCharCode(10)).slice(0, 5).join(' | '));
  console.log('page errors:', logs.filter((l) => l.startsWith('pageerror') || !/WebSocket/.test(l)).slice(0, 4));
  try { await page.screenshot({ path: 'e2e/notes-mock-crash.png' }); } catch { /* ignore */ }
}
await browser.close(); server.close();
console.log(failures ? `\n${failures} check(s) failed` : '\nAll notes-mock checks passed');
if (logs.length) console.log('browser errors:', logs.slice(0, 5));
process.exit(failures ? 1 : 0);

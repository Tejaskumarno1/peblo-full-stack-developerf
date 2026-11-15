// Full screen fixes (mistakes 3): zoom, hint timing, bar return delay, Ctrl+F layout and drag, layers, Office live editing.
import { boot, REPO } from './lib.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const b = await boot({ freshPresence: true });
const { base, api, page, ctx, check, finish, token } = b;
const shots = process.env.SHOTS || 'D:\\Peblo\\_shots';
try { fs.mkdirSync(shots, { recursive: true }); } catch {}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = (n) => page.screenshot({ path: path.join(shots, n) });
try {
  const n = await (async (r) => ({ id: r.note?.id || r.id }))(await api('POST', '/api/notes', { title: 'Zoom test', content: '# Heading\n\nThe quick brown fox jumps over the lazy dog. The fox again.\n\nSecond paragraph for the fox.' }));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() => { try { localStorage.removeItem('peblo-fs-hint'); } catch {} });
  await page.goto(base + '/notes/' + n.id);
  await page.locator('.bn-editor').waitFor({ timeout: 20000 });
  await wait(1200);
  await page.evaluate(() => { try { localStorage.removeItem('peblo-fs-hint'); localStorage.removeItem('peblo-fs-zoom'); } catch {} });
  await page.locator('button[aria-label="Full screen"]').click();
  await page.locator('[data-testid="fs-bar"]').waitFor(); await wait(600);

  // ---- hint disappears by itself
  check('the typing hint shows when full screen opens', await page.locator('[data-testid="fs-hint"]').isVisible());
  await shot('fx-hint.png');
  await wait(3600);
  check('the typing hint is gone after about three seconds', (await page.locator('[data-testid="fs-hint"]').count()) === 0);

  // ---- zoom
  const z = () => page.evaluate(() => ({ v: document.documentElement.style.getPropertyValue('--fs-zoom'), z: getComputedStyle(document.querySelector('.s-note-body')).zoom, w: document.querySelector('.s-note-body').getBoundingClientRect().width, s: localStorage.getItem('peblo-fs-zoom') }));
  const z0 = await z();
  check('zoom starts at 100%', z0.v === '1' && (await page.locator('[data-testid="fs-zoom-reset"]').innerText()).includes('100'), JSON.stringify(z0));
  await page.locator('[data-testid="fs-zoom-in"]').click(); await page.locator('[data-testid="fs-zoom-in"]').click(); await wait(200);
  const z1 = await z();
  check('the zoom button scales the page to 120%', z1.v === '1.2' && z1.s === '120' && Number(z1.z) > 1.1, JSON.stringify(z1));
  await shot('fx-zoom120.png');
  await page.locator('[data-testid="fs-zoom-out"]').click(); await wait(150);
  check('zoom out goes to 110%', (await z()).s === '110');
  await page.locator('.bn-editor').click();
  await page.keyboard.press('Control+Equal'); await wait(150);
  check('Ctrl plus zooms in', (await z()).s === '120');
  await page.keyboard.press('Control+Minus'); await page.keyboard.press('Control+Minus'); await wait(150);
  check('Ctrl minus zooms out', (await z()).s === '100');
  await page.mouse.move(700, 450);
  await page.keyboard.down('Control'); await page.mouse.wheel(0, -100); await page.mouse.wheel(0, -100); await page.keyboard.up('Control'); await wait(200);
  check('Ctrl and the wheel zoom the page', Number((await z()).s) >= 120, JSON.stringify(await z()));
  await page.keyboard.press('Control+0'); await wait(150);
  check('Ctrl 0 resets to 100%', (await z()).s === '100');
  for (let i = 0; i < 12; i++) await page.locator('[data-testid="fs-zoom-in"]').click({ force: true }).catch(() => {});
  check('zoom stops at 200%', (await z()).s === '200');
  await shot('fx-zoom200.png');
  await page.locator('[data-testid="fs-zoom-reset"]').click();
  await page.locator('[data-testid="fs-zoom-in"]').click(); await wait(150);
  await page.reload(); await page.locator('.bn-editor').waitFor({ timeout: 20000 });
  await page.locator('button[aria-label="Full screen"]').click(); await page.locator('[data-testid="fs-bar"]').waitFor(); await wait(500);
  check('the zoom is remembered after a reload', (await z()).s === '110', JSON.stringify(await z()));
  await page.locator('[data-testid="fs-zoom-reset"]').click();

  // ---- bar hides on typing, returns shortly after the mouse moves
  const shown = () => page.locator('.fsx').getAttribute('data-shown');
  await page.locator('.bn-editor p').first().click();
  await page.keyboard.type(' typed', { delay: 30 });
  await wait(2500);
  check('typing hides the bar', (await shown()) === '0');
  await page.mouse.move(300, 400); await page.mouse.move(340, 440);
  await wait(80);
  check('the bar does not pop back the instant the mouse moves', (await shown()) === '0');
  await wait(600);
  check('the bar comes back a moment after the mouse moves', (await shown()) === '1');
  await page.keyboard.type('x', { delay: 20 }); await wait(2500);
  check('typing hides the bar again', (await shown()) === '0');
  await page.mouse.move(500, 300); await page.mouse.move(540, 340); await wait(700);

  // ---- find bar: layout, drag, remembered, on screen
  await page.locator('[data-testid="fs-find"], button[aria-label="Find in note"], button[aria-label^="Find"]').first().click();
  await page.locator('[data-testid="find-bar"]').waitFor();
  await page.locator('input.q').fill('fox'); await wait(300);
  const box = () => page.locator('[data-testid="find-bar"]').boundingBox();
  const fb = await box();
  const ra = await page.locator('[data-testid="replace-all"]').boundingBox();
  const rr = await page.locator('[data-testid="replace-one"]').boundingBox();
  check('Replace and All sit inside the find bar', ra.x + ra.width <= fb.x + fb.width - 4 && rr.x >= fb.x && ra.x >= rr.x + rr.width - 1, JSON.stringify([fb, rr, ra]));
  check('the find bar is on screen', fb.x >= 0 && fb.y >= 0 && fb.x + fb.width <= 1440 && fb.y + fb.height <= 900);
  check('the match count shows', /1 of \d+/.test(await page.locator('.pb-find .n').innerText()));
  await shot('fx-find.png');
  const g = await page.locator('[data-testid="find-grip"]').boundingBox();
  await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2); await page.mouse.down(); await page.mouse.move(g.x - 380, g.y + 300, { steps: 10 }); await page.mouse.up(); await wait(200);
  const f2 = await box();
  check('the find bar moves where it is dragged', Math.abs(f2.x - (fb.x - 380)) < 30 && Math.abs(f2.y - (fb.y + 300)) < 30, JSON.stringify([fb, f2]));
  await shot('fx-find-dragged.png');
  const g2 = await page.locator('[data-testid="find-grip"]').boundingBox();
  await page.mouse.move(g2.x + g2.width / 2, g2.y + g2.height / 2); await page.mouse.down(); await page.mouse.move(2, 2, { steps: 8 }); await page.mouse.up(); await wait(200);
  const f3 = await box();
  check('the find bar never leaves the screen', f3.x >= 0 && f3.y >= 0, JSON.stringify(f3));
  await page.mouse.move(g2.x, g2.y); await page.mouse.down(); await page.mouse.up();
  await page.locator('button[aria-label="Close find"]').click();
  await page.locator('button[aria-label^="Find"]').first().click();
  await page.locator('[data-testid="find-bar"]').waitFor(); await wait(300);
  const f4 = await box();
  check('the find bar reopens where it was left (this session)', Math.abs(f4.x - f3.x) < 6 && Math.abs(f4.y - f3.y) < 6, JSON.stringify([f3, f4]));
  await page.locator('button[aria-label="Close find"]').click();

  // ---- layers in full screen
  const zs = await page.evaluate(() => {
    const out = {};
    for (const c of ['eb-toast', 'eb-back', 'mantine-Popover-dropdown', 'pb-find']) { const e = document.createElement('div'); e.className = c; document.body.appendChild(e); out[c] = Number(getComputedStyle(e).zIndex); e.remove(); }
    const bar = document.querySelector('.fsx'); out.fsx = Number(getComputedStyle(bar).zIndex); return out;
  });
  check('the edited-by card, its dialog, menus and find sit above the full screen layer', zs['eb-toast'] > zs.fsx && zs['eb-back'] > zs.fsx && zs['mantine-Popover-dropdown'] > zs.fsx && zs['pb-find'] > zs.fsx, JSON.stringify(zs));
  // formatting toolbar and its menu
  await page.locator('.bn-editor p').first().click({ clickCount: 3 });
  await page.locator('.bn-toolbar').waitFor({ timeout: 8000 });
  const tb = await page.locator('.bn-toolbar').boundingBox();
  check('the formatting toolbar shows over the page in full screen', tb && tb.width > 200);
  const top = await page.evaluate(() => { const r = document.querySelector('.bn-toolbar').getBoundingClientRect(); const e = document.elementFromPoint(r.left + 20, r.top + r.height / 2); return !!e?.closest('.bn-toolbar'); });
  check('nothing covers the formatting toolbar', top);
  await shot('fx-toolbar.png');
} catch (e) { console.log('ERROR', e.stack || e); await shot('fx-fail.png').catch(() => {}); console.log('URL', page.url(), (await page.locator('body').innerText().catch(() => '')).slice(0, 300)); check('no exception (page tests)', false, e.message); }

// ---- an Office note opens for live editing, for the author and for a person it was shared with
try {
  const { default: db } = await import(pathToFileURL(path.join(REPO, process.env.PEBLO_SERVER_DIST || 'dist', 'server', 'db.js')).href);
  const org = await api('POST', '/api/workspaces/orgs', { name: 'Live Co', start: 'team' });
  const off = await api('POST', `/api/workspaces/orgs/${org.id}/spaces`, { name: 'Live office', kind: 'office' });
  const link = await api('POST', `/api/workspaces/orgs/${org.id}/join-links`, { expiresInDays: 7, spaceId: off.id });
  const email = `ravi-${Date.now()}@peblo.test`;
  const su = await fetch(base + '/api/auth/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'correct horse battery', name: 'Ravi Kumar' }) }).then((x) => x.json());
  await db.user.updateMany({ where: { email }, data: { emailVerifiedAt: new Date() } });
  const tk = new URL(link.link).searchParams.get('token');
  await fetch(base + '/api/workspaces/join-links/accept', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${su.token}`, 'x-peblo-space': off.id }, body: JSON.stringify({ token: tk }) });
  const H = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'x-peblo-space': off.id };
  const on = await fetch(base + '/api/notes', { method: 'POST', headers: H, body: JSON.stringify({ title: 'Office live', content: 'Hello from the office' }) }).then((x) => x.json());
  const oid = on.note?.id || on.id;
  check('an Office note exists', !!oid, JSON.stringify(on).slice(0, 160));
  const sh = await fetch(base + `/api/notes/${oid}/access`, { method: 'PUT', headers: H, body: JSON.stringify({ people: [{ userId: su.user?.id || su.id, level: 'edit' }] }) });
  check('the note is shared with Ravi to edit', sh.ok, String(sh.status));
  // author in the browser
  await page.evaluate((id) => { try { localStorage.setItem('peblo-space', id); } catch {} }, off.id);
  await page.goto(base + '/notes/' + oid);
  await page.locator('.bn-editor').waitFor({ timeout: 20000 });
  await wait(4000);
  console.log('OFFICE status=', await page.locator('[data-testid="collab-status"]').allInnerTexts(), 'editors=', await page.locator('.bn-editor').count(), JSON.stringify(await page.locator('.bn-editor').allInnerTexts()));
  const st = await page.locator('[data-testid="collab-status"]').count();
  check('the Office note leaves "Connecting to live editing" for its author', st === 0, 'status toast still shown');
  check('the Office note shows its text', (await page.locator('.bn-editor').innerText()).includes('Hello from the office'));
  await shot('fx-office-author.png');
  // shared person: ticket + live socket
  const tkt = await fetch(base + '/api/collab/ticket', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${su.token}`, 'x-peblo-space': off.id }, body: JSON.stringify({ noteId: oid }) });
  const tj = await tkt.json().catch(() => ({}));
  check('a person with edit access gets a live editing pass', tkt.ok && !!tj.ticket && tj.readOnly === false, JSON.stringify(tj).slice(0, 120));
  if (tj.ticket) {
    const ok = await page.evaluate(({ u, t, n }) => new Promise((res) => { const w = new WebSocket(`${u}?note=${n}&ticket=${t}`); w.binaryType = 'arraybuffer'; const to = setTimeout(() => res('timeout'), 8000); w.onmessage = () => { clearTimeout(to); res('message'); w.close(); }; w.onclose = (e) => { clearTimeout(to); res('closed ' + e.code); }; }), { u: base.replace('http', 'ws') + '/collab', t: tj.ticket, n: oid });
    check('the shared editor can join the live room', ok === 'message', ok);
  }
} catch (e) { console.log('ERROR', e.stack || e); check('no exception (office)', false, e.message); }
await finish();

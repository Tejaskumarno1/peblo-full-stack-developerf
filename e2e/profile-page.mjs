// The Profile page and the picture crop dialog (docs/mockups/Profile.dc.html, Crop.dc.html), plus the profile / account API rules.
// Run for each style:  STYLE=soft|river|orbit node e2e/profile-page.mjs
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import { boot, REPO } from './lib.mjs';

const { base, api, page, check, finish, token } = await boot();
const SHOTS = process.env.PROFILE_SHOTS || '';
const shot = async (name) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, name + '.png') }); } };
const call = async (method, url, { token: t = token, body } = {}) => {
  const res = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: `Bearer ${t}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, json: await res.json().catch(() => ({})) };
};
const PW = 'correct horse battery';
const db = (await import(pathToFileURL(path.join(REPO, process.env.PEBLO_SERVER_DIST || 'dist', 'server', 'db.js')).href)).default;
const mkUser = async (tag) => {
  const email = `pf-${tag}-${Date.now()}@peblo.test`;
  const r = await call('POST', '/api/auth/signup', { token: null, body: { email, password: PW, name: 'Pf ' + tag } });
  return { email, token: r.json.token, id: r.json.user?.id };
};
const extra = [];
const UNAME = 'pg_' + (Date.now() % 100000000);
try {
  // ---- API rules
  let r = await call('PUT', '/api/profile', { body: { name: '   ' } });
  check('api: a whitespace-only name is refused (400), not stored as empty', r.status === 400 && /empty/i.test(r.json.error || ''), JSON.stringify(r));
  r = await call('PUT', '/api/profile', { body: { name: '  Ada   Lovelace ' } });
  check('api: a name is trimmed and tidied', r.status === 200 && r.json.user.name === 'Ada Lovelace', r.json.user?.name);
  r = await call('PUT', '/api/profile', { body: { username: '@Ada_L' } });
  check('api: username is saved lower-case without the @', r.status === 200 && r.json.user.username === 'ada_l', r.json.user?.username);
  const other = await mkUser('other'); extra.push(other.email);
  r = await call('PUT', '/api/profile', { token: other.token, body: { username: 'ADA_L' } });
  check('api: a taken username answers 409', r.status === 409, r.status);
  r = await call('PUT', '/api/profile', { body: { username: 'a' } });
  check('api: a too-short username answers 400', r.status === 400, r.status);
  r = await call('PUT', '/api/profile', { body: { username: '' } });
  check('api: an empty username clears it', r.status === 200 && r.json.user.username === null, r.json.user?.username);
  r = await call('PUT', '/api/profile', { body: { pronouns: 'she/her', language: 'en', bio: 'x'.repeat(400) } });
  check('api: pronouns, language and a 400 character About are saved', r.status === 200 && r.json.user.pronouns === 'she/her' && r.json.user.language === 'en' && r.json.user.bio.length === 400, r.status);
  r = await call('PUT', '/api/profile', { body: { bio: 'x'.repeat(401) } });
  check('api: About over 400 characters answers 400', r.status === 400, r.status);
  r = await call('PUT', '/api/profile', { body: { language: 'xx' } });
  check('api: an unknown language answers 400', r.status === 400, r.status);
  r = await call('PUT', '/api/profile', { body: { email: 'a@b..com', currentPassword: PW } });
  check('api: a malformed email (a@b..com) is refused', r.status === 400, r.status);
  const weak = [];
  for (const pw of ['        ', 'password1', 'PASSWORD', 'short']) weak.push((await call('POST', '/api/auth/signup', { token: null, body: { email: `weak-${Date.now()}@peblo.test`, password: pw, name: 'W' } })).status);
  check('api: sign-up refuses spaces-only, common and short passwords', weak.every((s) => s === 400), weak.join(','));
  r = await call('POST', '/api/auth/signup', { token: null, body: { email: 'x@y..com', password: PW } });
  check('api: sign-up refuses x@y..com', r.status === 400, r.status);
  r = await call('POST', '/api/auth/signup', { token: null, body: { email: `blankname-${Date.now()}@peblo.test`, password: PW, name: '   ' } });
  extra.push(r.json.user?.email);
  check('api: sign-up with a blank name falls back to the email name', r.status === 201 && !!r.json.user.name.trim(), r.json.user?.name);

  // password change
  const pu = await mkUser('pw'); extra.push(pu.email);
  r = await call('POST', '/api/auth/change-password', { token: pu.token, body: { currentPassword: PW, newPassword: PW } });
  check('api: changing to the same password answers 400', r.status === 400, r.status);
  const before = (await call('GET', '/api/profile', { token: pu.token })).json.user;
  check('api: passwordChangedAt starts empty', before.passwordChangedAt === null, before.passwordChangedAt);
  r = await call('POST', '/api/auth/change-password', { token: pu.token, body: { currentPassword: PW, newPassword: 'a brand new phrase' } });
  const pwTok = r.json.token;
  const after = (await call('GET', '/api/profile', { token: pwTok })).json.user;
  check('api: a password change records passwordChangedAt and returns a new token', r.status === 200 && !!after.passwordChangedAt && pwTok !== pu.token, r.status);

  // sign out others
  const so = await mkUser('so'); extra.push(so.email);
  const second = (await call('POST', '/api/auth/login', { token: null, body: { email: so.email, password: PW } })).json.token;
  r = await call('POST', '/api/auth/logout-others', { token: so.token });
  const keep = r.json.token;
  check('api: sign out others returns a fresh token for this device', r.status === 200 && !!keep, r.status);
  check('api: ..the other sign-ins stop working', (await call('GET', '/api/profile', { token: second })).status === 401 && (await call('GET', '/api/profile', { token: so.token })).status === 401);
  check('api: ..this device keeps working', (await call('GET', '/api/profile', { token: keep })).status === 200);

  // delete with a 30 day grace
  const du = await mkUser('del'); extra.push(du.email);
  await call('POST', '/api/notes', { token: du.token, body: { title: 'keep me', content: 'x' } });
  r = await call('POST', '/api/auth/schedule-deletion', { token: du.token, body: { password: 'wrong wrong wrong' } });
  check('api: schedule-deletion with a wrong password answers 403', r.status === 403, r.status);
  r = await call('POST', '/api/auth/schedule-deletion', { token: du.token, body: { password: PW } });
  check('api: schedule-deletion answers with a date 30 days out', r.status === 200 && Math.abs(new Date(r.json.deleteOn) - (Date.now() + 30 * 86400000)) < 120000, JSON.stringify(r.json));
  check('api: ..and signs every device out', (await call('GET', '/api/profile', { token: du.token })).status === 401);
  check('api: ..but the account still exists', (await db.user.count({ where: { email: du.email } })) === 1);
  r = await call('POST', '/api/auth/login', { token: null, body: { email: du.email, password: PW } });
  check('api: signing in again cancels the deletion', r.status === 200 && r.json.deletionCancelled === true && r.json.user.deletionRequestedAt === null, JSON.stringify(r.json).slice(0, 200));
  await call('POST', '/api/auth/schedule-deletion', { token: r.json.token, body: { password: PW } });
  const { purgeScheduledDeletions } = await import(pathToFileURL(path.join(REPO, process.env.PEBLO_SERVER_DIST || 'dist', 'server', 'services', 'accountDeletion.js')).href);
  check('purge: an account asked to be deleted 5 days ago is kept', (await purgeScheduledDeletions()) === 0 && (await db.user.count({ where: { email: du.email } })) === 1);
  await db.user.update({ where: { email: du.email }, data: { deletionRequestedAt: new Date(Date.now() - 31 * 86400000) } });
  const removed = await purgeScheduledDeletions();
  check('purge: after 31 days the account and its notes are removed', removed === 1 && (await db.user.count({ where: { email: du.email } })) === 0 && (await db.note.count({ where: { title: 'keep me' } })) === 0, removed);

  // ---- the page, loaded fresh (this is how the unstyled-crop bug showed up)
  await page.goto(base + '/settings/profile');
  await page.getByText('Your picture', { exact: true }).waitFor({ timeout: 20000 });
  await page.waitForTimeout(600);
  const heads = await page.locator('.pf-title').allInnerTexts();
  check('page: Your picture / Email / Sign-in and security cards', ['Your picture', 'Email', 'Sign-in and security'].every((h) => heads.includes(h)), heads.join('|'));
  const labels = await page.locator('.pf-fields .pf-field').evaluateAll((els) => els.map((e) => e.firstChild.textContent.trim()));
  check('page: fields are Display name, Username, Role, Pronouns, Time zone, Language', labels.join('|') === 'Display name|Username|Role|Pronouns|Time zone|Language', labels.join('|'));
  const rows = await page.locator('.pf-row-text b').allInnerTexts();
  check('page: security rows (no connected accounts: nothing backs it)', rows.join('|') === 'Password|Where you are signed in|Download your data|Delete account', rows.join('|'));
  check('page: the unconfirmed email shows the Not confirmed pill and a Send confirmation link button', (await page.locator('.pf-pill.warn').innerText()) === 'Not confirmed' && (await page.getByRole('button', { name: 'Send confirmation link' }).count()) === 1);
  check('page: header says Saved automatically', (await page.locator('.s-set-status').innerText()).includes('Saved automatically'));
  const card = await page.locator('.pf-card').first().evaluate((e) => { const c = getComputedStyle(e); return [c.borderRadius, c.paddingTop, c.backgroundColor].join(' '); });
  check('page: card is 24px radius, 24px padding, white', card === '24px 24px rgb(255, 255, 255)' || process.env.STYLE === 'orbit' || process.env.STYLE === 'river', card);
  await shot('profile-' + (process.env.STYLE || 'soft'));

  // fields save
  await page.locator('#set-role').fill('Designer'); await page.locator('#set-role').blur();
  await page.locator('#set-pronouns').fill('they/them'); await page.locator('#set-pronouns').blur();
  await page.locator('#set-username').fill('@' + UNAME); await page.locator('#set-username').blur();
  await page.locator('#set-bio').fill('Hello there'); await page.locator('#set-bio').blur();
  const zoneVal = await page.locator('#set-timezone option').evaluateAll((os) => (os.find((o) => /Europe\/Paris|Europe\/Berlin/.test(o.value)) || os[os.length - 1]).value);
  await page.locator('#set-timezone').selectOption(zoneVal);
  await page.waitForTimeout(1200);
  const me = (await api('GET', '/api/profile')).user;
  check('page: role, pronouns, username, about and time zone reach the account', me.jobTitle === 'Designer' && me.pronouns === 'they/them' && me.username === UNAME && me.bio === 'Hello there' && me.timezone === zoneVal, JSON.stringify([me.jobTitle, me.pronouns, me.username, me.bio, me.timezone]));
  check('page: About counter shows 11/400', (await page.locator('.pf-count').innerText()) === '11/400');
  const nm = page.locator('#set-name'); await nm.fill('   '); await nm.blur();
  await page.getByText('Your name cannot be empty.').waitFor({ timeout: 4000 }).catch(() => {});
  check('page: a blank name shows an error and nothing is saved', (await page.getByText('Your name cannot be empty.').count()) === 1 && (await api('GET', '/api/profile')).user.name === 'Ada Lovelace');
  await nm.fill('Page Tester'); await nm.blur(); await page.waitForTimeout(700);
  check('page: a good name saves', (await api('GET', '/api/profile')).user.name === 'Page Tester');
  await page.locator('#set-username').fill('@x'); await page.locator('#set-username').blur();
  await page.getByText(/Username can use letters/).waitFor({ timeout: 4000 }).catch(() => {});
  check('page: a bad username shows the server reason', (await page.getByText(/Username can use letters/).count()) === 1);

  // crop dialog
  const pngB64 = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 900; c.height = 600; const g = c.getContext('2d'); const gr = g.createLinearGradient(0, 0, 900, 600); gr.addColorStop(0, '#7ea7b8'); gr.addColorStop(1, '#8a5a44'); g.fillStyle = gr; g.fillRect(0, 0, 900, 600); g.fillStyle = '#fff'; g.fillRect(100, 100, 120, 120); return c.toDataURL('image/png').split(',')[1]; });
  const tmp = path.join(process.env.TEMP || '.', `pf-crop-${Date.now()}.png`);
  fs.writeFileSync(tmp, Buffer.from(pngB64, 'base64'));
  await page.locator('input[type=file]').first().setInputFiles(tmp);
  const dlg = page.getByRole('dialog', { name: 'Crop your picture' });
  await dlg.waitFor({ timeout: 8000 });
  await page.waitForTimeout(400);
  const st = await dlg.locator('.pb-crop').evaluate((e) => { const c = getComputedStyle(e); return { w: e.getBoundingClientRect().width, r: c.borderRadius, bg: c.backgroundColor, ff: c.fontFamily }; });
  check('crop: the dialog is styled on a fresh page load (584px wide, 28px radius, cream)', st.w === 584 && st.r === '28px' && st.bg === 'rgb(255, 253, 248)', JSON.stringify(st));
  check('crop: stage 340px high, 3 preview chips, 1:1 note', (await dlg.locator('.pb-crop-stage').evaluate((e) => e.getBoundingClientRect().height)) === 340 && (await dlg.locator('.pb-crop-chip').count()) === 3 && (await dlg.getByText('Square 1:1, saved at 512 by 512').count()) === 1);
  const names = await dlg.getByRole('button').allInnerTexts();
  check('crop: Choose another, Reset, Cancel, Save picture are there', ['Choose another', 'Reset', 'Cancel', 'Save picture'].every((n) => names.includes(n)), names.join('|'));
  check('crop: rotate, flip and zoom controls exist; no aspect choices', (await dlg.getByRole('button', { name: 'Rotate left' }).count()) === 1 && (await dlg.getByRole('button', { name: 'Flip' }).count()) === 1 && (await dlg.getByRole('slider', { name: 'Zoom' }).count()) === 1 && (await dlg.getByText('Portrait').count()) === 0);
  await shot('crop-' + (process.env.STYLE || 'soft'));
  const imgBox = () => dlg.locator('.pb-crop-stage > img').evaluate((e) => { const b = e.getBoundingClientRect(); return [Math.round(b.width), Math.round(b.height), Math.round(b.x)]; });
  const b0 = await imgBox();
  await dlg.getByRole('slider', { name: 'Zoom' }).fill('2');
  const b1 = await imgBox();
  check('crop: the zoom slider enlarges the picture', b1[0] > b0[0] * 1.9, JSON.stringify([b0, b1]));
  const stage = dlg.locator('.pb-crop-stage'); const sb = await stage.boundingBox();
  await page.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2); await page.mouse.down(); await page.mouse.move(sb.x + sb.width / 2 - 80, sb.y + sb.height / 2, { steps: 5 }); await page.mouse.up();
  const b2 = await imgBox();
  check('crop: dragging moves the picture', b2[2] < b1[2] - 40, JSON.stringify([b1, b2]));
  await page.mouse.move(sb.x + 60, sb.y + 60); await page.mouse.wheel(0, 300);
  const b3 = await imgBox();
  check('crop: the mouse wheel zooms', b3[0] < b2[0], JSON.stringify([b2, b3]));
  await dlg.getByRole('button', { name: 'Rotate left' }).click();
  const b4 = await imgBox();
  check('crop: rotate swaps the picture\'s width and height on screen', b4[0] !== b3[0] || b4[1] !== b3[1]);
  await dlg.getByRole('button', { name: 'Flip' }).click();
  check('crop: flip is pressed', (await dlg.getByRole('button', { name: 'Flip' }).getAttribute('aria-pressed')) === 'true');
  await dlg.getByRole('button', { name: 'Reset' }).click();
  const b5 = await imgBox();
  check('crop: Reset restores the first view', b5[0] === b0[0] && b5[1] === b0[1] && (await dlg.getByRole('slider', { name: 'Zoom' }).inputValue()) === '1' && (await dlg.getByRole('button', { name: 'Flip' }).getAttribute('aria-pressed')) === 'false', JSON.stringify([b0, b5]));
  await dlg.getByRole('button', { name: 'Save picture' }).click();
  await dlg.waitFor({ state: 'detached', timeout: 15000 });
  await page.waitForTimeout(500);
  const av = (await api('GET', '/api/profile')).user.avatar;
  const dims = await page.evaluate((src) => new Promise((ok) => { const i = new Image(); i.onload = () => ok([i.naturalWidth, i.naturalHeight]); i.onerror = () => ok([0, 0]); i.src = src; }), av);
  check('crop: the saved picture is a 512 by 512 WebP', /^data:image\/webp;base64,/.test(av || '') && dims[0] === 512 && dims[1] === 512, dims.join('x'));
  check('page: the picture shows on the page', (await page.locator('.pf-av.l img').count()) === 1);
  await page.getByRole('button', { name: 'Remove' }).click(); await page.waitForTimeout(700);
  check('page: Remove clears the picture', (await api('GET', '/api/profile')).user.avatar == null);

  // Escape and Cancel
  await page.locator('input[type=file]').first().setInputFiles(tmp);
  await dlg.waitFor({ timeout: 8000 });
  await page.keyboard.press('Escape');
  check('crop: Escape closes it without saving', (await dlg.count()) === 0 && (await api('GET', '/api/profile')).user.avatar == null);
  fs.unlinkSync(tmp);

  // security card
  await page.getByRole('button', { name: 'Change', exact: true }).click();
  check('page: Change opens the password form', (await page.locator('#set-pw0').count()) === 1);
  await page.getByRole('button', { name: 'Cancel' }).first().click();
  await page.getByRole('button', { name: 'Sign out others' }).click();
  check('page: Sign out others asks first', (await page.getByRole('button', { name: 'Yes' }).count()) === 1);
  await page.getByRole('button', { name: 'Cancel' }).first().click();
  const dl = page.waitForEvent('download', { timeout: 15000 });
  await page.getByRole('button', { name: 'Export' }).click();
  const file = await dl;
  const text = fs.readFileSync(await file.path(), 'utf8');
  check('page: Export downloads a backup with notes, tasks and the profile', /peblo-backup-\d{4}-\d{2}-\d{2}\.json/.test(file.suggestedFilename()) && /"profile"/.test(text) && /"todos"/.test(text), file.suggestedFilename());
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await page.locator('#set-delword').fill('DELETE'); await page.locator('#set-delpw').fill('wrong wrong wrong');
  await page.getByRole('button', { name: 'Delete my account' }).click();
  await page.getByRole('alert').filter({ hasText: 'not correct' }).waitFor({ timeout: 8000 }).catch(() => {});
  check('page: delete with a wrong password shows a message and keeps the account', (await page.getByRole('alert').filter({ hasText: 'not correct' }).count()) >= 1 && (await api('GET', '/api/profile')).user?.email);
  await page.locator('#set-delpw').fill(PW + 'x'); // still wrong; then the right one
  await page.locator('#set-delpw').fill('correct horse battery');
  await page.getByRole('button', { name: 'Delete my account' }).click();
  await page.waitForFunction(() => !localStorage.getItem('peblo-token'), null, { timeout: 15000 }).catch(() => {});
  check('page: deleting signs this device out', await page.evaluate(() => !localStorage.getItem('peblo-token')));
  const row = await db.user.findFirst({ where: { name: 'Page Tester' }, select: { deletionRequestedAt: true } });
  check('page: ..and the account is scheduled for deletion, not gone', !!row?.deletionRequestedAt);
} catch (e) { console.error(e); check('script ran to the end', false, e.message); }
try { await db.user.deleteMany({ where: { name: 'Page Tester' } }); } catch {}
for (const m of extra) { try { if (m) await db.user.deleteMany({ where: { email: m } }); } catch {} }
await finish();

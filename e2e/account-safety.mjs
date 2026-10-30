// Account safety: password reset, WebSocket tickets (no sign-in token in the address), enumeration-safe sign-up.
// Real compiled server (boot) on the test database, plain fetch/WebSocket, plus a browser check of the new screens.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { pathToFileURL } from 'url';
import WebSocket from 'ws';

process.env.PEBLO_FORGOT_IP_MAX = '60';
process.env.PEBLO_RESET_RATE_MAX = '100';
process.env.PEBLO_TICKET_TTL_MS = '2500';
process.env.PEBLO_SIGNUP_EMAIL_MAX = '5';
const { boot, REPO } = await import('./lib.mjs');
const { base, api, ctx, check, finish, token: bootToken } = await boot();
const dist = path.join(REPO, process.env.PEBLO_SERVER_DIST || 'dist', 'server');
const { default: prisma } = await import(pathToFileURL(path.join(dist, 'db.js')).href);
const safety = await import(pathToFileURL(path.join(dist, 'services', 'accountSafety.js')).href);

const OUTBOX = path.join(os.tmpdir(), `peblo-acct-outbox-${Date.now()}.jsonl`);
const tag = Date.now().toString(36);
const PW = 'correct horse battery';
const created = [];
const post = async (url, body, tok, extra = {}) => {
  const t0 = Date.now();
  const r = await fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}), ...extra }, body: JSON.stringify(body ?? {}) });
  return { status: r.status, json: await r.json().catch(() => ({})), ms: Date.now() - t0, headers: r.headers };
};
const get = async (url, tok) => { const r = await fetch(base + url, { headers: tok ? { Authorization: `Bearer ${tok}` } : {} }); return { status: r.status, json: await r.json().catch(() => ({})) }; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mails = () => (fs.existsSync(OUTBOX) ? fs.readFileSync(OUTBOX, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const mailsTo = (email) => mails().filter((m) => m.to === email);
const linkOf = (m) => (m && (m.text.match(/token=([A-Za-z0-9_-]+)/) || [])[1]) || '';
const waitMail = async (email, n = 1, ms = 4000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (mailsTo(email).length >= n) return mailsTo(email)[n - 1]; await sleep(60); } return null; };
const mailOn = () => { process.env.MAIL_OUTBOX = OUTBOX; };
const mailOff = () => { delete process.env.MAIL_OUTBOX; };
const mkUser = async (name) => {
  const email = `acct-${name}-${tag}@peblo.test`;
  mailOff(); // plain sign-up (no mail transport)
  const r = await post('/api/auth/signup', { email, password: PW, name });
  created.push(email);
  return { email, token: r.json.token, id: r.json.user?.id, status: r.status };
};
const login = (email, password) => post('/api/auth/login', { email, password });
const avg = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

try {
  // ---------- no mail transport: today's behaviour ----------
  const a = await mkUser('plain');
  check('signup without mail: 201 + token', a.status === 201 && !!a.token, a.status);
  const dup = await post('/api/auth/signup', { email: a.email, password: PW, name: 'x' });
  check('signup without mail: duplicate still 409', dup.status === 409, dup.status);
  const f0a = await post('/api/auth/forgot-password', { email: a.email });
  const f0b = await post('/api/auth/forgot-password', { email: `nobody-${tag}@peblo.test` });
  check('forgot without mail: known and unknown answer the same', f0a.status === 200 && f0a.status === f0b.status && JSON.stringify(f0a.json) === JSON.stringify(f0b.json), JSON.stringify([f0a.status, f0a.json, f0b.status, f0b.json]));
  await sleep(300);
  check('forgot without mail: nothing was stored', (await prisma.$queryRawUnsafe('SELECT 1 FROM password_resets WHERE user_id = $1', a.id)).length === 0);

  // ---------- forgot password, mail on ----------
  const known = await mkUser('known');
  mailOn();
  const times = { k: [], u: [] };
  let same = true; let body0 = null;
  for (let i = 0; i < 2; i++) {
    const k = await post('/api/auth/forgot-password', { email: known.email });
    const u = await post('/api/auth/forgot-password', { email: `ghost${i}-${tag}@peblo.test` });
    times.k.push(k.ms); times.u.push(u.ms);
    body0 = body0 || JSON.stringify(k.json);
    if (k.status !== 200 || u.status !== 200 || JSON.stringify(k.json) !== body0 || JSON.stringify(u.json) !== body0) same = false;
  }
  check('forgot: identical status and body for known and unknown email', same, body0);
  check('forgot: similar response time for known and unknown email', Math.abs(avg(times.k) - avg(times.u)) < 150, JSON.stringify(times));
  const m1 = await waitMail(known.email);
  const m2 = await waitMail(known.email, 2);
  check('forgot: known address got the reset mails, unknown got none', !!m1 && /reset/i.test(m1.subject) && mailsTo(known.email).length === 2 && mailsTo(`ghost0-${tag}@peblo.test`).length === 0 && mailsTo(`ghost1-${tag}@peblo.test`).length === 0);
  check('forgot: link uses the public address and carries a 43-char secret', !!m1 && m1.text.includes(`${base}/reset-password?token=`) && linkOf(m1).length === 43, m1?.text?.slice(0, 200));
  const t1 = linkOf(m1), t2 = linkOf(m2);
  const rOld = await post('/api/auth/reset-password', { token: t1, password: 'brand new password 1' });
  check('an older reset link stops working when a newer one is requested', rOld.status === 400 && /not valid or has expired/.test(rOld.json.error || ''), JSON.stringify(rOld.json));
  const stored = await prisma.$queryRawUnsafe('SELECT token_hash, expires_at FROM password_resets WHERE user_id = $1', known.id);
  const life = stored.length ? new Date(stored[0].expires_at).getTime() - Date.now() : 0;
  check('only the SHA-256 is stored; 30 minute expiry; one row per user', stored.length === 1 && stored[0].token_hash !== t2 && stored[0].token_hash === safety.hashOf(t2) && life > 28 * 60e3 && life <= 30 * 60e3, `${stored.length} ${life}`);

  // per-email rate limit (same for an address with no account, and case-insensitive)
  const rl = []; for (let i = 0; i < 4; i++) rl.push((await post('/api/auth/forgot-password', { email: i % 2 ? `LIMIT-${tag}@peblo.test` : `limit-${tag}@peblo.test` })).status);
  check('forgot: per-email rate limit answers 429 (unknown address too)', rl.join() === '200,200,200,429', rl.join());
  const rlk = []; for (let i = 0; i < 2; i++) rlk.push((await post('/api/auth/forgot-password', { email: known.email })).status);
  check('forgot: the per-email limit also applies to a real account', rlk.join() === '200,429', rlk.join()); // two requests earlier + one here = the limit of three

  // ---------- reset happy path ----------
  const u = await mkUser('reset');
  const pat = (await post('/api/tokens', { name: 'cli' }, u.token)).json.token;
  check('setup: PAT and JWT both work before the reset', (await get('/api/notes', pat)).status === 200 && (await get('/api/profile', u.token)).status === 200);
  mailOn();
  await post('/api/auth/forgot-password', { email: u.email });
  const tok = linkOf(await waitMail(u.email));
  const weak = await post('/api/auth/reset-password', { token: tok, password: 'short' });
  check('reset: weak password is refused with the signup message', weak.status === 400 && /at least 8/.test(weak.json.error || ''), JSON.stringify(weak.json));
  const long = await post('/api/auth/reset-password', { token: tok, password: 'x'.repeat(80) });
  check('reset: over-long password is refused', long.status === 400 && /too long/.test(long.json.error || ''), JSON.stringify(long.json));
  const tamper = tok.slice(0, -1) + (tok.endsWith('A') ? 'B' : 'A');
  const tm = await post('/api/auth/reset-password', { token: tamper, password: 'a brand new password' });
  check('reset: tampered token is refused', tm.status === 400 && /not valid or has expired/.test(tm.json.error || ''), JSON.stringify(tm.json));
  const junk = [];
  for (const body of [{ token: '', password: 'a brand new password' }, { token: 'abc', password: 'a brand new password' }, { password: 'a brand new password' }, { token: { $ne: 1 }, password: 'a brand new password' }, { token: tok.toUpperCase(), password: 'a brand new password' }]) junk.push((await post('/api/auth/reset-password', body)).status);
  check('reset: empty/short/missing/object/wrong-case token are refused', junk.every((s) => s === 400), junk.join());
  check('reset: failed attempts did not use up the real link', (await prisma.$queryRawUnsafe('SELECT 1 FROM password_resets WHERE user_id = $1', u.id)).length === 1);
  const NEW = 'a brand new password';
  const ok = await post('/api/auth/reset-password', { token: tok, password: NEW });
  check('reset: happy path answers 200 ok', ok.status === 200 && ok.json.ok === true, JSON.stringify(ok.json));
  check('reset: old password stops working', (await login(u.email, PW)).status === 401);
  const nl = await login(u.email, NEW);
  check('reset: new password works', nl.status === 200 && !!nl.json.token);
  check('reset: old JWT stops working (tokenVersion)', (await get('/api/profile', u.token)).status === 401);
  check('reset: access tokens are revoked', (await get('/api/notes', pat)).status === 401 && (await prisma.apiToken.count({ where: { userId: u.id } })) === 0);
  check('reset: the new sign-in token works', (await get('/api/profile', nl.json.token)).status === 200);
  const reuse = await post('/api/auth/reset-password', { token: tok, password: 'yet another password' });
  check('reset: a used link cannot be used again', reuse.status === 400 && (await login(u.email, NEW)).status === 200 && (await login(u.email, 'yet another password')).status === 401);
  check('reset: no reset rows left for the user', (await prisma.$queryRawUnsafe('SELECT 1 FROM password_resets WHERE user_id = $1', u.id)).length === 0);

  // expired link
  const e = await mkUser('expired');
  mailOn();
  await post('/api/auth/forgot-password', { email: e.email });
  const et = linkOf(await waitMail(e.email));
  await prisma.$executeRawUnsafe("UPDATE password_resets SET expires_at = (now() AT TIME ZONE 'UTC') - interval '1 minute' WHERE user_id = $1", e.id);
  const ex = await post('/api/auth/reset-password', { token: et, password: 'a brand new password' });
  check('reset: an expired link is refused and the old password still works', ex.status === 400 && (await login(e.email, PW)).status === 200, JSON.stringify(ex.json));
  await prisma.$executeRawUnsafe("INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES ($1, 'sweepme', (now() AT TIME ZONE 'UTC') - interval '3 hours')", e.id);
  await safety.sweepAccountRows();
  check('retention: expired rows are swept', (await prisma.$queryRawUnsafe("SELECT 1 FROM password_resets WHERE token_hash = 'sweepme'")).length === 0);

  // login: generic message and timing
  const lu = await login(u.email, 'wrong password 1'); const ln = await login(`nobody2-${tag}@peblo.test`, 'wrong password 1');
  check('login: wrong password and unknown email give the same message', lu.status === 401 && ln.status === 401 && lu.json.error === ln.json.error, `${lu.json.error} | ${ln.json.error}`);
  check('login: similar timing for known and unknown email', Math.abs(lu.ms - ln.ms) < 250, `${lu.ms} vs ${ln.ms}`);

  // voluntary change-password: PATs stay, other sessions go
  const c = await mkUser('change');
  const cpat = (await post('/api/tokens', { name: 'keep' }, c.token)).json.token;
  const cp = await post('/api/auth/change-password', { currentPassword: PW, newPassword: 'changed password 99' }, c.token);
  check('change-password: returns a fresh token', cp.status === 200 && !!cp.json.token);
  check('change-password: old JWT stops, new JWT works, PAT is kept', (await get('/api/profile', c.token)).status === 401 && (await get('/api/profile', cp.json.token)).status === 200 && (await get('/api/notes', cpat)).status === 200);
  const cw = await post('/api/auth/change-password', { currentPassword: 'changed password 99', newPassword: 'short' }, cp.json.token);
  check('change-password: same password rules', cw.status === 400 && /at least 8/.test(cw.json.error || ''), JSON.stringify(cw.json));

  // ---------- sign-up with mail configured ----------
  mailOn();
  const sEmail = `new-${tag}@peblo.test`;
  const s1 = await post('/api/auth/signup', { email: sEmail, password: PW, name: 'Newbie' });
  const sx = await post('/api/auth/signup', { email: a.email, password: PW, name: 'Intruder' });
  check('signup with mail: new and existing address get the same status and body', s1.status === 202 && sx.status === 202 && JSON.stringify(s1.json) === JSON.stringify(sx.json) && !s1.json.token, JSON.stringify([s1.status, s1.json, sx.status, sx.json]));
  const sm = await waitMail(sEmail); const nm = await waitMail(a.email);
  check('signup with mail: new address got a finish-signing-up link', !!sm && /Finish signing up/.test(sm.subject) && !!linkOf(sm), sm?.subject);
  check('signup with mail: existing address got a "someone tried" notice without a secret link', !!nm && /tried to sign up/.test(nm.subject) && !linkOf(nm), nm?.subject);
  mailOff();
  check('signup with mail: no account exists until the link is opened', (await login(sEmail, PW)).status === 401 && (await prisma.user.count({ where: { email: sEmail } })) === 0);
  const al = await login(a.email, PW);
  check('signup with mail: the existing account was not touched', al.status === 200 && al.json.user?.name === 'plain');
  check('signup with mail: similar response time for new and existing address', Math.abs(s1.ms - sx.ms) < 400, `${s1.ms} vs ${sx.ms}`);
  const sTok = linkOf(sm);
  const sv = await post('/api/auth/verify-email', { token: sTok });
  created.push(sEmail);
  check('signup link creates the account (verified)', sv.status === 200 && sv.json.kind === 'signup' && sv.json.email === sEmail && !!(await prisma.user.findUnique({ where: { email: sEmail } }))?.emailVerifiedAt, JSON.stringify(sv.json));
  const sl = await login(sEmail, PW);
  check('signup: the password chosen at sign-up works', sl.status === 200 && sl.json.user?.name === 'Newbie');
  check('signup link works only once', (await post('/api/auth/verify-email', { token: sTok })).status === 400);
  mailOn();
  await post('/api/auth/signup', { email: `exp-${tag}@peblo.test`, password: PW, name: 'E' });
  const xt = linkOf(await waitMail(`exp-${tag}@peblo.test`));
  await prisma.$executeRawUnsafe("UPDATE pending_signups SET expires_at = (now() AT TIME ZONE 'UTC') - interval '1 second' WHERE email = $1", `exp-${tag}@peblo.test`);
  check('signup link expires', (await post('/api/auth/verify-email', { token: xt })).status === 400);
  check('signup with mail: weak password still 400', (await post('/api/auth/signup', { email: `weak-${tag}@peblo.test`, password: 'short', name: 'W' })).status === 400);
  const spam = []; for (let i = 0; i < 6; i++) spam.push((await post('/api/auth/signup', { email: `spam-${tag}@peblo.test`, password: PW, name: 'S' })).status);
  check('signup with mail: per-email limit answers 429', spam.slice(0, 5).every((x) => x === 202) && spam[5] === 429, spam.join());
  mailOff();

  // ---------- live-editing tickets ----------
  const owner = await mkUser('wsown'); const other = await mkUser('wsother');
  const mkNote = async (tk, title) => (await (await fetch(base + '/api/notes', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tk}` }, body: JSON.stringify({ title, content: 'hello', tags: [] }) })).json()).note;
  const n1 = await mkNote(owner.token, 'one'); const n2 = await mkNote(owner.token, 'two'); const n3 = await mkNote(other.token, 'theirs');
  const ticketFor = (tk, noteId) => post('/api/collab/ticket', { noteId }, tk);
  const wsTry = (qs) => new Promise((resolve) => {
    const ws = new WebSocket(`${base.replace('http', 'ws')}/collab?${qs}`);
    let done = false; const end = (v) => { if (done) return; done = true; try { ws.close(); } catch {} resolve(v); };
    ws.on('open', () => end('open'));
    ws.on('unexpected-response', (_q, res) => end(res.statusCode));
    ws.on('error', () => setTimeout(() => end('error'), 50));
    setTimeout(() => end('timeout'), 6000);
  });
  const t = await ticketFor(owner.token, n1.id);
  check('ticket: issued to the signed-in owner, not cacheable', t.status === 200 && (t.json.ticket || '').length === 43 && /no-store/.test(t.headers.get('cache-control') || ''));
  check('ticket: requires sign-in', (await ticketFor(null, n1.id)).status === 401);
  check('ticket: cannot be issued for someone else\'s note or a missing note', (await ticketFor(other.token, n1.id)).status === 404 && (await ticketFor(owner.token, 'does-not-exist')).status === 404 && (await ticketFor(owner.token, n3.id)).status === 404);
  check('ws: happy path opens with the ticket', (await wsTry(`note=${n1.id}&ticket=${t.json.ticket}`)) === 'open');
  check('ws: the same ticket cannot be used twice', (await wsTry(`note=${n1.id}&ticket=${t.json.ticket}`)) === 401);
  const tb = (await ticketFor(owner.token, n1.id)).json.ticket;
  check('ws: a ticket for note one does not open note two (and is then used up)', (await wsTry(`note=${n2.id}&ticket=${tb}`)) === 401 && (await wsTry(`note=${n1.id}&ticket=${tb}`)) === 401);
  const to = (await ticketFor(other.token, n3.id)).json.ticket;
  check('ws: another person\'s ticket cannot open my note', (await wsTry(`note=${n1.id}&ticket=${to}`)) === 401);
  const te = (await ticketFor(owner.token, n1.id)).json.ticket;
  await sleep(2800);
  check('ws: an expired ticket is refused', (await wsTry(`note=${n1.id}&ticket=${te}`)) === 401);
  check('ws: no ticket is refused', (await wsTry(`note=${n1.id}`)) === 401);
  check('ws: a made-up ticket is refused', (await wsTry(`note=${n1.id}&ticket=${'A'.repeat(43)}`)) === 401);
  check('ws: the sign-in token in the address is no longer accepted', (await wsTry(`note=${n1.id}&token=${encodeURIComponent(owner.token)}`)) === 401 && (await wsTry(`note=${n1.id}&token=${encodeURIComponent(owner.token)}&ticket=x`)) === 401);
  const patWs = (await post('/api/tokens', { name: 'ws' }, owner.token)).json.token;
  check('ws: an access token in the address is not accepted either', (await wsTry(`note=${n1.id}&token=${encodeURIComponent(patWs)}`)) === 401);
  const ro = (await post('/api/tokens', { name: 'ro', scope: 'read' }, owner.token)).json.token;
  check('ticket: a read-only access token cannot get one', (await ticketFor(ro, n1.id)).status === 403);

  // ---------- browser: the new screens in the three styles, and no token in the live-editing address ----------
  const browser = ctx.browser();
  for (const style of ['soft', 'river', 'orbit']) {
    for (const vp of [{ width: 1280, height: 800 }, { width: 390, height: 780 }]) {
      const c2 = await browser.newContext({ viewport: vp });
      await c2.addInitScript((st) => { try { localStorage.setItem('peblo-style', st); } catch {} }, style);
      const pg = await c2.newPage();
      const errs = []; pg.on('pageerror', (er) => errs.push(er.message));
      await pg.goto(base + '/');
      await pg.getByRole('button', { name: 'Forgot password?' }).waitFor({ timeout: 15000 });
      const noOverflow = await pg.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
      await pg.getByRole('button', { name: 'Forgot password?' }).click();
      await pg.getByRole('heading', { name: 'Reset your password' }).waitFor();
      await pg.locator('input[type=email]').fill(`browser-${style}-${vp.width}-${tag}@peblo.test`);
      await pg.getByRole('button', { name: 'Send reset link' }).click();
      await pg.getByRole('heading', { name: 'Check your email' }).waitFor({ timeout: 10000 });
      const msg = await pg.locator('.pb-auth-done .pb-auth-sub').innerText();
      check(`browser ${style} ${vp.width}: forgot screen works, generic message, no overflow`, /If an account exists/.test(msg) && noOverflow, msg);
      await pg.goto(base + '/reset-password?token=' + 'Z'.repeat(43));
      await pg.getByRole('heading', { name: 'Choose a new password' }).waitFor({ timeout: 10000 });
      const urlNow = pg.url();
      const card = await pg.locator('.pb-auth-card').boundingBox();
      const fits = !!card && card.x >= 0 && card.x + card.width <= vp.width + 1 && await pg.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
      const iconsOnly = !(await pg.locator('.pb-auth').innerText()).match(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
      check(`browser ${style} ${vp.width}: reset page fits the viewport, secret removed from the address, no emoji`, fits && !urlNow.includes('token=') && iconsOnly, urlNow);
      const inputs = pg.locator('input[type=password]');
      await inputs.nth(0).fill('short'); await inputs.nth(1).fill('short');
      await pg.getByRole('button', { name: 'Change password' }).click();
      const e1 = await pg.locator('.pb-auth-error').innerText();
      await inputs.nth(0).fill('a brand new password'); await inputs.nth(1).fill('different one 12345');
      await pg.getByRole('button', { name: 'Change password' }).click();
      const e2 = await pg.locator('.pb-auth-error').innerText();
      check(`browser ${style} ${vp.width}: reset form validates length and match`, /at least 8/.test(e1) && /do not match/.test(e2), `${e1} | ${e2}`);
      await inputs.nth(1).fill('a brand new password');
      await pg.getByRole('button', { name: 'Change password' }).click();
      await pg.waitForFunction(() => /not valid or has expired/.test(document.querySelector('.pb-auth-error')?.textContent || ''), null, { timeout: 15000 });
      check(`browser ${style} ${vp.width}: a bad link shows the server's generic error`, true);
      if (style === 'soft' && vp.width === 1280) await pg.screenshot({ path: path.join(os.tmpdir(), 'peblo-acct-reset-soft.png') });
      if (style === 'orbit' && vp.width === 390) await pg.screenshot({ path: path.join(os.tmpdir(), 'peblo-acct-reset-orbit-390.png') });
      check(`browser ${style} ${vp.width}: no page errors`, errs.length === 0, errs.join('; '));
      await c2.close();
    }
  }
  { // a real reset through the browser
    const bu = await mkUser('browserreset');
    mailOn();
    await post('/api/auth/forgot-password', { email: bu.email });
    const bt = linkOf(await waitMail(bu.email));
    mailOff();
    const c2 = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const pg = await c2.newPage();
    await pg.goto(`${base}/reset-password?token=${bt}`);
    await pg.locator('input[type=password]').nth(0).fill('browser new password');
    await pg.locator('input[type=password]').nth(1).fill('browser new password');
    await pg.getByRole('button', { name: 'Change password' }).click();
    await pg.getByRole('heading', { name: 'Password changed' }).waitFor({ timeout: 15000 });
    check('browser: a real reset link changes the password', (await login(bu.email, 'browser new password')).status === 200 && (await login(bu.email, PW)).status === 401);
    await pg.getByRole('link', { name: 'Go to sign in' }).click();
    await pg.getByRole('heading', { name: 'Welcome back' }).waitFor({ timeout: 15000 });
    await c2.close();
  }
  { // the live-editing socket in a real page carries a ticket, never the sign-in token
    const note = (await api('POST', '/api/notes', { title: 'Ticket check', content: 'hello there', tags: [] })).note;
    const pg = await ctx.newPage();
    const urls = []; let frames = 0; let sent = 0;
    pg.on('websocket', (w) => { urls.push(w.url()); w.on('framereceived', () => { frames++; }); w.on('framesent', () => { sent++; }); });
    await pg.addInitScript(() => { try { localStorage.setItem('peblo-style', 'studio'); } catch { /* ignore */ } });
    await pg.goto(`${base}/notes/${note.id}`);
    await pg.locator('.bn-editor').waitFor({ timeout: 25000 });
    await pg.locator('[data-testid="collab-status"]').waitFor({ state: 'detached', timeout: 25000 }).catch(() => {});
    await sleep(500);
    const collabUrls = urls.filter((u) => u.includes('/collab'));
    const sentBefore = sent;
    await pg.locator('.bn-editor').click(); await pg.keyboard.press('Control+End'); await pg.keyboard.type(' typed over the ticket socket'); await sleep(1200);
    check('browser: edits typed in the editor are sent over the ticketed socket', sent > sentBefore, `${sentBefore} -> ${sent}`);
    check('browser: the editor connected over /collab with a ticket and received data', collabUrls.length >= 1 && collabUrls.every((u) => /[?&]ticket=/.test(u)) && frames > 0, collabUrls.join(' '));
    check('browser: no sign-in token appears in any WebSocket address', collabUrls.every((u) => !u.includes(bootToken) && !/[?&]token=/.test(u)));
    await pg.reload();
    await pg.locator('.bn-editor').waitFor({ timeout: 25000 });
    await pg.locator('[data-testid="collab-status"]').waitFor({ state: 'detached', timeout: 25000 }).catch(() => {});
    const all = urls.filter((u) => u.includes('/collab'));
    check('browser: a reload connects again with a fresh ticket', all.length >= 2 && new Set(all.map((u) => u.match(/ticket=([^&]+)/)?.[1])).size >= 2, String(all.length));
    await pg.close();
  }
} catch (e) {
  check('account-safety ran', false, e && e.stack ? e.stack : String(e));
} finally {
  try { for (const em of created) await prisma.user.deleteMany({ where: { email: em } }); await prisma.$executeRawUnsafe("DELETE FROM pending_signups WHERE email LIKE '%-" + tag + "@peblo.test'"); } catch {}
  try { fs.rmSync(OUTBOX, { force: true }); } catch {}
}
await finish();

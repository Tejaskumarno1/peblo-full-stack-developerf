// Tests email verification and changing the sign-in email (migration 019, routes in routes/auth.ts, services/mailer.ts + emailAccount.ts)
// against a throwaway local Postgres named peblo_test. Mail goes to a file (MAIL_OUTBOX) or to a fake SMTP server; nothing real is sent.
// Usage: npm run build:server && node scripts/account-test.mjs
import path from 'path';
import os from 'os';
import fs from 'node:fs';
import tls from 'node:tls';
import { execSync } from 'node:child_process';
import dotenv from 'dotenv';
import { pathToFileURL } from 'url';

dotenv.config({ path: path.resolve('server/.env') });
process.env.DATABASE_URL = process.env.PEBLO_TEST_DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:55432/peblo_test';
if (!/peblo_test/.test(process.env.DATABASE_URL)) { console.error('refusing to run: not peblo_test'); process.exit(1); }
process.env.PEBLO_SQL_DIR = path.resolve('server/prisma/sql');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'smoke-test-secret-smoke-test-secret';
process.env.TRUST_PROXY = '1';
process.env.SIGNUP_RATE_MAX = '1000';
process.env.PUBLIC_URL = 'https://peblo.example';
for (const k of ['MAIL_OUTBOX', 'RESEND_API_KEY', 'SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'SMTP_PORT', 'MAIL_FROM']) delete process.env[k];
delete process.env.PEBLO_HOSTED;

const outbox = path.join(os.tmpdir(), `peblo-outbox-${process.pid}.jsonl`);
fs.rmSync(outbox, { force: true });
const mails = () => (fs.existsSync(outbox) ? fs.readFileSync(outbox, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const linkOf = (m) => m.text.match(/https:\/\/peblo\.example\/verify-email\?token=([A-Za-z0-9_-]+)/)?.[1];

const { startServer } = await import(pathToFileURL(path.resolve('dist/server/index.js')).href);
const { default: prisma } = await import(pathToFileURL(path.resolve('dist/server/db.js')).href);
const mailer = await import(pathToFileURL(path.resolve('dist/server/services/mailer.js')).href);
const { server, port } = await startServer({ port: 0, staticDir: path.resolve('client/dist') });
const base = `http://127.0.0.1:${port}`;
let token = null; let failures = 0;
const runId = Date.now();
async function call(method, url, body) {
  const res = await fetch(base + url, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text(); let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, json, text };
}
function check(name, cond, extra) { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); if (!cond) { failures++; if (extra !== undefined) console.log('      ', JSON.stringify(extra).slice(0, 500)); } }
const PW = 'correct horse battery';

try {
  // ---- a server with no mail set up says so, and keeps working as before ----
  const e0 = `acct-0-${runId}@peblo.test`;
  let r = await call('POST', '/api/auth/signup', { email: e0, password: PW, name: 'No Mail' });
  token = r.json.token;
  check('signup works without mail; the address starts unconfirmed', r.status === 201 && r.json.user.emailVerified === false && r.json.user.mailReady === false && r.json.user.pendingEmail === null, r.json.user);
  r = await call('POST', '/api/auth/send-verification');
  check('no mail set up: asking for a link says so plainly (503)', r.status === 503 && r.json.mailConfigured === false, r);
  const e0b = `acct-0b-${runId}@peblo.test`;
  r = await call('PUT', '/api/profile', { email: e0b, currentPassword: PW });
  check('no mail set up: an email change is immediate (as before) and is unconfirmed', r.status === 200 && r.json.user.email === e0b && r.json.user.emailVerified === false && !r.json.emailChangePending, r.json);
  r = await call('POST', '/api/auth/verify-email', { token: 'x'.repeat(43) });
  check('a made-up link is refused', r.status === 400, r);

  // ---- with mail: confirm the address ----
  process.env.MAIL_OUTBOX = outbox;
  const e1 = `acct-1-${runId}@peblo.test`;
  r = await call('POST', '/api/auth/signup', { email: e1, password: PW, name: 'Mail One' });
  token = r.json.token; const tok1 = token;
  await new Promise((s) => setTimeout(s, 400));
  let m = mails();
  check('signup mails a confirm link to the new address', m.length === 1 && m[0].to === e1 && !!linkOf(m[0]) && /Confirm/i.test(m[0].subject), m);
  const raw1 = linkOf(m[0]);
  check('only a hash of the link is stored, not the link', (await prisma.emailToken.findMany({ where: { kind: 'verify' } })).every((t) => t.tokenHash !== raw1 && t.tokenHash.length === 64));
  r = await call('GET', '/api/profile');
  check('profile says mail works and the address is still unconfirmed', r.json.user.mailReady === true && r.json.user.emailVerified === false, r.json.user);
  r = await call('POST', '/api/auth/send-verification');
  check('asking again sends a second link', r.status === 200 && r.json.sent === true, r);
  m = mails(); const raw1b = linkOf(m[1]);
  r = await call('POST', '/api/auth/verify-email', { token: raw1 });
  check('the older link stops working once a newer one is sent', r.status === 400, r);
  token = null;
  r = await call('POST', '/api/auth/verify-email', { token: raw1b });
  check('opening the link confirms the address (no sign-in needed)', r.status === 200 && r.json.ok && r.json.kind === 'verify' && r.json.email === e1, r);
  r = await call('POST', '/api/auth/verify-email', { token: raw1b });
  check('a link works once', r.status === 400, r);
  token = tok1;
  r = await call('GET', '/api/profile');
  check('the profile now shows it confirmed', r.json.user.emailVerified === true, r.json.user);
  r = await call('POST', '/api/auth/send-verification');
  check('a confirmed address needs no link', r.status === 200 && r.json.alreadyVerified === true && mails().length === 2, r);

  // ---- expired links ----
  const e2 = `acct-2-${runId}@peblo.test`;
  r = await call('POST', '/api/auth/signup', { email: e2, password: PW, name: 'Mail Two' });
  token = r.json.token; const tok2 = token;
  await new Promise((s) => setTimeout(s, 400));
  const raw2 = linkOf(mails().at(-1));
  await prisma.emailToken.updateMany({ where: { user: { email: e2 } }, data: { expiresAt: new Date(Date.now() - 1000) } });
  r = await call('POST', '/api/auth/verify-email', { token: raw2 });
  check('an expired link is refused', r.status === 400, r);

  // ---- changing the sign-in email ----
  token = tok1;
  const e1b = `acct-1b-${runId}@peblo.test`;
  r = await call('PUT', '/api/profile', { email: e1b });
  check('a change needs the password', r.status === 403, r);
  r = await call('PUT', '/api/profile', { email: e2, currentPassword: PW });
  check('an address another account uses is refused', r.status === 409, r);
  const before = mails().length;
  r = await call('PUT', '/api/profile', { email: e1b, currentPassword: PW });
  check('with mail the address does NOT change yet; a pending change is reported', r.status === 200 && r.json.user.email === e1 && r.json.user.pendingEmail === e1b && r.json.emailChangePending === e1b && /link to/.test(r.json.message), r.json);
  m = mails();
  check('the link goes to the NEW address', m.length === before + 1 && m.at(-1).to === e1b && /new email/i.test(m.at(-1).subject), m.at(-1));
  const rawChange = linkOf(m.at(-1));
  r = await call('POST', '/api/auth/login', { email: e1b, password: PW });
  check('the new address cannot sign in before it is confirmed', r.status === 401, r);
  r = await call('POST', '/api/auth/cancel-email-change');
  r = await call('GET', '/api/profile');
  check('cancelling drops the pending change', r.json.user.pendingEmail === null, r.json.user);
  token = null;
  r = await call('POST', '/api/auth/verify-email', { token: rawChange });
  check('a cancelled change link no longer works', r.status === 400, r);
  token = tok1;
  r = await call('PUT', '/api/profile', { email: e1b, currentPassword: PW });
  const rawChange2 = linkOf(mails().at(-1));
  token = null;
  r = await call('POST', '/api/auth/verify-email', { token: rawChange2 });
  check('opening the link moves the account to the new address', r.status === 200 && r.json.kind === 'change' && r.json.email === e1b, r);
  await new Promise((s) => setTimeout(s, 300));
  m = mails();
  check('the old address is told it changed', m.at(-1).to === e1 && /changed/i.test(m.at(-1).subject) && m.at(-1).text.includes(e1b), m.at(-1));
  r = await call('POST', '/api/auth/login', { email: e1b, password: PW });
  check('signing in works with the new address, which is confirmed', r.status === 200 && r.json.user.emailVerified === true && r.json.user.email === e1b, r.json);
  r = await call('POST', '/api/auth/login', { email: e1, password: PW });
  check('the old address no longer signs in', r.status === 401, r);
  token = r.json?.token || null;

  // ---- same address again keeps it confirmed ----
  r = await call('POST', '/api/auth/login', { email: e1b, password: PW }); token = r.json.token;
  r = await call('PUT', '/api/profile', { email: e1b, currentPassword: PW });
  check('saving the same address changes nothing and stays confirmed', r.status === 200 && r.json.user.emailVerified === true && !r.json.emailChangePending, r.json);

  // ---- delete account removes its links ----
  token = tok2;
  r = await call('POST', '/api/auth/delete-account', { password: PW });
  check('deleting the account removes its email links', r.status === 200 && (await prisma.emailToken.count({ where: { user: { email: e2 } } })) === 0);

  // ---- the SMTP sender, against a fake TLS mail server ----
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'peblo-smtp-'));
  const sslArgs = `req -x509 -newkey rsa:2048 -nodes -keyout "${dir}/k.pem" -out "${dir}/c.pem" -days 2 -subj /CN=localhost`;
  const sslBins = ['openssl', 'C:\\Program Files\\Git\\usr\\bin\\openssl.exe', 'C:\\Program Files\\Git\\mingw64\\bin\\openssl.exe'];
  let sslOk = false;
  for (const b of sslBins) { try { execSync(`"${b}" ${sslArgs}`, { stdio: 'ignore' }); sslOk = true; break; } catch { /* try the next one */ } }
  if (!sslOk) throw new Error('openssl not found (needed to make a test certificate)');
  const got = { lines: [], data: '' };
  const smtp = tls.createServer({ key: fs.readFileSync(`${dir}/k.pem`), cert: fs.readFileSync(`${dir}/c.pem`) }, (sock) => {
    let inData = false; let buf = '';
    sock.write('220 fake ESMTP\r\n');
    sock.on('data', (d) => {
      buf += d.toString();
      let i;
      while ((i = buf.indexOf('\r\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 2);
        if (inData) { if (line === '.') { inData = false; sock.write('250 queued\r\n'); } else got.data += line + '\n'; continue; }
        got.lines.push(line);
        if (/^EHLO/.test(line)) sock.write('250-fake\r\n250 AUTH LOGIN\r\n');
        else if (line === 'AUTH LOGIN') sock.write('334 VXNlcm5hbWU6\r\n');
        else if (got.lines.at(-2) === 'AUTH LOGIN') sock.write('334 UGFzc3dvcmQ6\r\n');
        else if (got.lines.at(-3) === 'AUTH LOGIN') sock.write(Buffer.from(line, 'base64').toString() === 'app-password' ? '235 ok\r\n' : '535 bad\r\n');
        else if (/^MAIL FROM/.test(line) || /^RCPT TO/.test(line)) sock.write('250 ok\r\n');
        else if (line === 'DATA') { inData = true; sock.write('354 go\r\n'); }
        else if (line === 'QUIT') sock.end('221 bye\r\n');
      }
    });
  });
  await new Promise((s) => smtp.listen(0, '127.0.0.1', s));
  delete process.env.MAIL_OUTBOX;
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  Object.assign(process.env, { SMTP_HOST: '127.0.0.1', SMTP_PORT: String(smtp.address().port), SMTP_USER: 'boddutejaskumar@gmail.com', SMTP_PASS: 'app-password', MAIL_FROM: 'Peblo <boddutejaskumar@gmail.com>' });
  check('SMTP settings count as mail being set up', mailer.mailMode() === 'smtp');
  let sent = await mailer.sendMail(mailer.verifyEmailMail('someone@peblo.test', 'https://peblo.example/verify-email?token=abc'));
  const decoded = got.data.split('\n').filter((l) => /^[A-Za-z0-9+/=]{20,}$/.test(l)).map((l) => Buffer.from(l, 'base64').toString()).join('');
  check('SMTP: the message is accepted by a TLS mail server', sent === true && got.lines.some((l) => l === 'RCPT TO:<someone@peblo.test>') && got.lines.some((l) => l === 'MAIL FROM:<boddutejaskumar@gmail.com>'), got.lines);
  check('SMTP: the body carries the link and a UTF-8 subject', decoded.includes('https://peblo.example/verify-email?token=abc') && /Subject: =\?UTF-8\?B\?/.test(got.data), got.data.slice(0, 400));
  process.env.SMTP_PASS = 'wrong';
  const quiet = console.error; console.error = () => {};
  sent = await mailer.sendMail(mailer.verifyEmailMail('someone@peblo.test', 'https://peblo.example/x'));
  console.error = quiet;
  check('SMTP: a wrong password reports failure instead of throwing', sent === false);
  smtp.close();
} catch (e) {
  console.log('FAIL  test crashed:', e); failures++;
} finally {
  fs.rmSync(outbox, { force: true });
  server.close();
  await prisma.$disconnect();
}
console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);

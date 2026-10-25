// Shared helpers: start the real compiled Peblo server on the peblo_test database and open the real client build in Chrome.
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import { pathToFileURL } from 'url';
import { chromium } from 'playwright-core';

export const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
export async function boot() {
  // server/.env gives secrets; the database is forced to a local peblo_test so real data is never touched
  const envText = fs.readFileSync(path.join(REPO, 'server', '.env'), 'utf8');
  const parsed = dotenv.parse(envText);
  Object.assign(process.env, parsed);
  // Tests never touch the real database: a throwaway local Postgres (or PEBLO_TEST_DATABASE_URL), always named peblo_test.
  process.env.DATABASE_URL = process.env.PEBLO_TEST_DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:55432/peblo_test';
  if (!/peblo_test/.test(process.env.DATABASE_URL)) throw new Error('refusing to run: not peblo_test');
  process.env.PEBLO_SQL_DIR = path.join(REPO, 'server', 'prisma', 'sql');
  process.env.SIGNUP_RATE_MAX = '1000';
  delete process.env.OPENAI_API_KEY; delete process.env.GEMINI_API_KEY; delete process.env.GEMINI_API_KEYS;
  const { startServer } = await import(pathToFileURL(path.join(REPO, 'dist', 'server', 'index.js')).href);
  const { server, port } = await startServer({ port: 0, staticDir: path.join(REPO, 'client', 'dist') });
  const base = `http://127.0.0.1:${port}`;
  process.env.PUBLIC_URL = base; // links use the "public" address; in a test that is this server
  const email = `e2e-${Date.now()}@peblo.test`;
  const r = await fetch(base + '/api/auth/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'correct horse battery', name: 'E2E' }) });
  const { token } = await r.json();
  const api = async (method, url, body) => {
    const res = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: body ? JSON.stringify(body) : undefined });
    return res.json().catch(() => ({}));
  };
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: !process.env.HEADED, args: process.env.HEADED ? ['--window-position=-1366,0', '--window-size=1366,768'] : [] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript((t) => { try { if (!localStorage.getItem('peblo-token')) localStorage.setItem('peblo-token', t); } catch {} }, token);
  if (process.env.STYLE) await ctx.addInitScript((st) => { try { localStorage.setItem('peblo-style', st); } catch {} }, process.env.STYLE);
  if (process.env.COLLAB_OFF) await ctx.addInitScript(() => { try { localStorage.setItem('peblo-collab', 'off'); } catch {} });
  const page = await ctx.newPage();
  page.on('dialog', (d) => d.accept());
  const logs = [];
  page.on('pageerror', (e) => logs.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') logs.push('console: ' + m.text()); });
  let failures = 0;
  const check = (name, ok, extra) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`); if (!ok) { failures++; if (extra !== undefined) console.log('      ', String(extra).slice(0, 300)); } };
  const finish = async () => {
    await browser.close(); server.close();
    const { default: prisma } = await import(pathToFileURL(path.join(REPO, 'dist', 'server', 'db.js')).href);
    try { await prisma.user.deleteMany({ where: { email } }); } catch {}
    await prisma.$disconnect();
    console.log(failures ? `\n${failures} check(s) failed` : '\nAll e2e checks passed');
    if (logs.length) console.log('browser errors:', logs.slice(0, 5));
    process.exit(failures ? 1 : 0);
  };
  return { base, api, page, ctx, check, finish, token };
}

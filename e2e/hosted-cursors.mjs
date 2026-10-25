// Two guests on the HOSTED app (or any URL) edit one shared note: text syncs and each sees the other's cursor.
// usage: node hosted-cursors.mjs <share-link>
import { chromium } from 'playwright-core';
const url = process.argv[2];
if (!url) { console.log('give the share link'); process.exit(1); }
let failed = 0;
const check = (n, ok, d = '') => { console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (ok ? '' : '  ' + d)); if (!ok) failed++; };
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' });
const mk = async () => {
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  page.on('websocket', (w) => { if (/collab/.test(w.url())) { page.__ws = true; w.on('close', () => { page.__wsClosed = true; }); } });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.locator('.bn-editor').waitFor({ timeout: 90000 });
  return { ctx, page, errs };
};
const plain = (t) => t.replace(/\s+/g, ' ');
try {
  const a = await mk();
  const b = await mk();
  // wait until both are live
  for (const p of [a.page, b.page]) await p.locator('[data-testid="collab-status"]').waitFor({ state: 'detached', timeout: 40000 }).catch(() => {});
  check('both pages opened a live connection', !!a.page.__ws && !!b.page.__ws);
  check('both pages show the saved text', /First line/.test(await a.page.locator('.bn-editor').innerText()) && /First line/.test(await b.page.locator('.bn-editor').innerText()));
  await a.page.locator('.bn-editor').click();
  await a.page.keyboard.press('Control+End');
  await a.page.keyboard.type(' AAA', { delay: 40 });
  await b.page.waitForTimeout(2500);
  check('B sees what A typed', /AAA/.test(await b.page.locator('.bn-editor').innerText()));
  await b.page.locator('.bn-editor').click();
  await b.page.keyboard.press('Control+Home');
  await b.page.keyboard.type('BBB ', { delay: 40 });
  await a.page.waitForTimeout(2500);
  const ta = plain(await a.page.locator('.bn-editor').innerText());
  check('A sees what B typed, and keeps its own', /BBB/.test(ta) && /AAA/.test(ta), ta);
  check('A sees B\'s cursor', (await a.page.locator('.bn-collaboration-cursor__caret').count()) > 0);
  check('B sees A\'s cursor', (await b.page.locator('.bn-collaboration-cursor__caret').count()) > 0);
  check('no connection dropped', !a.page.__wsClosed && !b.page.__wsClosed);
  check('no script errors', a.errs.length + b.errs.length === 0, [...a.errs, ...b.errs].join(' | ').slice(0, 300));
  await a.page.screenshot({ path: 'hosted-cursors.png' });
} catch (e) { check('no crash', false, String(e).slice(0, 300)); }
await browser.close();
console.log(failed ? failed + ' check(s) failed' : 'All hosted checks passed');


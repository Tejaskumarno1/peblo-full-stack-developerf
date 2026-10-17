// PEB-65: the Content-Security-Policy does not break the app in any style, and it does stop an injected inline script.
import { boot } from './lib.mjs';

const { base, api, page, check, finish } = await boot();
const violations = [];
page.on('console', (m) => { const t = m.text(); if (/Content Security Policy|Refused to (load|execute|connect|apply)/i.test(t)) violations.push(t.slice(0, 200)); });
try {
  await api('POST', '/api/notes', { title: 'CSP note', content: 'Some **text** with a [link](https://example.com).' });
  await api('POST', '/api/todos', { text: 'CSP task', deadline: new Date(Date.now() + 3 * 3600000).toISOString() });

  const res = await page.goto(base + '/');
  check('the page is served with a Content-Security-Policy header', /default-src 'self'/.test(res.headers()['content-security-policy'] || ''));

  const routes = ['/', '/notes', '/tasks', '/calendar', '/ai', '/ai/connections'];
  for (const style of ['studio', 'console', 'soft', 'river', 'orbit']) {
    await page.evaluate((s) => localStorage.setItem('peblo-style', s), style);
    for (const r of routes) {
      await page.goto(base + r);
      await page.waitForTimeout(700);
    }
    const applied = await page.evaluate(() => document.documentElement.getAttribute('data-style'));
    check(`${style}: the inline theme script still ran under the policy`, applied === style, applied);
  }
  // open a note so the editor, its fonts and styles load too
  await page.goto(base + '/notes');
  await page.locator('.nl-row, .s-note-row, .r-note, a[href^="/notes/"]').first().click({ timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(1500);
  check('no Content-Security-Policy violation in any style or page', violations.length === 0, violations.slice(0, 3).join(' | '));

  // an inline script that was not in the page cannot run
  await page.evaluate(() => { const s = document.createElement('script'); s.textContent = 'window.__pwn = 1'; document.body.appendChild(s); });
  await page.waitForTimeout(300);
  check('an injected inline script does not run', (await page.evaluate(() => window.__pwn)) === undefined);
  await page.evaluate(() => { const i = document.createElement('img'); i.src = 'x'; i.setAttribute('onerror', 'window.__pwn2 = 1'); document.body.appendChild(i); });
  await page.waitForTimeout(500);
  check('an injected onerror handler does not run', (await page.evaluate(() => window.__pwn2)) === undefined);
} catch (e) { console.error(e); check('script ran to the end', false, e.message); }
await finish();

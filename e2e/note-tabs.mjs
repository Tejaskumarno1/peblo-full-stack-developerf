// Note tabs (B4): tab strip, back / forward, pin, duplicate, close others, reopen closed.
import { boot } from './lib.mjs';
const { base, api, page, check, finish } = await boot();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const titles = () => page.locator('[data-testid="note-tab"] b').allInnerTexts();
try {
  await page.goto(base + '/notes'); await wait(500);
  await page.evaluate(() => localStorage.removeItem('peblo-note-tabs'));
  const mk = async (t) => (await api('POST', '/api/notes', { title: t, content: t + ' body' })).note;
  const a = await mk('Tab Alpha'); const b = await mk('Tab Beta'); const c = await mk('Tab Gamma');
  for (const n of [a, b, c]) { await page.goto(base + '/notes/' + n.id); await page.locator('[data-testid="note-tabs"]').waitFor({ timeout: 20000 }); await wait(700); }
  let t = await titles();
  check('Three open notes are three tabs', ['Tab Alpha', 'Tab Beta', 'Tab Gamma'].every((x) => t.includes(x)), t.join('|'));
  check('The open note is the selected tab', (await page.locator('[data-testid="note-tab"][aria-selected="true"] b').innerText()) === 'Tab Gamma');
  await page.locator('[data-testid="note-tab"]', { hasText: 'Tab Alpha' }).click(); await wait(800);
  check('Clicking a tab opens that note', page.url().endsWith(a.id));
  check('Back is enabled after switching', await page.locator('[data-testid="tab-back"]').isEnabled());
  await page.locator('[data-testid="tab-back"]').click(); await wait(800);
  check('Back returns to the previous note', page.url().endsWith(c.id), page.url());
  await page.keyboard.press('Alt+ArrowRight'); await wait(800);
  check('Alt Right goes forward', page.url().endsWith(a.id), page.url());
  await page.keyboard.press('Control+Tab'); await wait(800);
  check('Ctrl Tab moves to the next tab', !page.url().endsWith(a.id));

  await page.locator('[data-testid="note-tab"]', { hasText: 'Tab Beta' }).click({ button: 'right' });
  const mtxt = await page.locator('[data-testid="tab-menu"]').innerText();
  for (const w of ['Pin tab', 'Duplicate', 'Close others', 'Reopen closed', 'Ctrl+Shift+T']) check(`Tab menu has "${w}"`, mtxt.includes(w), mtxt);
  await page.screenshot({ path: 'e2e/note-tabs.png' });
  await page.locator('[data-testid="tm-pin"]').click(); await wait(300);
  t = await titles();
  check('Pinned tab moves to the front', t[0] === 'Tab Beta', t.join('|'));
  check('Pinned tab shows a pin', (await page.locator('[data-testid="note-tab"].pinned').count()) === 1);

  await page.locator('[data-testid="note-tab"]', { hasText: 'Tab Gamma' }).click({ button: 'right' });
  await page.locator('[data-testid="tm-dup"]').click(); await wait(1500);
  t = await titles();
  check('Duplicate opens a copy in a new tab', t.includes('Copy of Tab Gamma'), t.join('|'));

  await page.locator('[data-testid="note-tab"]', { hasText: 'Tab Alpha' }).locator('[data-testid="tab-close"]').click(); await wait(600);
  t = await titles();
  check('Close removes the tab', !t.includes('Tab Alpha'), t.join('|'));
  await page.keyboard.press('Control+Shift+T'); await wait(900);
  t = await titles();
  check('Ctrl Shift T reopens the closed tab', t.includes('Tab Alpha'), t.join('|'));

  await page.locator('[data-testid="note-tab"]', { hasText: 'Tab Alpha' }).click({ button: 'right' });
  await page.locator('[data-testid="tm-others"]').click(); await wait(700);
  t = await titles();
  check('Close others keeps this tab and the pinned one', t.length === 2 && t.includes('Tab Alpha') && t.includes('Tab Beta'), t.join('|'));
  await page.reload(); await page.locator('[data-testid="note-tabs"]').waitFor({ timeout: 20000 }); await wait(800);
  t = await titles();
  check('Tabs are still there after a reload', t.includes('Tab Beta') && t.includes('Tab Alpha'), t.join('|'));
} catch (e) { check('Note tabs run without an error', false, String(e)); }
await finish();

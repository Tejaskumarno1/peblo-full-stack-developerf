// Keyboard shortcuts and accessibility (mockup S30).
import { boot } from './lib.mjs';
const { base, api, ctx, check, finish } = await boot();
try {
  const body = '## One\n\n' + 'First part words. '.repeat(60) + '\n\n## Two\n\n' + 'Second part words. '.repeat(120) + '\n\n## Three\n\n' + 'Third part words. '.repeat(120);
  const note = (await api('POST', '/api/notes', { title: 'Keys page', content: body, tags: [] })).note;
  const tok = (await api('POST', `/api/share/note/${note.id}`, { edit: false })).token;
  const gc = await ctx.browser().newContext({ viewport: { width: 1366, height: 800 } });
  const g = await gc.newPage();
  const errors = []; g.on('pageerror', (e) => errors.push(e.message));
  await g.goto(`${base}/s/note/${tok}`);
  await g.locator('[data-testid="join-anon"]').click({ timeout: 8000 }).catch(() => {});
  await g.waitForTimeout(4000); console.log('BODY', (await g.locator('body').innerText()).slice(0,300), 'ERR', errors.join('|'));  await g.locator('article .doc').waitFor({ timeout: 20000 }); await g.waitForTimeout(1500); console.log('HTML', (await g.locator('article .doc').innerHTML()).slice(0, 400));
  await g.locator('body').click({ position: { x: 5, y: 400 } });
  const topOf = (text) => g.evaluate((t) => { const h = [...document.querySelectorAll('article .doc h2')].find((x) => x.textContent.trim() === t); return h ? Math.round(h.getBoundingClientRect().top) : null; }, text);
  await g.keyboard.press('j'); await g.waitForTimeout(900); await g.keyboard.press('j'); await g.waitForTimeout(1200);
  const two = await topOf('Two');
  check('1 J steps to a later heading', two !== null && two < 500, String(two));
  await g.keyboard.press('g'); await g.keyboard.press('g'); await g.waitForTimeout(1200);
  check('2 G G goes back to the top', await g.evaluate(() => (document.querySelector('article')?.scrollTop || window.scrollY) < 40));
  await g.keyboard.press('l');
  check('3 L opens the listen bar', await g.locator('[data-testid="listen-bar"]').isVisible());
  await g.keyboard.press('l');
  await g.keyboard.press('t');
  check('4 T opens the translate menu', await g.locator('[data-testid="tr-menu"]').isVisible());
  await g.keyboard.press('t');
  const before = await g.locator('.pb-shared').getAttribute('data-theme');
  await g.keyboard.press('Control+j');
  check('5 Ctrl J switches the theme', (await g.locator('.pb-shared').getAttribute('data-theme')) !== before);
  await g.keyboard.press('?');
  check('6 the shortcut list has three groups', (await g.locator('.keys-col').count()) === 3 && /Command palette/.test(await g.locator('[data-testid="keys-sheet"]').innerText()));
  await g.keyboard.press('Escape');
  await g.reload(); await g.locator('[data-testid="join-anon"]').click({ timeout: 3000 }).catch(() => {});
  await g.locator('.skip-link').waitFor({ state: 'attached', timeout: 15000 });
  await g.keyboard.press('Tab');
  check('7 the first Tab stop is the skip link', await g.evaluate(() => document.activeElement?.classList.contains('skip-link')));
  check('8 no page errors', errors.length === 0, errors.join('|'));
} catch (e) { check('run ' + e.message, false); }
await finish();

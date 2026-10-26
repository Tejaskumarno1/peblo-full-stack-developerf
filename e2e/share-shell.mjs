// Share page shell: full screen, hidden tool bar, shortcuts, tucked top bar, end space, quiet mode.
import { boot } from './lib.mjs';

const { base, api, ctx, check, finish } = await boot();
const SHOTS = 'C:/Users/tejas/peblo-e2e';

try {
  const body = '## One\n\n' + 'Alpha line.\n\n'.repeat(30) + '## Two\n\n' + 'Beta line.\n\n'.repeat(30) + '## Three\n\nGamma end.';
  const note = (await api('POST', '/api/notes', { title: 'Shell note', content: body, tags: [] })).note;
  const tok = (await api('POST', `/api/share/note/${note.id}`, { edit: false, expiresInDays: 1 })).token;

  const gctx = await ctx.browser().newContext({ viewport: { width: 1360, height: 820 } });
  const g = await gctx.newPage();
  await g.goto(`${base}/s/note/${tok}`);
  await g.locator('article .doc').waitFor({ timeout: 15000 });
  const root = g.locator('.pb-shared');

  // tool bar is hidden at first, with a handle
  check('tool bar starts hidden', (await g.getByTestId('dock').count()) === 0 && (await g.getByTestId('dock-handle').count()) === 1);
  await g.keyboard.press('/');
  check('"/" shows the tool bar', (await g.getByTestId('dock').count()) === 1);
  check('tool bar has key hints', (await g.locator('.dk kbd').count()) >= 3);
  await g.screenshot({ path: `${SHOTS}/shell-1-dock.png` });
  await g.keyboard.press('/');
  check('"/" hides it again', (await g.getByTestId('dock').count()) === 0);
  await g.getByTestId('dock-handle').click();
  check('Tools handle shows the bar', (await g.getByTestId('dock').count()) === 1);
  await g.keyboard.press('Escape');

  // collapsible outline with [ and panel with ]
  const tocOpen = () => g.locator('aside.toc:not(.collapsed)').count();
  const before = await tocOpen();
  await g.keyboard.press('[');
  check('"[" toggles the outline', (await tocOpen()) !== before);
  await g.keyboard.press('[');
  check('"[" brings the outline back', (await tocOpen()) === before);
  const hadPanel = await g.locator('.cp-drawer').count();
  await g.keyboard.press(']');
  check('"]" toggles the people panel', (await g.locator('.cp-drawer').count()) !== hadPanel);

  // shortcuts sheet
  await g.keyboard.press('?');
  check('"?" opens the shortcuts', (await g.getByTestId('keys-sheet').count()) === 1);
  await g.keyboard.press('Escape');
  check('Esc closes the shortcuts', (await g.getByTestId('keys-sheet').count()) === 0);

  // full screen (class fallback always works; the browser API may be refused headless)
  await g.keyboard.press('f');
  check('"F" goes full screen', await root.evaluate((el) => el.classList.contains('is-fs')));
  check('top bar is gone in full screen', !(await g.locator('.pb-shared .top').isVisible()));
  check('exit chip shows', (await g.getByTestId('fs-exit').count()) === 1);
  await g.screenshot({ path: `${SHOTS}/shell-2-fullscreen.png` });
  await g.getByTestId('fs-exit').click();
  check('exit chip leaves full screen', !(await root.evaluate((el) => el.classList.contains('is-fs'))));
  await g.keyboard.press('f'); await g.keyboard.press('Escape');
  check('Esc leaves full screen', !(await root.evaluate((el) => el.classList.contains('is-fs'))));

  // top bar tucks away scrolling down, returns scrolling up
  const art = g.locator('article');
  await art.evaluate((a) => { a.scrollTop = 600; });
  await g.waitForTimeout(300);
  await art.evaluate((a) => { a.scrollTop = 900; });
  await g.waitForTimeout(500);
  check('top bar tucks away on scroll down', await root.evaluate((el) => el.classList.contains('top-tucked')));
  await art.evaluate((a) => { a.scrollTop = 700; });
  await g.waitForTimeout(500);
  check('top bar returns on scroll up', !(await root.evaluate((el) => el.classList.contains('top-tucked'))));

  // space after the last line
  const gap = await art.evaluate((a) => { a.scrollTop = a.scrollHeight; const last = [...a.querySelectorAll('.doc p')].pop(); return a.getBoundingClientRect().bottom - last.getBoundingClientRect().bottom; });
  check('room to scroll past the last line', gap > 150, String(Math.round(gap)));
  await g.screenshot({ path: `${SHOTS}/shell-3-end.png` });

  // look menu: pin the tool bar, quiet mode, remembered after reload
  await art.evaluate((a) => { a.scrollTop = 0; });
  await g.waitForTimeout(500);
  await g.getByTestId('look-btn').click();
  await g.getByTestId('look-pin').check();
  await g.getByTestId('look-quiet').check();
  check('pinned tool bar stays shown', (await g.getByTestId('dock').count()) === 1);
  check('quiet mode class set', await root.evaluate((el) => el.classList.contains('is-quiet')));
  await g.reload();
  await g.locator('article .doc').waitFor({ timeout: 15000 });
  check('pin remembered after reload', (await g.getByTestId('dock').count()) === 1);
} catch (e) { check('shell test ran without error', false, String(e)); }
await finish();

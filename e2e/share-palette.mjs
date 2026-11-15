// Share page Ctrl K command palette (mockup S21): opens from the header bar and Ctrl K, jumps to headings, runs actions.
import { boot } from './lib.mjs';

const { base, api, page, ctx, check, finish } = await boot({ freshGuest: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await fn()) return true; } catch { /* retry */ } await wait(150); } return false; };
const body = ['# One', 'First part ' + 'words '.repeat(30), '## Evidence table', 'Second part ' + 'words '.repeat(30), '# Next steps', 'Last part ' + 'words '.repeat(30)].join('\n\n');

try {
  const note = (await api('POST', '/api/notes', { title: 'Palette page', content: body, tags: [] })).note;
  const tok = (await api('POST', `/api/share/note/${note.id}`, { edit: false })).token;
  const gc = await ctx.browser().newContext({ viewport: { width: 1366, height: 800 } });
  const g = await gc.newPage();
  const errors = [];
  g.on('pageerror', (e) => errors.push(e.message));
  await g.goto(`${base}/s/note/${tok}`);
  await g.locator('[data-testid="palette-btn"]').waitFor({ timeout: 20000 });
  check('1 header shows the search or jump bar', (await g.locator('[data-testid="palette-btn"]').innerText()).includes('Ctrl K'));
  await g.locator('[data-testid="palette-btn"]').click();
  check('2 palette opens from the bar', await g.locator('[data-testid="palette"]').isVisible());
  check('3 headings and actions are listed', (await g.locator('[data-testid="palette-item"]').count()) >= 8);
  await g.keyboard.type('evidence');
  check('4 typing filters to the matching heading', (await g.locator('[data-testid="palette-item"]').count()) === 1);
  await g.keyboard.press('Enter');
  check('5 Enter jumps there and closes', await until(async () => (await g.locator('[data-testid="palette"]').count()) === 0) && /evidence/i.test(await g.evaluate(() => decodeURIComponent(location.hash))));
  await g.keyboard.press('Control+k');
  check('6 Ctrl K opens it again', await g.locator('[data-testid="palette"]').isVisible());
  await g.keyboard.type('shortcuts');
  await g.keyboard.press('Enter');
  check('7 an action runs (keyboard shortcuts sheet)', await g.locator('[data-testid="keys-sheet"]').isVisible());
  await g.keyboard.press('Escape');
  await g.keyboard.press('Control+k');
  await g.keyboard.press('Escape');
  check('8 Esc closes the palette', (await g.locator('[data-testid="palette"]').count()) === 0);
  await g.keyboard.press('Control+k');
  await g.keyboard.type('zzzzqq');
  check('9 no match shows a message', (await g.locator('.sp-empty').count()) === 1);
  await g.screenshot({ path: 'share-palette.png' });
  check('10 no crash', errors.length === 0, errors.join(' | '));
} catch (e) {
  check('crash: ' + e.message, false);
}
await finish();

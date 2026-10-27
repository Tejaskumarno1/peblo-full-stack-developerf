// Presenter dock: drag it anywhere, it snaps to an edge (vertical on the sides), folds to a pill, and resets.
import { boot } from './lib.mjs';

const { base, api, page, ctx, check, finish } = await boot();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await fn()) return true; } catch { /* retry */ } await wait(100); } return false; };
const ready = async (p) => { await p.locator('.bn-editor').waitFor({ timeout: 20000 }); await p.locator('[data-testid="collab-status"]').waitFor({ state: 'detached', timeout: 20000 }).catch(() => {}); };
try {
  const note = (await api('POST', '/api/notes', { title: 'Dock', content: '# Dock\n\nSome words here.\n\n## Two\n\nMore words.', tags: [] })).note;
  const tok = (await api('POST', `/api/share/note/${note.id}`, { edit: true })).token;
  await page.goto(base + '/notes/' + note.id); await ready(page);
  const c = await ctx.browser().newContext({ viewport: { width: 1200, height: 800 } });
  await c.addInitScript(() => { try { localStorage.setItem('peblo-guest-name', 'Pia'); localStorage.setItem('peblo-guest-tour', '1'); } catch { /* ignore */ } });
  const g = await c.newPage(); await g.goto(`${base}/s/note/${tok}`); await ready(g);
  await g.locator('.bn-editor .bn-block-content', { hasText: 'Some words' }).first().click();
  await until(async () => (await g.getByTestId('present-btn').count()) === 1, 20000);
  await g.getByTestId('present-btn').click(); await g.getByTestId('present-options').click(); await g.getByTestId('present-go').click();
  const dock = g.getByTestId('presenting-banner');
  await dock.waitFor({ timeout: 8000 });
  const grip = g.getByTestId('dock-grip');
  const gb = await grip.boundingBox();
  // drag to the middle of the screen: it follows and stays horizontal
  await g.mouse.move(gb.x + 10, gb.y + 15); await g.mouse.down(); await g.mouse.move(500, 300, { steps: 6 }); await g.mouse.up();
  await wait(300);
  let r = await dock.boundingBox();
  check('1 the dock moved where it was dragged', Math.abs(r.y - 285) < 40 && r.y < 500, JSON.stringify(r));
  check('2 and stays horizontal in the middle', !(await dock.getAttribute('class')).includes(' v'));
  // drag to the left edge: it snaps and turns vertical
  const gb2 = await grip.boundingBox();
  await g.mouse.move(gb2.x + 10, gb2.y + 15); await g.mouse.down(); await g.mouse.move(14, 300, { steps: 6 }); await g.mouse.up();
  await wait(400);
  r = await dock.boundingBox();
  check('3 at the left edge it snaps and turns vertical', (await dock.getAttribute('class')).includes(' v') && r.x <= 16 && r.height > r.width, JSON.stringify(r));
  check('4 every tool is still on screen', r.y >= 0 && r.y + r.height <= 800);
  await g.screenshot({ path: 'C:/Users/tejas/peblo-e2e/dock-v.png' });
  // fold
  await g.getByTestId('dock-fold').click();
  check('5 folding hides the tools', (await g.getByTestId('tool-laser').count()) === 1 && !(await g.getByTestId('tool-laser').isVisible()));
  check('6 End is still there when folded', await g.getByTestId('present-end').isVisible());
  await g.getByTestId('dock-fold').click();
  check('7 unfolding brings them back', await g.getByTestId('tool-laser').isVisible());
  // reset
  await grip.dblclick();
  await wait(300);
  check('8 double-click puts the dock back on its side rail', !(await dock.getAttribute('class')).includes(' free') && (await dock.getAttribute('class')).includes(' v'));
  // a drag past the window clamps it on screen
  const gb3 = await grip.boundingBox();
  await g.mouse.move(gb3.x + 10, gb3.y + 15); await g.mouse.down(); await g.mouse.move(1500, 1200, { steps: 4 }); await g.mouse.up();
  await wait(400);
  r = await dock.boundingBox();
  check('9 it cannot be dragged off screen', r.x >= 0 && r.y >= 0 && r.x + r.width <= 1200 && r.y + r.height <= 800, JSON.stringify(r));
  await g.screenshot({ path: 'C:/Users/tejas/peblo-e2e/dock-1.png' });
  await g.getByTestId('present-end').click();
} catch (e) { console.log('crash', e.message); check('no crash', false); }
await finish();

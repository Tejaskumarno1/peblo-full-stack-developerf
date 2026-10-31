// Full screen bar v4 (approved mockup): one slim bar, every control shown by default, a docked drawer the page reflows beside,
// drag to reorder, show and hide, section minutes, writing sprint, quick to-do, and the draggable "is here" pill.
import { boot } from './lib.mjs';
const { base, api, page, ctx, check, finish } = await boot({ freshPresence: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const order = () => page.evaluate(() => [...document.querySelectorAll('.fsx-item')].map((e) => e.getAttribute('data-item')));
try {
  const n = (await api('POST', '/api/notes', { title: 'Pi planning', content: '# Session setup\n\nSome words in the first section that make it a little long to read.\n\n## Team boards\n\nMore words here.\n\n## Post PI\n\nEnd.' })).note;
  const tok = (await api('POST', `/api/share/note/${n.id}`, { edit: true })).token;
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(base + '/notes/' + n.id);
  await page.locator('.bn-editor').waitFor({ timeout: 20000 });
  await wait(1500);

  // ---- the draggable pill, in the normal view, with a guest on the link
  const g = await ctx.browser().newContext({ viewport: { width: 1200, height: 800 } });
  await g.addInitScript(() => { try { localStorage.setItem('peblo-guest-name', 'Pia'); localStorage.setItem('peblo-guest-tour', '1'); } catch {} });
  const gp = await g.newPage();
  await gp.goto(`${base}/s/note/${tok}`);
  await gp.locator('.bn-editor').waitFor({ timeout: 25000 });
  await page.locator('[data-testid="presence"] .pb-presence').waitFor({ timeout: 20000 });
  const pill = async () => page.locator('[data-testid="presence"] .pb-presence').boundingBox();
  const p0 = await pill();
  await page.mouse.move(p0.x + 3, p0.y + p0.height / 2);
  await page.mouse.down(); await page.mouse.move(p0.x - 200, p0.y - 120, { steps: 8 }); await page.mouse.up(); await wait(300);
  const p1 = await pill();
  check('the "is here" pill moves where it is dragged', Math.abs(p1.x - (p0.x - 200 + 0)) < 40 || Math.abs(p1.x - p0.x) > 100, JSON.stringify([p0, p1]));
  check('the pill stays on screen', p1.x >= 0 && p1.y >= 0 && p1.x + p1.width <= 1440 && p1.y + p1.height <= 900);
  await page.reload(); await page.locator('[data-testid="presence"] .pb-presence').waitFor({ timeout: 20000 });
  const p2 = await pill();
  check('the pill position is remembered after a reload', Math.abs(p2.x - p1.x) < 4 && Math.abs(p2.y - p1.y) < 4, JSON.stringify([p1, p2]));
  await page.locator('[data-testid="presence"]').dblclick({ position: { x: 2, y: 2 }, force: true }).catch(() => {});
  await page.locator('.bn-editor').waitFor();
  await wait(800);

  // ---- full screen
  await page.locator('button[aria-label="Full screen"]').click();
  await page.locator('[data-testid="fs-bar"]').waitFor(); await wait(1500);
  const bar = await page.locator('[data-testid="fs-bar"]').boundingBox();
  check('the bar is one slim row', bar.height <= 56, String(bar.height));
  check('the drawer is open by default', await page.locator('[data-testid="fs-drawer"]').isVisible());
  const o0 = await order();
  console.log('items', o0.join(','));
  for (const id of ['tag', 'shared', 'copy', 'cursors', 'live', 'normal']) check(`bar item shown by default: ${id}`, o0.includes(id));
  check('Shared and access text is in the bar', /Shared/.test(await page.locator('[data-testid="fs-shared"]').innerText()));
  const lay = await page.evaluate(() => { const d = document.querySelector('[data-testid="fs-drawer"]').getBoundingClientRect(); const e = document.querySelector('.bn-editor').getBoundingClientRect(); const t = document.querySelector('.s-note-title')?.getBoundingClientRect(); return { dl: d.left, er: e.right, bar: document.querySelector('[data-testid="fs-bar"]').getBoundingClientRect().bottom, et: e.top, tt: t ? t.top : 0 }; });
  check('the writing column ends before the drawer (nothing is covered)', lay.er <= lay.dl + 1, JSON.stringify(lay));
  check('the text starts under the bar, not behind it', lay.et >= lay.bar - 2 && (!lay.tt || lay.tt >= lay.bar - 2), JSON.stringify(lay));
  await page.screenshot({ path: 'e2e/focus-bar-default.png' });

  // ---- reorder by drag, hide, remember
  await page.locator('[data-row="copy"]').dragTo(page.locator('[data-row="tag"]')); await wait(400);
  const o1 = await order();
  check('dragging a row reorders the bar', o1.indexOf('copy') < o1.indexOf('tag'), o1.join(','));
  await page.locator('[data-testid="fs-sw-tag"]').click(); await wait(300);
  check('switching an item off removes it from the bar', !(await order()).includes('tag'));
  await page.reload(); await page.locator('.bn-editor').waitFor(); await wait(800);
  await page.locator('button[aria-label="Full screen"]').click(); await page.locator('[data-testid="fs-bar"]').waitFor(); await wait(1200);
  const o2 = await order();
  check('order and hidden items are remembered', !o2.includes('tag') && o2.indexOf('copy') < o2.indexOf('shared'), o2.join(','));
  await page.locator('[data-testid="fs-sw-tag"]').click(); await wait(300);

  // ---- tabs, minutes, counter, tools
  await page.locator('[data-testid="fs-tab-note"]').click();
  const noteText = await page.locator('[data-testid="fs-note-tab"]').innerText();
  check('Note tab holds the note actions', /Archive/.test(noteText) && /Duplicate/.test(noteText) && /Move to Trash/.test(noteText));
  await page.locator('[data-testid="fs-tab-share"]').click();
  check('Share tab shows the share state', /Shared/.test(await page.locator('[data-testid="fs-share-tab"]').innerText()));
  await page.locator('[data-testid="fs-tab-bar"]').click();
  check('the outline shows minutes per section', (await page.locator('[data-testid="outline-mins"]').count()) > 0);
  await page.locator('[data-testid="fs-sw-counter"]').click(); await wait(200);
  check('the counter can be switched off', (await page.locator('[data-testid="fs-counter"]').count()) === 0);
  await page.locator('[data-testid="fs-sw-counter"]').click(); await wait(200);
  await page.locator('[data-testid="fs-sprint-15"]').click(); await wait(1300);
  check('a writing sprint starts and counts down', /1[45]:\d\d/.test(await page.locator('[data-testid="fs-sprint"]').innerText()));
  await page.locator('[data-testid="fs-sprint-stop"]').click();
  await page.locator('[data-testid="fs-ambient"]').click(); await wait(200);
  check('soft sound turns on', (await page.locator('[data-testid="fs-ambient"]').innerText()) === 'On');
  await page.locator('[data-testid="fs-ambient"]').click();
  await page.locator('.bn-editor').first().click();
  await page.keyboard.press('Alt+q'); await wait(300);
  await page.locator('[data-testid="fs-quick"] input').fill('Book the room');
  await page.keyboard.press('Enter'); await wait(900);
  const todos = (await api('GET', '/api/todos')).todos || [];
  check('Alt+Q adds a to-do linked to the note', todos.some((t) => t.text === 'Book the room' && t.noteId === n.id), JSON.stringify(todos.map((t) => t.text)));
  check('and says so', (await page.locator('[data-testid="fs-flash"]').count()) > 0);

  // ---- closing the drawer gives the page the full width
  await page.locator('[data-testid="fs-opts"]').click(); await wait(400);
  check('the three dots close the drawer', !(await page.locator('[data-testid="fs-drawer"]').count()));
  const er2 = await page.evaluate(() => document.querySelector('.bn-editor').getBoundingClientRect().right);
  check('with the drawer closed the column is centred again', er2 > lay.er);
  await page.locator('[data-testid="fs-opts"]').click(); await wait(300);
  await page.locator('[data-testid="fs-exit"]').click(); await wait(500);
  await gp.close(); await g.close();
} catch (e) { check('no exception: ' + e.message, false); }
await finish();

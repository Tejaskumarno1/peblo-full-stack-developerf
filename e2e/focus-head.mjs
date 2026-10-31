// Full-screen writing mode: the header chips share one row, the live-cursor switch is there and on by itself, checkboxes are orange.
import { boot } from './lib.mjs';
const { base, api, page, ctx, check, finish } = await boot({ freshPresence: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const off = () => page.evaluate(() => document.documentElement.classList.contains('pb-presence-off'));
try {
  const n = (await api('POST', '/api/notes', { title: 'modules yet to finish', content: '# Orbit\n\n- [x] public pages blocks\n- [ ] Tools integration\n\nSome text here.' })).note;
  const tok = (await api('POST', `/api/share/note/${n.id}`, { edit: true })).token;
  await page.setViewportSize({ width: 1920, height: 913 });
  await page.goto(base + '/notes/' + n.id);
  await page.locator('.bn-editor').waitFor({ timeout: 20000 });
  await wait(1500);
  check('normal view: live cursors are off', await off());
  await page.locator('button[aria-label="Full screen"]').click();
  await wait(1500);
  check('full screen: live cursors switch on by themselves', !(await off()));
  check('full screen: the Live cursors option is there and on', (await page.locator('[data-testid="focus-cursors"]').getAttribute('aria-pressed')) === 'true');
  const lay = await page.evaluate(() => {
    const chips = [...document.querySelectorAll('.fsx-bar .cp-chip, .fsx-bar [data-testid="fs-copylink"]')].map((e) => e.getBoundingClientRect());
    const t = document.querySelector('.s-note-head .s-note-title').getBoundingClientRect();
    return { rows: new Set(chips.map((c) => Math.round((c.top + c.height / 2) / 10))).size, chips: chips.length, tw: Math.round(t.width) };
  });
  console.log(JSON.stringify(lay));
  check('full screen: the share chips (shared, copy, live) sit on the bar on one row', lay.chips >= 3 && lay.rows === 1);
  check('full screen: the title has room', lay.tw > 400);
  const box = await page.evaluate(() => { const i = document.querySelector('.bn-block-content[data-content-type="checkListItem"] input'); return i ? getComputedStyle(i).accentColor : 'none'; });
  check('full screen: checkboxes are orange like the share page', /rgb\(196, 68, 28\)/.test(box), box);
  await page.screenshot({ path: 'e2e/focus-after.png' });
  await page.locator('[data-testid="focus-cursors"]').click(); await wait(300);
  check('the Live cursors option turns them off', await off() && (await page.locator('[data-testid="focus-cursors"]').getAttribute('aria-pressed')) === 'false');
  await page.locator('[data-testid="focus-cursors"]').click(); await wait(300);
  check('and on again', !(await off()));
  await page.locator('[data-testid="fs-exit"]').click(); await wait(600);
  check('leaving full screen: live cursors are off again', await off());
  await page.locator('button[aria-label="Full screen"]').click(); await wait(600);
  check('entering again: on again', !(await off()));
  await page.locator('[data-testid="fs-exit"]').click(); await wait(300);

  // a share page starts with live cursors on
  const g = await ctx.browser().newContext({ viewport: { width: 1440, height: 900 } });
  await g.addInitScript(() => { try { localStorage.removeItem('peblo-pointers'); localStorage.setItem('peblo-guest-name', 'Pia'); localStorage.setItem('peblo-guest-tour', '1'); } catch {} });
  const gp = await g.newPage();
  await gp.goto(`${base}/s/note/${tok}`);
  await gp.locator('.bn-editor').waitFor({ timeout: 25000 });
  await wait(1200);
  check('share page: live cursors are on from the start', !(await gp.evaluate(() => document.documentElement.classList.contains('pb-presence-off'))));
  await g.close();
} catch (e) { check('no exception: ' + e.message, false); }
await finish();

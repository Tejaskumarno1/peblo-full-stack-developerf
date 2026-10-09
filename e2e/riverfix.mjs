// PEB-85 (rest): River shows a message when an action fails, and Jump to a far-away task lands on it.
import { boot } from './lib.mjs';

const { base, api, page, ctx, check, finish } = await boot();
await ctx.addInitScript(() => { try { localStorage.setItem('peblo-style', 'river'); if (!localStorage.getItem('peblo-river-zoom')) localStorage.setItem('peblo-river-zoom', 'hours'); } catch {} });
try {
  const t = new Date();
  const endOfToday = new Date(t.getFullYear(), t.getMonth(), t.getDate(), 23, 59, 0, 0);
  const far = new Date(t.getFullYear(), t.getMonth(), t.getDate() + 40, 23, 59, 0, 0);
  await api('POST', '/api/todos', { text: 'toggle fail task', deadline: endOfToday.toISOString() });
  await api('POST', '/api/todos', { text: 'far away task', deadline: far.toISOString() });

  await page.goto(base + '/');
  await page.waitForSelector('.r-task');

  // a failed tick shows a message and the box goes back
  await page.route('**/api/todos/*', (r) => (r.request().method() === 'PATCH' ? r.abort() : r.continue()));
  const box = page.getByLabel('Done: toggle fail task');
  await box.check({ force: true }).catch(() => {});
  await page.locator('.r-toast').waitFor({ timeout: 8000 }).catch(() => {});
  check('a failed tick shows a message', /Could not update/.test(await page.locator('.r-toast').innerText().catch(() => '')));
  await page.waitForTimeout(600);
  check('and the task is still not done', !(await box.isChecked().catch(() => true)));
  await page.unroute('**/api/todos/*');

  // "+ N more" on a busy day opens that day and lands on it
  await page.goto(base + '/');
  await page.evaluate(() => localStorage.setItem('peblo-river-zoom', 'quarter'));
  const day = new Date(t.getFullYear(), t.getMonth(), t.getDate() + 3, 12, 0, 0);
  for (const n of ['busy a', 'busy b', 'busy c', 'busy d']) await api('POST', '/api/todos', { text: n, deadline: day.toISOString(), startTime: '12:00', endTime: '13:00' });
  await page.reload();
  await page.waitForSelector('.r-chip-more', { timeout: 10000 });
  await page.locator('.r-chip-more').first().click();
  await page.waitForTimeout(1200);
  const names = ['busy a', 'busy b', 'busy c', 'busy d'];
  const drawn = async () => {
    const out = [];
    for (const n of names) {
      const b = await page.getByRole('button', { name: new RegExp('^' + n) }).first().boundingBox().catch(() => null);
      if (b && b.x >= 0 && b.x + b.width <= 1440) out.push(n);
    }
    return out;
  };
  const shown = await drawn();
  check('four overlapping meetings: three are drawn, one is not', shown.length === 3, JSON.stringify(shown));
  const hiddenOne = names.find((n) => !shown.includes(n));
  await page.locator('.r-chip-more').first().waitFor({ timeout: 5000 });
  await page.locator('.r-chip-more').first().click();
  await page.waitForTimeout(500);
  check('"+ 1 more" reaches the hidden meeting', (await page.locator('#rv-sel').innerText()) === hiddenOne, hiddenOne + ' / ' + (await page.locator('#rv-sel').innerText().catch(() => '?')));
} catch (e) { console.error(e); check('script ran to the end', false, e.message); }
await finish();

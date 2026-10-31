// River calendar, Hours zoom: all 24 hours drawn, and the NIGHT label / NOW pill no longer sit on top of hour labels.
process.env.STYLE = 'river';
const { boot } = await import('./lib.mjs');

const { base, api, page, check, finish } = await boot();
try {
  await page.setViewportSize({ width: 1280, height: 800 });
  const n = new Date();
  await api('POST', '/api/todos', { text: 'River late', priority: 'medium', deadline: new Date(n.getFullYear(), n.getMonth(), n.getDate(), 23, 30).toISOString(), startTime: '23:30', endTime: '23:50' });
  await api('POST', '/api/todos', { text: 'River early', priority: 'medium', deadline: new Date(n.getFullYear(), n.getMonth(), n.getDate(), 0, 30).toISOString(), startTime: '00:30', endTime: '01:00' });
  await page.goto(base + '/calendar');
  await page.getByRole('button', { name: 'Hours', exact: true }).click({ timeout: 20000 });
  await page.locator('.r-now-pill').waitFor({ timeout: 20000 });
  await page.waitForTimeout(800);
  const ticks = await page.locator('.r-tick:not(.btn)').count();
  check('river hours zoom draws hour labels for the whole day (24 per day)', ticks >= 24, String(ticks));
  const overlap = await page.evaluate(() => {
    const vis = (e) => getComputedStyle(e).visibility !== 'hidden';
    const hit = (a, b) => !(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top);
    const pill = document.querySelector('.r-now-pill').getBoundingClientRect();
    const ticks = [...document.querySelectorAll('.r-tick')].filter(vis).map((e) => ({ t: e.textContent, r: e.getBoundingClientRect() }));
    const nights = [...document.querySelectorAll('.r-band-night span')].map((e) => e.getBoundingClientRect());
    return {
      pill: ticks.filter((k) => hit(pill, k.r)).map((k) => k.t),
      night: nights.flatMap((nr) => ticks.filter((k) => hit(nr, k.r)).map((k) => k.t)),
    };
  });
  check('the NOW pill does not cover an hour label', overlap.pill.length === 0, overlap.pill.join(','));
  check('the NIGHT label does not cover an hour label', overlap.night.length === 0, overlap.night.join(','));
  await page.screenshot({ path: 'C:/Users/tejas/peblo-wt/shots/cal24-river.png' });
} catch (e) {
  check('cal24-river ran', false, e.stack || String(e));
} finally {
  await finish();
}

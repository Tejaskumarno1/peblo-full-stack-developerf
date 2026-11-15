// Orbit calendar (week): the same shared 24-hour TimeGrid, one internal scroller, events 00:30 / 23:30 / across midnight.
process.env.STYLE = 'orbit';
const { boot } = await import('./lib.mjs');

const { base, api, page, check, finish } = await boot();
const at = (d, h, m = 0) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m, 0).toISOString();
try {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(base + '/calendar');
  await page.locator('.tg-col').first().waitFor({ timeout: 20000 });
  const keys = await page.locator('.tg-col').evaluateAll((els) => els.map((e) => e.dataset.day));
  const parse = (k) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
  const d0 = parse(keys[2]);
  await api('POST', '/api/todos', { text: 'Zero thirty', priority: 'medium', deadline: at(d0, 0, 30), startTime: '00:30', endTime: '01:15' });
  await api('POST', '/api/todos', { text: 'Late thirty', priority: 'medium', deadline: at(d0, 23, 30), startTime: '23:30', endTime: '23:50' });
  await api('POST', '/api/todos', { text: 'Overnight', priority: 'medium', deadline: at(d0, 22, 0), startTime: '22:00', endTime: '01:00' });
  await page.reload();
  await page.locator('.tg-ev', { hasText: 'Zero thirty' }).waitFor({ timeout: 20000 });

  const labels = await page.locator('.tg-lbl').allInnerTexts();
  check('orbit week: all 24 hour labels exist', labels.length === 24 && labels[0] === '12 AM' && labels[23] === '11 PM', labels.join(','));
  const m = await page.evaluate(() => { const s = document.querySelector('.tg-scroll'); return { sh: s.scrollHeight, ch: s.clientHeight, doc: document.documentElement.scrollHeight, win: innerHeight, oy: getComputedStyle(s).overflowY }; });
  check('orbit week: the grid scrolls inside and the page does not', m.sh > m.ch + 200 && m.oy === 'auto' && m.doc <= m.win + 1, JSON.stringify(m));
  const ev = async (name, nth = 0) => page.locator('.tg-ev', { hasText: name }).nth(nth).evaluate((e) => ({ s: Number(e.dataset.start), e: Number(e.dataset.end), cont: e.classList.contains('cont') }));
  const z = await ev('Zero thirty'); const l = await ev('Late thirty');
  check('orbit week: 00:30 and 23:30 events are drawn at their time', z.s === 0.5 && l.s === 23.5, JSON.stringify([z, l]));
  const o1 = await ev('Overnight', 0); const o2 = await ev('Overnight', 1);
  check('orbit week: an event across midnight is split', o1.s === 22 && o1.e === 24 && o2.s === 0 && o2.e === 1 && o2.cont, JSON.stringify([o1, o2]));
  const p0 = await page.evaluate(() => document.querySelector('.tg-head').getBoundingClientRect().top);
  await page.evaluate(() => document.querySelector('.tg-scroll').scrollTo({ top: 99999, behavior: 'instant' }));
  await page.waitForTimeout(200);
  const p1 = await page.evaluate(() => document.querySelector('.tg-head').getBoundingClientRect().top);
  check('orbit week: header stays pinned', p0 === p1, `${p0} ${p1}`);
  await page.locator('.tg-scroll').focus();
  await page.keyboard.press('Home'); await page.waitForTimeout(900);
  check('orbit week: Home key scrolls to the top', (await page.evaluate(() => document.querySelector('.tg-scroll').scrollTop)) === 0);
  await page.screenshot({ path: 'C:/Users/tejas/peblo-wt/shots/cal24-orbit.png' });
} catch (e) {
  check('cal24-orbit ran', false, e.stack || String(e));
} finally {
  await finish();
}

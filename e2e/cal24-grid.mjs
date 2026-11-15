// Soft calendar: all 24 hours inside ONE internal scroll area (mockup docs/mockups/Calendar.dc.html).
// Header and all-day row stay pinned, the page never scrolls, events at 00:30 / 23:30 / across midnight show.
import { boot } from './lib.mjs';

const { base, api, page, check, finish } = await boot();
const SCROLL = '.tg-scroll';
const at = (d, h, m = 0) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m, 0).toISOString();
try {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(base + '/calendar');
  await page.locator('.tg-col').first().waitFor({ timeout: 15000 });
  const keys = await page.locator('.tg-col').evaluateAll((els) => els.map((e) => e.dataset.day));
  check('week view has 7 day columns', keys.length === 7, keys.join(','));
  const parse = (k) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
  const d0 = parse(keys[2]); const d1 = parse(keys[3]);

  await api('POST', '/api/todos', { text: 'Zero thirty', priority: 'medium', deadline: at(d0, 0, 30), startTime: '00:30', endTime: '01:15' });
  await api('POST', '/api/todos', { text: 'Late thirty', priority: 'medium', deadline: at(d0, 23, 30), startTime: '23:30', endTime: '23:50' });
  await api('POST', '/api/todos', { text: 'Overnight', priority: 'medium', deadline: at(d0, 22, 0), startTime: '22:00', endTime: '01:00' });
  await api('POST', '/api/todos', { text: 'Noon block', priority: 'high', deadline: at(d1, 12, 0), startTime: '12:00', endTime: '13:30' });
  await api('POST', '/api/todos', { text: 'All day thing', priority: 'low', deadline: at(d1, 23, 59) });
  await page.reload();
  await page.locator('.tg-col').first().waitFor({ timeout: 15000 });
  await page.locator('.tg-ev', { hasText: 'Noon block' }).waitFor({ timeout: 15000 });

  // 1. all 24 hour labels
  const labels = await page.locator('.tg-lbl').allInnerTexts();
  const want = Array.from({ length: 24 }, (_, h) => `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? 'AM' : 'PM'}`);
  check('all 24 hour labels exist (12 AM to 11 PM)', labels.length === 24 && labels.every((l, i) => l === want[i]), labels.join(','));

  // 2. one internal scroller, page does not scroll, rows are tall
  const m = await page.evaluate((sel) => {
    const s = document.querySelector(sel);
    const rows = document.querySelectorAll('.tg-hr');
    const hr = [...rows].slice(1, 3).map((e) => e.offsetTop); // CSS px (the app may scale the page)
    return { sh: s.scrollHeight, ch: s.clientHeight, doc: document.documentElement.scrollHeight, win: innerHeight, bodyScroll: document.scrollingElement.scrollHeight, hourPx: Math.round(hr[1] - hr[0]), oy: getComputedStyle(s).overflowY };
  }, SCROLL);
  check('the grid scrolls inside (scrollHeight > clientHeight, overflow-y auto)', m.sh > m.ch + 200 && m.oy === 'auto', JSON.stringify(m));
  check('hour rows are about 80px tall', Math.abs(m.hourPx - 80) <= 1, String(m.hourPx));
  check('the page itself does not scroll', m.doc <= m.win + 1, JSON.stringify(m));
  await page.mouse.wheel(0, 300);
  await page.waitForTimeout(150);
  check('mouse wheel on the page does not move the page', (await page.evaluate(() => window.scrollY)) === 0);

  // 3. opens near the current time
  await page.reload();
  await page.locator(SCROLL).waitFor();
  await page.waitForTimeout(500);
  const open = await page.evaluate((sel) => { const s = document.querySelector(sel); const n = new Date(); return { top: s.scrollTop, max: s.scrollHeight - s.clientHeight, exp: (n.getHours() + n.getMinutes() / 60 - 1.5) * 80 }; }, SCROLL);
  check('opens scrolled near the current time', Math.abs(open.top - Math.min(open.max, Math.max(0, open.exp))) < 60, JSON.stringify(open));

  // 4. header and all-day row stay pinned while scrolling
  const pin = async () => page.evaluate(() => ({ h: document.querySelector('.tg-head').getBoundingClientRect().top, a: document.querySelector('.tg-allday').getBoundingClientRect().top }));
  const p0 = await pin();
  await page.evaluate((sel) => { document.querySelector(sel).scrollTo({ top: 99999, behavior: 'instant' }); }, SCROLL);
  await page.waitForTimeout(150);
  const p1 = await pin();
  check('day header and all-day row stay pinned', p0.h === p1.h && p0.a === p1.a, JSON.stringify([p0, p1]));
  check('the all-day row shows the all-day task', (await page.locator('.tg-chip', { hasText: 'All day thing' }).count()) === 1);

  // 5. events at 00:30, 23:30 and across midnight
  const ev = async (name, nth = 0) => page.locator('.tg-ev', { hasText: name }).nth(nth).evaluate((e) => ({ s: Number(e.dataset.start), e: Number(e.dataset.end), cont: e.classList.contains('cont'), h: e.getBoundingClientRect().height, w: e.getBoundingClientRect().width }));
  const z = await ev('Zero thirty');
  check('event at 00:30 is rendered at 0.5h', z.s === 0.5 && z.e === 1.25 && z.h > 40, JSON.stringify(z));
  const l = await ev('Late thirty');
  check('event at 23:30 is rendered at 23.5h', l.s === 23.5 && l.e < 24.01 && l.h > 10, JSON.stringify(l));
  const o1 = await ev('Overnight', 0); const o2 = await ev('Overnight', 1);
  check('22:00 to 01:00 is split at midnight (22-24 here, 0-1 next day)', o1.s === 22 && o1.e === 24 && o2.s === 0 && o2.e === 1 && o2.cont, JSON.stringify([o1, o2]));
  check('events have real height (not squeezed)', o1.h > 120 && o1.w > 40, JSON.stringify(o1));
  // visible when scrolled to the bottom
  const vis = await page.locator('.tg-ev', { hasText: 'Late thirty' }).evaluate((e) => { const r = e.getBoundingClientRect(); const s = document.querySelector('.tg-scroll').getBoundingClientRect(); return r.top >= s.top - 1 && r.bottom <= s.bottom + 1; });
  check('the 23:30 event is fully visible at the bottom of the scroller', vis);

  // 6. hint pills when events are out of view
  await page.evaluate((sel) => document.querySelector(sel).scrollTo({ top: 800, behavior: 'instant' }), SCROLL);
  await page.waitForTimeout(200);
  const hints = await page.locator('.tg-hint').allInnerTexts();
  check('hint pills say how many events sit before and after the view', hints.some((t) => /event.* before/.test(t)) && hints.some((t) => /event.* after/.test(t)), hints.join(' | '));

  // 7. jump to now
  const today = new Date();
  const todayKey = keys.find((k) => parse(k).toDateString() === today.toDateString());
  const nowH = today.getHours() + today.getMinutes() / 60;
  if (todayKey) {
    const far = nowH > 12 ? 0 : 99999;
    await page.evaluate(([sel, t]) => document.querySelector(sel).scrollTo({ top: t, behavior: 'instant' }), [SCROLL, far]);
    await page.waitForTimeout(250);
    const btn = page.getByRole('button', { name: 'Jump to now' });
    check('Jump to now is offered when the now line is off screen', await btn.isVisible());
    await btn.click();
    await page.waitForTimeout(1100);
    const nowVis = await page.evaluate(() => { const n = document.querySelector('.tg-now'); const s = document.querySelector('.tg-scroll').getBoundingClientRect(); const r = n.getBoundingClientRect(); return r.top > s.top && r.bottom < s.bottom; });
    check('Jump to now brings the red now line into view', nowVis);
  } else check('today is in this week', false);

  // 8. keys
  const top = async () => page.evaluate((sel) => document.querySelector(sel).scrollTop, SCROLL);
  await page.locator(SCROLL).focus();
  await page.keyboard.press('Home'); await page.waitForTimeout(900);
  check('Home scrolls to 12 AM', (await top()) === 0, String(await top()));
  await page.keyboard.press('ArrowDown'); await page.waitForTimeout(700);
  const a = await top();
  check('Arrow down scrolls by half an hour', Math.abs(a - 40) <= 2, String(a));
  await page.keyboard.press('PageDown'); await page.waitForTimeout(900);
  const b = await top();
  const ch = await page.evaluate((sel) => document.querySelector(sel).clientHeight, SCROLL);
  check('PageDown scrolls by about a screen', b - a > ch * 0.8 && b - a < ch, `${a} -> ${b} (view ${ch})`);
  await page.keyboard.press('PageUp'); await page.waitForTimeout(900);
  check('PageUp scrolls back', (await top()) < b - ch * 0.8);
  await page.keyboard.press('End'); await page.waitForTimeout(1100);
  const end = await page.evaluate((sel) => { const s = document.querySelector(sel); return s.scrollHeight - s.clientHeight - s.scrollTop; }, SCROLL);
  check('End scrolls to 11 PM / the bottom', end <= 1, String(end));
  check('keys never moved the page', (await page.evaluate(() => window.scrollY)) === 0);

  // 9. overview rail: drag the red window
  await page.evaluate((sel) => document.querySelector(sel).scrollTo({ top: 0, behavior: 'instant' }), SCROLL);
  await page.waitForTimeout(200);
  const rail = await page.evaluate(() => { const t = document.querySelector('.tg-rail .track').getBoundingClientRect(); const w = document.querySelector('.tg-rail .win').getBoundingClientRect(); return { tx: t.left + t.width / 2, ty: t.top, th: t.height, wy: w.top + w.height / 2, wh: w.height }; });
  check('rail shows a red window that is a fraction of 24 hours', rail.wh > 20 && rail.wh < rail.th * 0.6, JSON.stringify(rail));
  await page.mouse.move(rail.tx, rail.wy);
  await page.mouse.down();
  await page.mouse.move(rail.tx, rail.wy + rail.th * 0.4, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  const dragged = await top();
  const expect = rail.th > 0 ? 0.4 * 1920 : 0;
  check('dragging the red window moves the schedule', dragged > expect * 0.8 && dragged < expect * 1.2, `${dragged} vs ~${expect}`);
  check('the red window followed the scroll', await page.evaluate(() => { const w = document.querySelector('.tg-rail .win').getBoundingClientRect(); const t = document.querySelector('.tg-rail .track').getBoundingClientRect(); return w.top > t.top + t.height * 0.3; }));

  // 10. day and month views keep working
  await page.getByRole('tab', { name: 'Day' }).click();
  await page.waitForTimeout(400);
  check('day view has the same 24 hour grid', (await page.locator('.tg-lbl').count()) === 24 && (await page.locator('.tg-col').count()) === 1);
  await page.getByRole('tab', { name: 'Month' }).click();
  await page.waitForTimeout(400);
  check('month view still shows', (await page.locator('.s-month-cell').count()) >= 28);
  await page.getByRole('tab', { name: 'Week' }).click();
  await page.waitForTimeout(300);
  check('side panel (mini month, next big thing) is still there', (await page.locator('.s-minical').count()) === 1 && (await page.locator('.s-big').count()) === 1);
  await page.screenshot({ path: 'C:/Users/tejas/peblo-wt/shots/cal24-soft.png' });
} catch (e) {
  check('cal24-grid ran', false, e.stack || String(e));
} finally {
  await finish();
}

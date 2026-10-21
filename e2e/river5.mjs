// River week: booked time per day, unscheduled tray with drag to a day.
import { boot, REPO } from './lib.mjs';
import path from 'path';

const { base, api, page, check, finish } = await boot();
const shot = (n) => page.screenshot({ path: path.join(REPO, '.shots', n + '.png') });
await page.setViewportSize({ width: 1440, height: 900 });
try {
  const day = (n) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + n); return d; };
  await api('POST', '/api/todos', { text: 'Sprint planning', deadline: day(1).toISOString(), startTime: '10:00', endTime: '12:00' });
  await api('POST', '/api/todos', { text: 'Write November report', priority: 'medium' });
  await page.goto(base + '/');
  await page.evaluate(() => { localStorage.setItem('peblo-style', 'river'); localStorage.setItem('peblo-river-zoom', 'week'); });
  await page.goto(base + '/');
  await page.locator('.r-river').waitFor({ timeout: 12000 });
  await page.waitForTimeout(1800);

  const booked = await page.locator('.r-booked').allInnerTexts();
  check('week: the busy day shows its booked time', booked.length === 1 && /2 h/.test(booked[0]), JSON.stringify(booked));
  check('week: a load bar is drawn', (await page.locator('.r-load').count()) === 1);
  const pebble = page.locator('.r-pebble', { hasText: 'Write November report' });
  check('tray: the unscheduled task is in the tray', await pebble.isVisible());
  await shot('river5-week');

  // Drag it onto tomorrow (index: 14 days back + today + 1)
  await page.evaluate(() => {
    const dt = new DataTransfer();
    const src = document.querySelector('.r-pebble');
    src.dispatchEvent(new DragEvent('dragstart', { dataTransfer: dt, bubbles: true }));
    const lane = document.querySelector('.r-lane.tasks');
    const r = lane.getBoundingClientRect();
    const x = r.left + 14 + 15 * 200 + 100;
    lane.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true, clientX: x, clientY: r.top + 20 }));
    lane.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true, clientX: x, clientY: r.top + 20 }));
  });
  await page.waitForTimeout(1500);
  const list = (await api('GET', '/api/todos')).todos || [];
  const t = list.find((x) => x.text === 'Write November report');
  const want = day(1);
  const got = t && t.deadline ? new Date(t.deadline) : null;
  check('tray: dropping plans the task for that day', !!got && got.toDateString() === want.toDateString(), String(t && t.deadline));
  check('tray: it leaves the tray', (await page.locator('.r-pebble').count()) === 0);
} catch (e) { check('no crash', false, String(e).slice(0, 300)); await shot('river5-fail').catch(() => {}); }
await finish();

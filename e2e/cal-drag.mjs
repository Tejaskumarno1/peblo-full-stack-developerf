// Calendar: drag to move, drag the bottom edge to resize, drag empty space to create, plain-words quick create, Undo.
import { boot } from './lib.mjs';

const { base, api, page, check, finish } = await boot();
const at = (d, h, m = 0) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m, 0).toISOString();
const parse = (k) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
try {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(base + '/calendar');
  await page.locator('.tg-col').first().waitFor({ timeout: 15000 });
  const keys = await page.locator('.tg-col').evaluateAll((els) => els.map((e) => e.dataset.day));
  const d2 = parse(keys[2]);
  await api('POST', '/api/todos', { text: 'Drag me', priority: 'medium', deadline: at(d2, 10, 0), startTime: '10:00', endTime: '11:00' });
  await api('POST', '/api/todos', { text: 'Clash buddy', priority: 'medium', deadline: at(d2, 10, 30), startTime: '10:30', endTime: '11:30' });
  await page.reload();
  const ev = page.locator('.tg-ev', { hasText: 'Drag me' });
  await ev.waitFor({ timeout: 15000 });
  await ev.scrollIntoViewIfNeeded();
  check('overlapping events show a Clash badge', (await page.locator('.tg-clash').count()) >= 1);

  const times = async (text) => {
    const r = await api('GET', '/api/todos');
    const list = r.todos || r;
    const t = list.find((x) => x.text === text);
    return t ? `${t.startTime}-${t.endTime}` : 'missing';
  };
  const box = await ev.boundingBox();
  // 1. Drag down one hour (80px) and one column to the right
  const colW = (await page.locator('.tg-col').nth(3).boundingBox()).x - (await page.locator('.tg-col').nth(2).boundingBox()).x;
  await page.mouse.move(box.x + box.width / 2, box.y + 20);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + colW / 2, box.y + 60, { steps: 4 });
  await page.mouse.move(box.x + box.width / 2 + colW, box.y + 100, { steps: 6 });
  check('a ghost with the new time shows while dragging', (await page.locator('.tg-ghost .tip').count()) === 1, await page.locator('.tg-ghost .tip').allInnerTexts().then((a) => a.join()));
  await page.screenshot({ path: 'cal-drag-ghost.png' });
  await page.mouse.up();
  await page.waitForTimeout(800);
  check('dropping saves the new time (11:00-12:00)', (await times('Drag me')) === '11:00-12:00', await times('Drag me'));
  const col3 = await page.locator('.tg-col').nth(3).locator('.tg-ev', { hasText: 'Drag me' }).count();
  check('the event now sits in the next day column', col3 === 1);
  check('an Undo toast appears', (await page.locator('.pb-undo').count()) === 1);
  await page.locator('.pb-undo button', { hasText: 'Undo' }).click();
  await page.waitForTimeout(800);
  check('Undo puts it back (10:00-11:00)', (await times('Drag me')) === '10:00-11:00', await times('Drag me'));

  // 2. Resize from the bottom edge by one hour
  const ev2 = page.locator('.tg-ev', { hasText: 'Drag me' });
  await ev2.hover();
  const b2 = await ev2.boundingBox();
  await page.mouse.move(b2.x + b2.width / 2, b2.y + b2.height - 3);
  await page.mouse.down();
  await page.mouse.move(b2.x + b2.width / 2, b2.y + b2.height + 40, { steps: 5 });
  await page.mouse.move(b2.x + b2.width / 2, b2.y + b2.height + 77, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(800);
  check('resizing changes the end time only (10:00-12:00)', (await times('Drag me')) === '10:00-12:00', await times('Drag me'));

  // 3. Drag on empty space opens quick create with that slot
  const col = await page.locator('.tg-col').nth(4).boundingBox();
  await page.locator('.tg-scroll').evaluate((e) => { e.style.scrollBehavior = 'auto'; e.scrollTop = 14.5 * 80; });
  await page.waitForTimeout(300);
  const canvas = await page.locator('.tg-canvas').boundingBox();
  const y0 = canvas.y + 15 * 80 + 4; // 3 PM
  await page.mouse.move(col.x + col.width / 2, y0);
  await page.mouse.down();
  await page.mouse.move(col.x + col.width / 2, y0 + 40, { steps: 4 });
  await page.mouse.move(col.x + col.width / 2, y0 + 80, { steps: 4 });
  await page.mouse.up();
  await page.locator('.s-qc').waitFor({ timeout: 5000 });
  check('quick create opens with 15:00 - 16:00', (await page.locator('.s-qc input[type=time]').evaluateAll((e) => e.map((x) => x.value))).join() === '15:00,16:00');

  // 4. Plain words fill the day and time
  await page.locator('.s-qc-text').fill('Lunch with Sam today 1pm for an hour');
  check('plain words show Understood chips', (await page.locator('.s-qc-chip').count()) === 2, await page.locator('.s-qc-chip').allInnerTexts().then((a) => a.join()));
  check('times follow the words (13:00, 14:00)', (await page.locator('.s-qc input[type=time]').evaluateAll((e) => e.map((x) => x.value))).join() === '13:00,14:00');
  await page.screenshot({ path: 'cal-quickcreate.png' });
  await page.locator('.s-qc-go').click();
  await page.waitForTimeout(800);
  check('the event is created with the cleaned-up title', (await times('Lunch with Sam')) === '13:00-14:00', await times('Lunch with Sam'));
  await page.screenshot({ path: 'cal-after.png' });
} catch (e) {
  check('no crash', false, String(e).slice(0, 300));
}
await finish();

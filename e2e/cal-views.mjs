// Calendar: agenda view, layers, peek panel, find a free slot, month drag between days.
import { boot } from './lib.mjs';

const { base, api, page, check, finish } = await boot();
const at = (d, h, m = 0) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m, 0).toISOString();
const find = async (text) => { const r = await api('GET', '/api/todos'); return (r.todos || r).find((x) => x.text === text); };
try {
  await page.setViewportSize({ width: 1440, height: 900 });
  const today = new Date();
  const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
  const later = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 3);
  await api('POST', '/api/todos', { text: 'Agenda meeting', priority: 'medium', deadline: at(tomorrow, 9, 0), startTime: '09:00', endTime: '12:00' });
  await api('POST', '/api/todos', { text: 'Plain task', priority: 'low', deadline: at(later, 23, 59) });
  await page.goto(base + '/calendar');
  await page.locator('.tg-col').first().waitFor({ timeout: 15000 });

  // Find a free slot: tomorrow 9-12 is busy, so a 60 min slot is never inside it
  await page.locator('.s-slot-row').first().waitFor({ timeout: 10000 });
  const rows = await page.locator('.s-slot-row').allInnerTexts();
  check('find a free slot lists up to 3 times', rows.length >= 1 && rows.length <= 3, rows.join(' | '));
  await page.locator('.s-slot-len button', { hasText: '2h' }).click();
  check('changing the length keeps a list', (await page.locator('.s-slot-row').count()) >= 1);
  await page.screenshot({ path: 'cal-week2.png' });
  await page.locator('.s-slot-row').first().click();
  await page.locator('.s-qc').waitFor({ timeout: 5000 });
  const t = await page.locator('.s-qc input[type=time]').evaluateAll((e) => e.map((x) => x.value));
  check('picking a slot opens quick create with a 2 hour span', t.length === 2 && (Number(t[1].split(':')[0]) - Number(t[0].split(':')[0])) === 2, t.join());
  await page.locator('.s-qc-no').click();

  // Layers
  await page.locator('.tg-ev', { hasText: 'Agenda meeting' }).first().waitFor({ timeout: 10000 }).catch(() => {});
  const before = await page.locator('.tg-ev').count();
  await page.locator('.s-layers button', { hasText: 'Meetings' }).click();
  check('turning Meetings off hides meetings', (await page.locator('.tg-ev').count()) < before, `${before} -> ${await page.locator('.tg-ev').count()}`);
  await page.locator('.s-layers button', { hasText: 'Meetings' }).click();

  // Peek panel
  await page.locator('.tg-ev', { hasText: 'Agenda meeting' }).first().click();
  await page.locator('.s-peek').waitFor({ timeout: 5000 });
  check('clicking an event opens the peek panel with its time', /09:00 - 12:00/.test(await page.locator('.s-peek').innerText()), await page.locator('.s-peek-when').innerText());
  await page.screenshot({ path: 'cal-peek.png' });
  await page.locator('.s-peek-actions button', { hasText: 'Done' }).click();
  await page.waitForTimeout(700);
  check('Done in the peek panel completes the task', (await find('Agenda meeting'))?.completed === true);
  await page.locator('.pb-undo button', { hasText: 'Undo' }).click();
  await page.waitForTimeout(700);
  check('Undo reopens it', (await find('Agenda meeting'))?.completed === false);

  // Agenda
  await page.locator('.s-seg button', { hasText: 'Agenda' }).click();
  await page.locator('.s-agenda-row').first().waitFor({ timeout: 5000 });
  const ag = await page.locator('.s-agenda').innerText();
  check('agenda lists both items grouped by day', /Agenda meeting/.test(ag) && /Plain task/.test(ag) && /All day/.test(ag), ag.replace(/\n/g, ' | ').slice(0, 160));
  await page.screenshot({ path: 'cal-agenda.png' });

  // Month drag
  await page.locator('.s-seg button', { hasText: 'Month' }).click();
  const chip = page.locator('.s-month-cell .ev', { hasText: 'Plain task' }).first();
  await chip.waitFor({ timeout: 5000 });
  const target = later.getDate() + 1; // the day after
  const cell = page.locator('.s-month-cell:not(.out)').filter({ has: page.locator('.n', { hasText: new RegExp(`^${target}$`) }) }).first();
  const dayCell = (await cell.count()) ? cell : page.locator('.s-month-cell .n', { hasText: new RegExp(`^${target}$`) }).first();
  await chip.dragTo(dayCell);
  await page.waitForTimeout(900);
  const moved = await find('Plain task');
  check('dragging a chip to another day moves its date', new Date(moved.deadline).getDate() === target, moved.deadline);
  await page.screenshot({ path: 'cal-month.png' });
} catch (e) {
  check('no crash', false, String(e).slice(0, 300));
}
await finish();

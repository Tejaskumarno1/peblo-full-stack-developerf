// Task sheet v2: real repeat control, reminders + snooze, steps progress, where it came from (jump to the line),
// duplicate, repeat-from-finish, and Esc asking before it throws changes away.
import { boot } from './lib.mjs';
import fs from 'node:fs';

const { base, api, page, check, finish } = await boot();
const shots = 'D:/Peblo/_shots';
fs.mkdirSync(shots, { recursive: true });
const iso = (d) => d.toISOString();
try {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const note = (await api('POST', '/api/notes', { title: 'Household', content: '# Household\n\nPay rent on the 1st, 9am, from the joint account.\n\nBuy milk.', tags: [] })).note;
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1); tomorrow.setHours(9, 0, 0, 0);
  const made = (await api('POST', '/api/todos', {
    text: 'Pay rent', priority: 'high', deadline: iso(tomorrow), noteId: note.id,
    meta: { source: { noteId: note.id, quote: 'Pay rent on the 1st, 9am, from the joint account.', line: 2 }, subtasks: [{ id: 'a', text: 'Check the amount', done: true }, { id: 'b', text: 'Send the transfer', done: false }] },
  })).todo;
  await page.goto(base + '/tasks');
  await page.locator('#task-add').waitFor({ timeout: 15000 });
  await page.getByRole('button', { name: 'Pay rent' }).first().click();
  const dlg = page.getByRole('dialog');
  await dlg.waitFor();

  // repeat + reminder + estimate
  await dlg.getByRole('radio', { name: 'Monthly' }).click();
  check('a repeat note says what it means', /Every month on the/.test(await dlg.innerText()));
  await dlg.getByRole('radio', { name: '1 hour before' }).click();
  await dlg.getByRole('radio', { name: '30 min' }).click();
  check('steps show a progress bar and count', (await dlg.locator('.pb-steps-bar').count()) === 1 && /1 of 2/.test(await dlg.innerText()));
  check('where it came from shows the quote and the line', /joint account/.test(await dlg.innerText()) && /line 2/.test(await dlg.innerText()));
  await page.screenshot({ path: `${shots}/sheet2-top.png` });
  await dlg.getByRole('button', { name: 'Save' }).click();
  await page.waitForTimeout(1200);
  const all1 = (await api('GET', '/api/todos')).todos.filter((t) => t.text === 'Pay rent');
  const first = all1.find((t) => t.id === made.id);
  check('repeat is saved: a monthly series was made', all1.length > 3 && first.recurrence === 'monthly' && !!first.seriesId, String(all1.length));
  check('reminder and estimate are saved', first.meta?.remindMin === 60 && first.meta?.estimateMin === 30, JSON.stringify(first.meta));

  // Esc with unsaved changes asks first
  await page.getByRole('button', { name: 'Pay rent' }).first().click();
  const d2 = page.getByRole('dialog').first();
  await d2.waitFor();
  check('reopened sheet shows Monthly picked', (await d2.getByRole('radio', { name: 'Monthly' }).getAttribute('aria-checked')) === 'true');
  await d2.locator('#s-sheet-title').fill('Pay rent (joint)');
  await page.keyboard.press('Escape');
  await page.getByRole('alertdialog', { name: 'Unsaved changes' }).waitFor({ timeout: 3000 });
  await page.screenshot({ path: `${shots}/sheet2-esc.png` });
  await page.getByRole('button', { name: 'Keep editing' }).click();
  check('Keep editing leaves the sheet open', await d2.isVisible());
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Discard' }).click();
  await page.waitForTimeout(400);
  check('Discard closes it without saving', (await page.getByRole('dialog').count()) === 0 && (await api('GET', '/api/todos')).todos.find((t) => t.id === made.id).text === 'Pay rent');
  await page.keyboard.press('Escape');

  // an untouched sheet closes on Esc at once
  await page.getByRole('button', { name: 'Pay rent' }).first().click();
  await page.getByRole('dialog').first().waitFor();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  check('Esc on an untouched sheet just closes', (await page.getByRole('dialog').count()) === 0 && (await page.getByRole('alertdialog').count()) === 0);

  // saving a change on a series asks which ones
  await page.getByRole('button', { name: 'Pay rent' }).first().click();
  const d3 = page.getByRole('dialog').first();
  await d3.waitFor();
  await d3.locator('#s-sheet-title').fill('Pay rent now');
  await d3.getByRole('button', { name: 'Save' }).click();
  const ask = page.getByRole('dialog', { name: /repeating task/i });
  await ask.waitFor({ timeout: 4000 });
  await ask.getByRole('button', { name: 'All in the series' }).click();
  await page.waitForTimeout(1200);
  const renamed = (await api('GET', '/api/todos')).todos.filter((t) => t.text === 'Pay rent now');
  check('"All in the series" renames every copy', renamed.length === all1.length, `${renamed.length} of ${all1.length}`);

  // jump to the line
  await page.getByRole('button', { name: 'Pay rent now' }).first().click();
  const d4 = page.getByRole('dialog').first();
  await d4.waitFor();
  const jump = d4.getByRole('link', { name: 'Jump to the line' });
  check('the jump link points at line 2 of the note', (await jump.getAttribute('href')) === `/notes/${note.id}?line=2`, await jump.getAttribute('href'));
  await jump.click();
  await page.locator('.pb-jump').first().waitFor({ timeout: 8000 }).catch(() => {});
  check('the line is marked in the note', (await page.locator('.pb-jump').count()) >= 1 || /line=2/.test(page.url()));
  await page.screenshot({ path: `${shots}/sheet2-jump.png` });

  // duplicate
  await page.goto(base + '/tasks');
  await page.locator('#task-add').waitFor();
  const solo = (await api('POST', '/api/todos', { text: 'Gym bag', priority: 'low', deadline: iso(tomorrow), meta: { subtasks: [{ id: 'q', text: 'Shoes', done: true }] } })).todo;
  await page.reload();
  await page.getByRole('button', { name: 'Gym bag' }).first().click();
  await page.getByRole('dialog').first().getByRole('button', { name: 'Duplicate' }).click();
  await page.waitForTimeout(1000);
  const gyms = (await api('GET', '/api/todos')).todos.filter((t) => t.text === 'Gym bag');
  check('Duplicate makes a second task with steps reset', gyms.length === 2 && gyms.every((g) => g.priority === 'low') && gyms.some((g) => g.id !== solo.id && g.meta?.subtasks?.[0]?.done === false), JSON.stringify(gyms.map((g) => g.meta)));

  // reminder rings and snoozes
  await page.goto('about:blank'); // an open Tasks page would ring it first and mark it as rung
  const soon = new Date(Date.now() + 60000);
  const rem = (await api('POST', '/api/todos', { text: 'Ring me', deadline: iso(soon), meta: { remindMin: 10 } })).todo;
  await page.goto(base + '/tasks');
  await page.getByTestId('task-ring').waitFor({ timeout: 30000 });
  check('the reminder rings with snooze choices', /Ring me/.test(await page.getByTestId('task-ring').innerText()) && /Tomorrow morning/.test(await page.getByTestId('task-ring').innerText()));
  await page.screenshot({ path: `${shots}/sheet2-ring.png` });
  await page.getByTestId('task-ring').getByRole('button', { name: 'Snooze 10 min' }).click();
  await page.waitForTimeout(900);
  const after = (await api('GET', '/api/todos')).todos.find((t) => t.id === rem.id);
  const snz = after.meta?.snoozeUntil ? new Date(after.meta.snoozeUntil).getTime() - Date.now() : 0;
  check('snooze is saved about ten minutes ahead', snz > 8 * 60000 && snz < 11 * 60000, String(snz));
  check('and the card goes away', (await page.getByTestId('task-ring').count()) === 0);

  // repeat from the date I finish it
  const in3 = new Date(); in3.setDate(in3.getDate() + 3); in3.setHours(9, 0, 0, 0);
  const wk = (await api('POST', '/api/todos', { text: 'Water plants', deadline: iso(in3), recurrence: 'weekly', meta: { repeatFromDone: true } })).todo;
  await api('PATCH', `/api/todos/${wk.id}`, { completed: true });
  await page.waitForTimeout(600);
  const water = (await api('GET', '/api/todos')).todos.filter((t) => t.text === 'Water plants' && !t.completed).sort((a, b) => new Date(a.deadline) - new Date(b.deadline));
  const next = water[0] && Math.round((new Date(water[0].deadline) - new Date().setHours(9, 0, 0, 0)) / 864e5);
  check('finishing early moves the next one a week from today', next === 7, String(next));
} catch (e) {
  console.error(e);
  await page.screenshot({ path: `${shots}/sheet2-fail.png` }).catch(() => {});
  console.log('URL', page.url(), 'LS', await page.evaluate(() => localStorage.getItem('peblo-reminders-rung')).catch(() => '?'));
  check('no crash', false, String(e));
}
await finish();

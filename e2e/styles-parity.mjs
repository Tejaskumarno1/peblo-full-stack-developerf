// Basics that every style has: River's task list (add, search, group, select, delete + undo), Soft's task search and filters,
// Orbit's saved searches, River's note history and AI actions, and calendar import/export in Settings for all three.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { boot } from './lib.mjs';
const { base, api, page, check, finish } = await boot();
const style = async (s, to) => {
  await page.goto(base + '/tasks');
  await page.evaluate((st) => { localStorage.setItem('peblo-style', st); localStorage.setItem('peblo-orbit-help-seen', '1'); }, s);
  await page.goto(base + to);
  await page.waitForTimeout(1300);
};
const todos = async () => (await api('GET', '/api/todos')).todos || [];
const at = (days, h, m = 0) => { const d = new Date(); d.setDate(d.getDate() + days); d.setHours(h, m, 0, 0); return d.toISOString(); };
try {
  await api('POST', '/api/todos', { text: 'Pay rent', deadline: at(-2, 9), priority: 'high', tags: ['home'] });
  await api('POST', '/api/todos', { text: 'Revise BCNF', deadline: at(0, 23, 58), tags: ['exams'] });
  await api('POST', '/api/todos', { text: 'Call mum', deadline: at(1, 10), priority: 'low' });
  await api('POST', '/api/todos', { text: 'Someday maybe' });

  // ---------- River: the task list ----------
  await page.goto(base + '/tasks');
  await page.evaluate(() => { localStorage.setItem('peblo-style', 'river'); localStorage.removeItem('peblo-river-tasks-opts'); });
  await page.goto(base + '/tasks');
  await page.locator('#r-task-add').waitFor({ timeout: 12000 });
  await page.waitForTimeout(800);
  const text = async () => page.locator('.r-tl').innerText();
  let t = await text();
  check('river list: grouped by when it is due', /Overdue/.test(t) && /Today/.test(t) && /Tomorrow/.test(t) && /No date/.test(t), t.slice(0, 200));
  await page.fill('#r-task-search', 'bcnf');
  await page.waitForTimeout(300);
  t = await text();
  check('river list: search narrows the list', /Revise BCNF/.test(t) && !/Pay rent/.test(t), t.slice(0, 200));
  await page.fill('#r-task-search', 'exams');
  await page.waitForTimeout(300);
  check('river list: search also finds tags', /Revise BCNF/.test(await text()));
  await page.fill('#r-task-search', '');

  await page.evaluate(() => localStorage.setItem('peblo-river-tasks-opts', JSON.stringify({ show: 'all', group: 'priority', sort: 'due' })));
  await page.reload();
  await page.locator('#r-task-add').waitFor();
  await page.waitForTimeout(800);
  t = await text();
  check('river list: group by priority and the choice is remembered', /High priority/.test(t) && /Medium priority/.test(t) && /Low priority/.test(t), t.slice(0, 200));

  await page.fill('#r-task-add', 'Water plants tomorrow !high #home');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.waitForTimeout(900);
  const plants = (await todos()).find((x) => x.text === 'Water plants');
  check('river list: quick add understands date, priority and tag', plants && plants.priority === 'high' && (plants.todoTags || plants.tags || []).includes('home'), JSON.stringify(plants));

  await page.getByRole('button', { name: 'Delete: Call mum' }).click();
  await page.waitForTimeout(400);
  check('river list: delete removes the row at once', !(await text()).includes('Call mum'));
  await page.getByRole('button', { name: 'Undo' }).click();
  await page.waitForTimeout(400);
  check('river list: Undo brings it back', (await text()).includes('Call mum'));
  await page.waitForTimeout(6500);
  check('river list: and it was never deleted', (await todos()).some((x) => x.text === 'Call mum'));

  await page.getByRole('button', { name: 'Select', exact: true }).click();
  await page.getByLabel('Select: Pay rent').check();
  await page.getByLabel('Select: Someday maybe').check();
  await page.getByRole('button', { name: 'Mark done' }).click();
  await page.waitForTimeout(900);
  const after = await todos();
  check('river list: bulk Mark done completes the selected tasks', after.find((x) => x.text === 'Pay rent')?.completed && after.find((x) => x.text === 'Someday maybe')?.completed && !after.find((x) => x.text === 'Call mum')?.completed);
  await page.getByRole('button', { name: 'Undo' }).click();
  await page.waitForTimeout(900);
  check('river list: bulk change can be undone', !(await todos()).find((x) => x.text === 'Pay rent')?.completed);

  // ---------- Soft: task search and filters ----------
  await style('soft', '/tasks');
  await page.fill('#s-task-search', 'rent');
  await page.waitForTimeout(300);
  let body = await page.locator('.s-tasks').innerText();
  check('soft tasks: search narrows the board', /Pay rent/.test(body) && !/Revise BCNF/.test(body), body.slice(0, 200));
  await page.fill('#s-task-search', '');
  await page.getByRole('tab', { name: 'High priority' }).click();
  await page.waitForTimeout(300);
  body = await page.locator('.s-tasks').innerText();
  check('soft tasks: the High priority filter keeps only those', /Pay rent/.test(body) && !/Call mum/.test(body), body.slice(0, 200));
  await page.getByRole('tab', { name: 'All' }).click();
  await page.getByRole('tab', { name: 'List' }).click();
  await page.getByLabel('Group tasks by').selectOption('priority');
  await page.waitForTimeout(300);
  body = await page.locator('.s-tasks').innerText();
  check('soft tasks: the list can be grouped by priority', /High priority/.test(body) && /Low priority/.test(body), body.slice(0, 250));
  await page.getByLabel('Group tasks by').selectOption('tag');
  await page.waitForTimeout(300);
  check('soft tasks: ...or by tag', /#exams/.test(await page.locator('.s-tasks').innerText()));

  // ---------- Soft: link and steps on a task ----------
  await style('soft', '/tasks');
  await page.getByRole('button', { name: 'Call mum', exact: true }).first().click();
  await page.getByLabel('Meeting or page link').fill('https://meet.google.com/abc-defg-hij');
  await page.getByLabel('New step').fill('Bring the notes');
  await page.getByRole('button', { name: 'Add step' }).click();
  await page.getByRole('button', { name: /^(Save|Done|Save task)$/ }).first().click();
  await page.waitForTimeout(1000);
  const mum = (await todos()).find((x) => x.text === 'Call mum');
  check('soft sheet: the link is saved on the task', mum?.meta?.link === 'https://meet.google.com/abc-defg-hij', JSON.stringify(mum?.meta));
  check('soft sheet: steps are saved on the task', mum?.meta?.subtasks?.[0]?.text === 'Bring the notes', JSON.stringify(mum?.meta));

  // ---------- River: steps in the drawer, and the link ----------
  await style('river', '/tasks');
  await page.getByRole('button', { name: /Call mum/ }).first().click();
  await page.waitForTimeout(1500);
  check('river drawer: shows the steps saved elsewhere and an Open link button', await page.getByText('Bring the notes').isVisible() && await page.getByRole('link', { name: 'Open link' }).isVisible());
  await page.getByLabel('New step').fill('Second step');
  await page.getByRole('button', { name: 'Add step' }).click();
  await page.waitForTimeout(900);
  const mum2 = (await todos()).find((x) => x.text === 'Call mum');
  check('river drawer: adding a step saves it', mum2?.meta?.subtasks?.length === 2, JSON.stringify(mum2?.meta));

  // ---------- Orbit: saved searches in the notes list ----------
  await api('POST', '/api/notes', { title: 'Alpha plan', content: 'alpha beta', tags: ['inbox'] });
  await api('POST', '/api/notes', { title: 'Gamma', content: 'other', tags: ['inbox'] });
  await style('orbit', '/notes');
  await page.fill('#o-note-search', 'alpha');
  await page.getByRole('button', { name: 'Save search' }).click();
  await page.fill('#o-note-search', '');
  await page.reload();
  await page.waitForTimeout(1200);
  check('orbit notes: a saved search is listed and survives a reload', await page.getByRole('group', { name: 'Saved searches' }).getByRole('button', { name: 'alpha', exact: true }).isVisible());
  await page.getByRole('group', { name: 'Saved searches' }).getByRole('button', { name: 'alpha', exact: true }).click();
  await page.waitForTimeout(500);
  check('orbit notes: clicking it runs the search', (await page.inputValue('#o-note-search')) === 'alpha');

  // ---------- River: note history and AI actions ----------
  const n = (await api('POST', '/api/notes', { title: 'History note', content: 'first version', tags: ['inbox'] })).note;
  await api('PUT', `/api/notes/${n.id}`, { content: 'second version, edited' });
  await style('river', `/notes/${n.id}`);
  await page.getByRole('button', { name: 'More' }).first().click();
  check('river note: the menu offers Version history and AI actions', await page.getByRole('menuitem', { name: 'Version history' }).isVisible() && await page.getByRole('menuitem', { name: 'Summarise with AI' }).isVisible());
  await page.getByRole('menuitem', { name: 'Version history' }).click();
  await page.waitForTimeout(900);
  check('river note: Version history opens a dialog', await page.getByRole('dialog', { name: 'Version history' }).isVisible());
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'More' }).first().click();
  await page.getByRole('menuitem', { name: 'Flashcards from this note' }).click();
  await page.waitForTimeout(900);
  check('river note: Flashcards opens the AI with the question and this note attached', /\/ai/.test(page.url()) && /Make 8 flashcards/.test(await page.locator('body').innerText()) && /History note/.test(await page.locator('body').innerText()), page.url());

  // ---------- Calendar file in Settings, all three styles ----------
  const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//test//EN', 'BEGIN:VEVENT', 'UID:parity-1@test', `DTSTART:${new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10).replace(/-/g, '')}T100000Z`, `DTEND:${new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10).replace(/-/g, '')}T110000Z`, 'SUMMARY:Imported planning call', 'END:VEVENT', 'END:VCALENDAR', ''].join('\r\n');
  const file = path.join(os.tmpdir(), 'parity.ics');
  fs.writeFileSync(file, ics);
  for (const s of ['soft', 'river', 'orbit']) {
    await style(s, '/settings/data');
    const there = await page.getByRole('button', { name: /Export calendar/ }).isVisible() && await page.getByText('Import calendar').isVisible();
    check(`${s} settings: Calendar file card has export and import`, there);
  }
  await style('orbit', '/settings/data');
  await page.locator('input[accept*="ics"]').setInputFiles(file);
  await page.waitForTimeout(1500);
  check('importing an .ics adds the meeting', (await todos()).some((x) => x.text === 'Imported planning call'), (await todos()).map((x) => x.text).join(','));
} catch (e) {
  check('ran to the end without an error', false, e.stack || e.message);
}
await finish();

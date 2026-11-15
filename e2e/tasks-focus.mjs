// Task and note split: one task in focus on the left with a timer, its working note on the right.
import { boot } from './lib.mjs';
import fs from 'node:fs';

const { base, api, page, check, finish } = await boot();
const shots = 'D:/Peblo/_shots';
fs.mkdirSync(shots, { recursive: true });
try {
  await page.setViewportSize({ width: 1280, height: 820 });
  const today = (h) => { const d = new Date(); d.setHours(h, 0, 0, 0); if (d < new Date()) d.setHours(23, 30, 0, 0); return d.toISOString(); };
  const bcnf = (await api('POST', '/api/todos', {
    text: 'Revise BCNF', priority: 'high', deadline: today(23), tags: ['exams'],
    meta: { estimateMin: 45, spentMin: 70, subtasks: [{ id: 'a', text: 'List the functional dependencies', done: true }, { id: 'b', text: 'Find the candidate keys', done: true }, { id: 'c', text: 'Check each dependency against the key', done: false }] },
  })).todo;
  const other = (await api('POST', '/api/todos', { text: 'Pay rent', deadline: today(23), priority: 'medium' })).todo;
  const work = (await api('POST', '/api/notes', { title: 'Databases revision', content: 'A relation is in BCNF when every determinant is a candidate key.\n\nSee [[Exam plan]].', tags: [] })).note;
  await api('PATCH', `/api/todos/${bcnf.id}`, { noteId: work.id });
  await api('POST', '/api/notes', { title: 'Exam plan', content: `Week plan: [Databases revision](/notes/${work.id})`, tags: [] });

  // entry from the board
  await page.goto(base + '/tasks');
  await page.locator('#task-add').waitFor({ timeout: 15000 });
  const card = page.locator('[data-testid="task-card"]', { hasText: 'Revise BCNF' }).first();
  await card.hover();
  await card.getByRole('link', { name: /Focus on/ }).click();
  const f = page.getByTestId('task-focus');
  await f.waitFor({ timeout: 8000 });
  check('opens the focus page for that task', /Revise BCNF/.test(await f.innerText()) && /\/tasks\/focus\//.test(page.url()));
  const ft = await f.innerText();
  check('shows chips: due, high, tag, estimate', /High/.test(ft) && /#exams/.test(ft) && /Est\. 45 min/.test(ft), ft.slice(0, 300));
  check('shows steps with count', /2 of 3/.test(ft));
  check('shows the queue position', /Task \d of 2 today/.test(ft), ft.slice(0, 120));
  check('timer counts down from 25:00 and shows logged time', /2[45]:\d\d/.test(await page.getByTestId('focus-timer').innerText()) && /1 h 10 min/.test(await page.getByTestId('focus-timer').innerText()));
  check('the working note is on the right with its text', await page.getByText('every determinant is a candidate key').first().waitFor({ timeout: 10000 }).then(() => true).catch(() => false), '');
  check('a strip says which other notes mention it', await page.getByText(/Mentioned in 1 other note/).first().waitFor({ timeout: 8000 }).then(() => true).catch(() => false), '');
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${shots}/focus-split.png` });

  // steps tick saves
  await f.getByLabel('Step: Check each dependency against the key').check();
  await page.waitForTimeout(900);
  const t1 = (await api('GET', '/api/todos')).todos.find((t) => t.id === bcnf.id);
  check('ticking a step is saved', t1.meta.subtasks.filter((s) => s.done).length === 3);

  // pause stops the timer and adds time
  await page.waitForTimeout(31000);
  await page.getByRole('button', { name: 'Pause' }).click();
  const c1 = await page.getByTestId('focus-timer').locator('.n').innerText();
  await page.waitForTimeout(2200);
  const c2 = await page.getByTestId('focus-timer').locator('.n').innerText();
  check('Pause stops the clock', c1 === c2 && /^2[34]:\d\d$/.test(c1), c1 + ' ' + c2);
  const t2 = (await api('GET', '/api/todos')).todos.find((t) => t.id === bcnf.id);
  check('time is added to the task when the timer stops', t2.meta.spentMin === 71, String(t2.meta.spentMin));

  // next / previous
  await page.getByRole('button', { name: 'Next task' }).click();
  await page.waitForTimeout(600);
  check('Next task moves to the other task', /Pay rent/.test(await page.getByTestId('task-focus').innerText()) && /Created when you first type/.test(await page.getByTestId('task-focus').innerText()));

  // working note is made when you first type
  const editor = page.locator('.bn-editor').first();
  await editor.waitFor({ timeout: 8000 });
  await editor.click();
  await page.keyboard.type('Transfer from the joint account');
  await page.waitForTimeout(2200);
  const rent = (await api('GET', '/api/todos')).todos.find((t) => t.id === other.id);
  check('typing creates a note and links it to the task', !!rent.noteId, JSON.stringify(rent.noteId));
  if (rent.noteId) {
    const nn = (await api('GET', `/api/notes/${rent.noteId}`)).note;
    check('the note holds what was typed and takes the task name', /joint account/.test(nn.content) && nn.title === 'Pay rent', `${nn.title} | ${nn.content}`);
  }
  await page.screenshot({ path: `${shots}/focus-newnote.png` });

  // mark done goes to the next and completes
  await page.getByRole('button', { name: 'Mark done' }).click();
  await page.waitForTimeout(1200);
  const done = (await api('GET', '/api/todos')).todos.find((t) => t.id === other.id);
  check('Mark done completes the task and moves on', done.completed === true && /Revise BCNF/.test(await page.getByTestId('task-focus').innerText().catch(() => '')));

  // Esc exits to the board
  await page.keyboard.press('Escape');
  await page.waitForURL(/\/tasks$/, { timeout: 5000 }).catch(() => {});
  check('Esc exits back to the Tasks board', /\/tasks$/.test(page.url()), page.url());
} catch (e) {
  console.error(e);
  check('no crash', false, String(e));
}
await finish();

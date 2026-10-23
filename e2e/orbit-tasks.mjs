// PEB-140/144/180/238-247: Orbit tasks: details, steps, estimate, labels, "waits for", board, assignments, done log, what next, bulk edit, quick dates.
import { boot } from './lib.mjs';
const { base, api, page, check, finish } = await boot();
const go = async (path) => {
  await page.goto(base + '/tasks');
  await page.evaluate(() => { localStorage.setItem('peblo-style', 'orbit'); localStorage.setItem('peblo-orbit-help-seen', '1'); });
  await page.goto(base + path);
  await page.waitForTimeout(1200);
};
const all = async () => { const r = await api('GET', '/api/todos'); return r.todos || r; };
const find = async (text) => (await all()).find((t) => t.text === text);
try {
  const at = new Date(); at.setHours(23, 59, 0, 0);
  const A = (await api('POST', '/api/todos', { text: 'Write report', deadline: at.toISOString(), priority: 'high', tags: ['dbms'] })).todo;
  const B = (await api('POST', '/api/todos', { text: 'Review report', deadline: at.toISOString() })).todo;
  await api('POST', '/api/todos', { text: 'Buy pens', deadline: at.toISOString(), priority: 'low' });
  await go('/tasks');

  // details, steps, estimate, label
  await page.getByRole('button', { name: 'Details Write report' }).click();
  await page.getByLabel('Task details').fill('Cover chapters 1 to 3');
  await page.getByLabel('Task details').blur();
  await page.getByLabel('New step').fill('Outline');
  await page.getByRole('button', { name: 'Add step' }).click();
  await page.waitForTimeout(500);
  await page.getByLabel('Time estimate').selectOption('60');
  await page.getByRole('button', { name: 'Label red' }).click();
  await page.waitForTimeout(700);
  let t = await find('Write report');
  check('details are saved on the task', t?.meta?.details === 'Cover chapters 1 to 3', JSON.stringify(t?.meta));
  check('a step is saved', t?.meta?.subtasks?.length === 1 && t.meta.subtasks[0].text === 'Outline');
  check('estimate and label are saved', t?.meta?.estimateMin === 60 && t?.meta?.label === 'red');
  check('the row shows steps and time', (await page.getByText('0/1 steps').count()) > 0 && (await page.getByText('1 h', { exact: true }).count()) > 0);
  await page.getByLabel('Step: Outline').click();
  await page.waitForTimeout(600);
  check('ticking a step updates the count', (await page.getByText('1/1 steps').count()) > 0);

  // waits for
  await page.getByRole('button', { name: 'Details Review report' }).click();
  await page.getByLabel('Add a task this waits for').selectOption({ label: 'Write report' });
  await page.waitForTimeout(700);
  check('a task that waits shows Blocked', (await page.getByText('Blocked', { exact: true }).count()) > 0);
  check('..and cannot be ticked yet', await page.getByLabel('Done: Review report').isDisabled());
  await page.getByLabel('Done: Write report').click();
  await page.waitForTimeout(800);
  check('..until what it waits for is done', !(await page.getByLabel('Done: Review report').isDisabled()));

  // label filter
  await page.getByLabel('Filter by label').selectOption('red');
  await page.waitForTimeout(300);
  check('the label filter keeps only that colour', (await page.getByLabel('Done: Buy pens').count()) === 0 && (await page.getByLabel('Done: Write report').count()) === 1);
  await page.getByLabel('Filter by label').selectOption('');

  // planned time for the day
  await api('PATCH', '/api/todos/' + B.id, { meta: { estimateMin: 240 } });
  const C = (await api('POST', '/api/todos', { text: 'Long study', deadline: at.toISOString(), meta: { estimateMin: 240 } })).todo;
  const D = (await api('POST', '/api/todos', { text: 'More study', deadline: at.toISOString(), meta: { estimateMin: 120 } })).todo;
  await go('/tasks');
  check('a day with too much planned says so', (await page.getByText(/planned \(too much\)/).count()) > 0);

  // board
  await page.getByRole('tab', { name: 'Board' }).click();
  await page.waitForTimeout(300);
  await page.locator('[data-col="todo"] .o-card-task', { hasText: 'Buy pens' }).getByRole('button', { name: 'Doing' }).click();
  await page.waitForTimeout(800);
  t = await find('Buy pens');
  check('moving a card to Doing saves it', t?.meta?.status === 'doing' && !t.completed);
  check('..and it sits in the Doing column', (await page.locator('[data-col="doing"] .o-card-task', { hasText: 'Buy pens' }).count()) === 1);
  await page.locator('[data-col="doing"] .o-card-task', { hasText: 'Buy pens' }).getByRole('button', { name: 'Done' }).click();
  await page.waitForTimeout(800);
  check('Done on a card completes the task', (await find('Buy pens'))?.completed === true);

  // assignments
  await go('/tasks');
  await page.getByRole('button', { name: 'Details Long study' }).click();
  await page.getByLabel('This is an assignment').click();
  await page.waitForTimeout(700);
  await page.getByRole('tab', { name: 'Assignments' }).click();
  check('an assignment appears under Not started', (await page.locator('[data-status="not-started"]', { hasText: 'Long study' }).count()) === 1);
  await page.getByLabel('Status of Long study').selectOption('in-progress');
  await page.waitForTimeout(700);
  check('..and moves to In progress', (await page.locator('[data-status="in-progress"]', { hasText: 'Long study' }).count()) === 1);
  await page.getByLabel('Status of Long study').selectOption('submitted');
  await page.waitForTimeout(700);
  check('..and Submitted completes it', (await find('Long study'))?.completed === true);

  // done log
  await page.getByRole('tab', { name: 'Done' }).click();
  await page.waitForTimeout(300);
  check('the Done tab lists what was finished', (await page.getByText('Write report').count()) > 0 && (await page.getByText('Buy pens').count()) > 0);
  await page.locator('.o-donelog .o-task', { hasText: 'Buy pens' }).getByRole('button', { name: 'Not done' }).click();
  await page.waitForTimeout(800);
  check('Not done brings a task back', (await find('Buy pens'))?.completed === false);

  // what next
  await go('/tasks');
  await page.getByRole('button', { name: 'What next?' }).click();
  const first = await page.locator('.o-next strong').innerText();
  check('What next suggests a task with a reason', first.length > 0 && (await page.locator('.o-next .o-quiet').innerText()).length > 0, first);
  await page.getByRole('button', { name: 'Skip' }).click();
  const second = await page.locator('.o-next strong').innerText();
  check('Skip moves on to another task', second !== first, `${first} -> ${second}`);
  await page.getByRole('button', { name: 'Close' }).click();

  // bulk edit with undo
  await page.getByRole('button', { name: 'Select', exact: true }).click();
  await page.getByLabel('Select Review report').check();
  await page.getByLabel('Select More study').check();
  await page.getByRole('button', { name: 'Move to tomorrow' }).click();
  await page.waitForTimeout(900);
  const tomorrow = new Date(Date.now() + 86400000).toDateString();
  check('bulk move changes every selected task', [(await find('Review report')), (await find('More study'))].every((x) => new Date(x.deadline).toDateString() === tomorrow));
  await page.getByRole('button', { name: 'Undo' }).click();
  await page.waitForTimeout(900);
  check('..and Undo puts them back', new Date((await find('More study')).deadline).toDateString() === new Date().toDateString());
  await page.getByLabel('Select Review report').check().catch(() => {});
  await page.getByLabel('Label selected').selectOption('blue');
  await page.waitForTimeout(800);
  check('bulk label sets the colour', (await find('Review report'))?.meta?.label === 'blue');
  await page.getByRole('button', { name: 'Cancel' }).click();

  // quick date and live preview
  await page.getByLabel('New task').fill('Read chapter 4 tomorrow 6pm !high #sql');
  const pv = await page.locator('.o-preview').innerText();
  check('typing a task previews what will be added', /Read chapter 4/.test(pv) && /high priority/.test(pv) && /#sql/.test(pv), pv);
  await page.getByLabel('New task').fill('');
  await page.getByRole('button', { name: 'Edit More study' }).click();
  await page.getByLabel('Quick date').fill('+3');
  const want = new Date(); want.setDate(want.getDate() + 3);
  const val = await page.getByLabel('Task date').inputValue();
  check('a quick date like +3 fills the date', val === `${want.getFullYear()}-${String(want.getMonth() + 1).padStart(2, '0')}-${String(want.getDate()).padStart(2, '0')}`, val);
} catch (e) {
  check('script ran to the end', false, String(e).slice(0, 300));
}
await finish();

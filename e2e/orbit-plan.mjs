// Round 8: Orbit planning: Today view, exam countdown, focus timer with logged time, time report.
import { boot } from './lib.mjs';
const { base, api, page, check, finish } = await boot();
const go = async (path) => {
  await page.goto(base + '/tasks');
  await page.evaluate(() => { localStorage.setItem('peblo-style', 'orbit'); localStorage.setItem('peblo-orbit-help-seen', '1'); });
  await page.goto(base + path);
  await page.waitForTimeout(1300);
};
const find = async (text) => ((await api('GET', '/api/todos')).todos).find((t) => t.text === text);
try {
  const at = new Date(); at.setHours(23, 59, 0, 0);
  await api('POST', '/api/todos', { text: 'Lab 6 file', deadline: at.toISOString(), tags: ['sql'] });
  await api('POST', '/api/todos', { text: 'Not today', deadline: new Date(Date.now() + 3 * 864e5).toISOString() });
  await api('POST', '/api/notes', { title: 'Joins note', content: 'A join combines rows from two tables.', tags: ['sql'] });
  await go('/tasks');

  await page.getByRole('tab', { name: 'Today' }).click();
  await page.waitForTimeout(300);
  check('Today lists what is due today only', (await page.getByLabel('Done today: Lab 6 file').count()) === 1 && (await page.getByText('Not today').count()) === 0);
  check('..the notes edited today', (await page.getByRole('link', { name: /Joins note/ }).count()) === 1);
  check('..and a quiz link for a topic', (await page.getByRole('link', { name: /^Quiz / }).count()) === 1);
  await page.getByLabel('Done today: Lab 6 file').click();
  await page.waitForTimeout(800);
  check('a task can be ticked from Today', (await find('Lab 6 file'))?.completed === true);

  // exam countdown
  await page.getByLabel('Exam topic').selectOption('sql');
  const in5 = new Date(); in5.setDate(in5.getDate() + 5);
  const v = `${in5.getFullYear()}-${String(in5.getMonth() + 1).padStart(2, '0')}-${String(in5.getDate()).padStart(2, '0')}`;
  await page.getByLabel('Exam date').fill(v);
  await page.getByRole('button', { name: 'Set exam' }).click();
  await page.waitForTimeout(900);
  check('an exam shows the days left', (await page.getByText('5 days left').count()) === 1);
  await go('/tasks');
  await page.getByRole('tab', { name: 'Today' }).click();
  check('..and it is remembered', (await page.getByText('5 days left').count()) === 1);

  // focus timer
  await page.getByRole('tab', { name: 'List' }).click();
  await page.getByRole('button', { name: 'Details Not today' }).click();
  await page.getByRole('button', { name: 'Focus 25 min' }).click();
  check('the focus timer appears with a countdown', (await page.getByRole('timer').count()) === 1 && /2[45]:\d\d/.test(await page.getByRole('timer').innerText()));
  await page.evaluate(() => { const o = Date.now; Date.now = () => o() + 26 * 60000; });
  await page.waitForTimeout(2500);
  check('it stops itself when the time is up', (await page.getByRole('timer').count()) === 0);
  await page.waitForTimeout(800);
  check('..and logs 25 minutes on the task', (await find('Not today'))?.meta?.spentMin === 25, JSON.stringify((await find('Not today'))?.meta));
  await page.getByRole('tab', { name: 'Time' }).click();
  check('the Time tab adds it up', (await page.getByText('25 min logged in total').count()) + (await page.getByText('25 min', { exact: false }).count()) > 0);
} catch (e) {
  check('script ran to the end', false, String(e).slice(0, 300));
}
await finish();

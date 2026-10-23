// Round 9: topic manager: list with counts, rename, merge, delete, colour; the same through the API.
import { boot } from './lib.mjs';
const { base, api, page, check, finish } = await boot();
const go = async (path) => {
  await page.goto(base + '/tasks');
  await page.evaluate(() => { localStorage.setItem('peblo-style', 'orbit'); localStorage.setItem('peblo-orbit-help-seen', '1'); });
  await page.goto(base + path);
  await page.waitForTimeout(1300);
};
const tags = async () => (await api('GET', '/api/tags')).tags;
const open = async () => { await page.evaluate(() => window.dispatchEvent(new Event('peblo:topics'))); await page.waitForTimeout(600); };
try {
  await api('POST', '/api/notes', { title: 'Alpha one', content: 'x', tags: ['alpha'] });
  await api('POST', '/api/notes', { title: 'Alpha two', content: 'x', tags: ['alpha', 'beta'] });
  await api('POST', '/api/notes', { title: 'Beta one', content: 'x', tags: ['beta'] });
  await api('POST', '/api/todos', { text: 'Alpha task', tags: ['alpha'] });

  const t0 = await tags();
  check('the API lists topics with note and task counts', t0.find((t) => t.name === 'alpha')?.notes === 2 && t0.find((t) => t.name === 'alpha')?.todos === 1, JSON.stringify(t0));

  await go('/');
  await open();
  await page.getByText(/notes · \d+ tasks?/).first().waitFor({ timeout: 8000 }).catch(() => {});
  const rowText = await page.locator('.o-topic-row').allInnerTexts();
  check('the manager lists the topics with counts', rowText.some((x) => /alpha/i.test(x) && /2 notes/.test(x) && /1 task/.test(x)), JSON.stringify(rowText));

  await page.getByRole('button', { name: 'Rename alpha' }).click();
  await page.getByLabel('New name for alpha').fill('gamma');
  await page.getByRole('button', { name: 'Save' }).click();
  await page.waitForTimeout(900);
  const t1 = await tags();
  check('rename moves the notes and tasks to the new name', !t1.some((t) => t.name === 'alpha') && t1.find((t) => t.name === 'gamma')?.notes === 2 && t1.find((t) => t.name === 'gamma')?.todos === 1, JSON.stringify(t1));

  await page.getByRole('button', { name: 'Rename gamma' }).click();
  await page.getByLabel('New name for gamma').fill('beta');
  check('typing an existing name offers Merge', (await page.getByRole('button', { name: 'Merge' }).count()) === 1);
  await page.getByRole('button', { name: 'Merge' }).click();
  await page.waitForTimeout(900);
  const t2 = await tags();
  const beta = t2.find((t) => t.name === 'beta');
  check('merge puts everything on one topic without duplicates', !t2.some((t) => t.name === 'gamma') && beta?.notes === 3 && beta?.todos === 1, JSON.stringify(t2));

  await page.getByRole('button', { name: 'blue for beta' }).click();
  await page.waitForTimeout(700);
  check('a colour can be chosen for a topic', (await page.getByRole('button', { name: 'blue for beta' }).getAttribute('aria-pressed')) === 'true');

  await page.getByRole('button', { name: 'Delete beta' }).click();
  check('delete asks for a second click', (await page.getByRole('button', { name: 'Delete beta' }).innerText()).includes('Confirm'));
  await page.getByRole('button', { name: 'Delete beta' }).click();
  await page.waitForTimeout(900);
  const t3 = await tags();
  const notes = (await api('GET', '/api/notes')).notes;
  check('delete takes the topic off but keeps the notes', !t3.some((t) => t.name === 'beta') && notes.length === 3);
  check('..and off the tasks', ((await api('GET', '/api/todos')).todos.find((t) => t.text === 'Alpha task').todoTags || []).length === 0);

  const bad = await api('POST', '/api/tags/rename', { from: 'inbox', to: 'x' });
  check('the built-in inbox cannot be renamed', !!bad.error, JSON.stringify(bad));
} catch (e) {
  check('script ran to the end', false, String(e).slice(0, 300));
}
await finish();

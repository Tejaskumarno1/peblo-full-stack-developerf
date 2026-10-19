// Round 12: Orbit getting-started checklist on the map.
import { boot } from './lib.mjs';
const { base, api, page, check, finish } = await boot();
const go = async (path) => {
  await page.goto(base + '/tasks');
  await page.evaluate(() => { localStorage.setItem('peblo-style', 'orbit'); localStorage.setItem('peblo-orbit-help-seen', '1'); });
  await page.goto(base + path);
  await page.waitForTimeout(1800);
};
const box = () => page.getByRole('complementary', { name: 'Getting started' });
try {
  await api('POST', '/api/notes', { title: 'First', content: 'hello', tags: ['alpha'] });
  await go('/');
  check('the map shows a getting-started card', (await box().count()) === 1);
  check('..with 2 of 4 steps done (topic, note)', (await box().innerText()).includes('2 of 4'));
  check('..and still-to-do steps are buttons', (await box().getByRole('button', { name: 'Add a task' }).count()) === 1);
  check('..while done steps are plain text', (await box().getByRole('button', { name: 'Write a note' }).count()) === 0);

  await api('POST', '/api/todos', { text: 'Do a thing' });
  await go('/');
  check('adding a task moves the progress on', (await box().innerText()).includes('3 of 4'));
  await box().getByRole('button', { name: 'Take a quiz' }).click();
  await page.waitForTimeout(800);
  check('a step button takes you to that part of the app', /\/ai/.test(page.url()));

  await go('/');
  await box().getByRole('button', { name: 'Hide getting started' }).click();
  await page.waitForTimeout(800);
  check('hiding the card removes it', (await box().count()) === 0);
  await go('/');
  check('..and it stays hidden after a reload', (await box().count()) === 0);
} catch (e) {
  check('script ran to the end', false, String(e).slice(0, 300));
}
await finish();

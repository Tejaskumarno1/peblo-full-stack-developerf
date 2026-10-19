// Round 6: Orbit note view: icon, favourite, lock, focus mode, word count, duplicate, linked tasks.
import { boot } from './lib.mjs';
const { base, api, page, check, finish } = await boot();
const go = async (path) => {
  await page.goto(base + '/tasks');
  await page.evaluate(() => { localStorage.setItem('peblo-style', 'orbit'); localStorage.setItem('peblo-orbit-help-seen', '1'); });
  await page.goto(base + path);
  await page.waitForTimeout(1500);
};
const notes = async () => { const r = await api('GET', '/api/notes'); return r.notes || r; };
try {
  const n = (await api('POST', '/api/notes', { title: 'Normal forms', content: 'First normal form means every cell holds one value. Second normal form removes partial dependencies.', tags: ['dbms'] })).note;
  const t = (await api('POST', '/api/todos', { text: 'Revise normal forms', noteId: n.id })).todo;
  await go('/notes/' + n.id);

  const wc = await page.getByLabel('Word count').innerText();
  check('the note shows a word count and reading time', /^\d+ words? · \d+ characters · 1 min read$/.test(wc.trim()), wc);

  await page.getByRole('button', { name: 'Add to favourites' }).click();
  await page.waitForTimeout(700);
  check('favouriting is saved on the note', (await notes()).find((x) => x.id === n.id)?.meta?.favourite === true);
  check('..and the star shows it is on', (await page.getByRole('button', { name: 'Remove from favourites' }).getAttribute('aria-pressed')) === 'true');

  await page.getByRole('button', { name: 'Add an icon' }).click();
  await page.getByRole('menuitem', { name: 'Use 🧠' }).click();
  await page.waitForTimeout(700);
  check('an icon is saved', (await notes()).find((x) => x.id === n.id)?.meta?.emoji === '🧠');

  await page.getByRole('checkbox', { name: 'Done: Revise normal forms' }).click();
  await page.waitForTimeout(800);
  check('a task on the note can be ticked from the note', (await api('GET', '/api/todos')).todos.find((x) => x.id === t.id)?.completed === true);

  await page.getByRole('button', { name: 'Focus mode' }).click();
  check('focus mode hides the side panel', !(await page.locator('.o-rail').isVisible()));
  await page.keyboard.press('Escape');
  check('..and Escape brings it back', await page.locator('.o-rail').isVisible());

  await page.getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitem', { name: 'Lock (read only)' }).click();
  await page.waitForTimeout(700);
  check('a locked note cannot be retitled', await page.locator('#o-note-title').isDisabled());
  check('..and says it is locked', (await page.getByText('This note is locked').count()) === 1);
  check('..and the lock is saved', (await notes()).find((x) => x.id === n.id)?.meta?.locked === true);
  await page.getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitem', { name: 'Unlock (allow editing)' }).click();
  await page.waitForTimeout(700);
  check('unlocking allows editing again', !(await page.locator('#o-note-title').isDisabled()));

  await page.getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitem', { name: 'Duplicate' }).click();
  await page.waitForTimeout(1500);
  const all = await notes();
  const copy = all.find((x) => x.title === 'Normal forms (copy)');
  check('Duplicate makes a copy with the same text and topic', !!copy && copy.id !== n.id && (copy.tags || []).includes('dbms'));
  check('..and opens it', page.url().endsWith('/notes/' + copy?.id));
} catch (e) {
  check('script ran to the end', false, String(e).slice(0, 300));
}
await finish();

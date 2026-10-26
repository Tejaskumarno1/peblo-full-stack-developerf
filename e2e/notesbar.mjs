// Soft notes: View menu (sort, group), link-a-task card, full screen.
import { boot } from './lib.mjs';

const { base, api, page, check, finish } = await boot();
try {
  const mk = async (title, tags, content = 'Body') => (await api('POST', '/api/notes', { title, content, tags })).note;
  const a = await mk('Alpha', ['os', 'exams'], '# Intro\nhello\n## Part two\nworld');
  await mk('Beta', ['os']);
  await mk('Gamma', ['dbms', 'exams']);
  await mk('Zeta', ['dbms']);
  await api('POST', '/api/todos', { text: 'Sched practice', priority: 'medium' });
  await page.goto(base + '/notes');
  await page.locator('.s-notes-list.np').waitFor({ timeout: 15000 });
  const rows = async () => (await page.locator('.s-note-row .t').allTextContents()).map((x) => x.trim());

  // sort and group now live in the one View menu
  await page.locator('.np-view').click();
  const pop = page.getByRole('dialog', { name: 'View options' });
  await pop.getByRole('radio', { name: 'Title' }).click();
  await page.waitForTimeout(300);
  let r = await rows();
  check('sort by title', r.join('|') === [...r].sort((x, y) => x.localeCompare(y)).join('|'), r.join('|'));
  await pop.getByRole('radio', { name: 'Tag' }).click();
  await page.waitForTimeout(300);
  const heads = await page.locator('.s-grp-h').allTextContents();
  check('group by tag shows headings', heads.some((h) => /#exams/.test(h)), heads.join('|'));
  await page.keyboard.press('Escape');
  await page.screenshot({ path: 'C:/Users/tejas/peblo-e2e/notesbar.png' });

  // link-a-task card
  await page.goto(base + `/notes/${a.id}`);
  await page.locator('#s-note-title').waitFor();
  await page.getByRole('button', { name: 'Link existing' }).click();
  const card = page.getByRole('dialog', { name: 'Link a task' });
  check('the link card has its own title', await card.isVisible() && /Link a task/.test(await card.textContent()));
  await card.getByLabel('Search tasks').fill('sched');
  check('the card offers to create a task', (await card.getByRole('button', { name: /Create/ }).count()) === 1);
  await card.locator('.s-linker-row', { hasText: 'Sched practice' }).click();
  await page.waitForTimeout(700);
  check('picking a task links it', (await page.locator('.s-side-task', { hasText: 'Sched practice' }).count()) === 1);

  // full screen
  await page.getByRole('button', { name: /Full screen/ }).click();
  await page.waitForTimeout(400);
  check('full screen hides the notes list and side rail', !(await page.locator('.s-notes-list').isVisible()) && !(await page.locator('.s-note-side').isVisible()));
  const outline = await page.locator('.s-focus-outline button').allTextContents();
  check('full screen shows the outline', outline.includes('Intro') && outline.includes('Part two'), outline.join('|'));
  await page.screenshot({ path: 'C:/Users/tejas/peblo-e2e/focus.png' });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  check('Esc leaves full screen', await page.locator('.s-notes-list').isVisible());
} catch (e) {
  console.error(e);
  check('no crash', false, String(e));
}
await finish();

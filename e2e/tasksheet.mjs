// Soft Studio task sheet: set up a task after adding, open and edit a task, see linked notes both ways.
import { boot } from './lib.mjs';

const { base, api, page, check, finish } = await boot();
try {
  const note = (await api('POST', '/api/notes', { title: 'Operating systems', content: 'Scheduling notes', tags: ['os'] })).note;
  await page.goto(base + '/tasks');
  await page.locator('#task-add').waitFor({ timeout: 15000 });
  await page.locator('#task-add').fill('Read about scheduling');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  const dlg = page.getByRole('dialog');
  await dlg.waitFor({ timeout: 6000 }).catch(() => {});
  check('adding a task opens the set-up sheet', await dlg.isVisible().catch(() => false));
  await dlg.getByRole('button', { name: 'Tomorrow' }).click();
  await dlg.getByLabel('Due time').fill('18:30');
  await dlg.getByRole('radio', { name: 'High' }).click();
  await dlg.getByLabel('Add a tag').fill('exams');
  await page.keyboard.press('Enter');
  await dlg.getByRole('button', { name: '+ Link a note' }).click();
  await dlg.getByRole('button', { name: 'Operating systems' }).click();
  await page.screenshot({ path: 'C:/Users/tejas/peblo-e2e/tasksheet.png' });
  await dlg.getByRole('button', { name: 'Done' }).click();
  await page.waitForTimeout(900);
  const todos = (await api('GET', '/api/todos')).todos;
  const t = todos.find((x) => x.text === 'Read about scheduling');
  check('due date, priority, tag and note are saved', !!t && !!t.deadline && t.priority === 'high' && (t.todoTags || t.tags || []).includes('exams') && t.noteId === note.id, JSON.stringify(t));

  // open the task by clicking it
  await page.getByRole('button', { name: 'Read about scheduling' }).first().click();
  const edit = page.getByRole('dialog');
  await edit.waitFor({ timeout: 5000 });
  check('clicking a task opens it with its note', (await edit.textContent()).includes('Operating systems'));
  await edit.locator('#s-sheet-title').fill('Read about scheduling algorithms');
  await edit.getByRole('button', { name: 'Save' }).click();
  await page.waitForTimeout(800);
  check('an edited title is saved', (await page.getByRole('button', { name: 'Read about scheduling algorithms' }).count()) > 0);

  // the note shows the task
  await page.goto(base + `/notes/${note.id}`);
  await page.locator('#s-note-title').waitFor();
  check('the note lists the connected task', (await page.locator('.s-side-task', { hasText: 'scheduling algorithms' }).count()) === 1);
  await page.locator('.s-linked-open', { hasText: 'scheduling' }).click();
  check('a task opens from the note', await page.getByRole('dialog').isVisible());
  await page.getByRole('button', { name: 'Close' }).click();
  await page.screenshot({ path: 'C:/Users/tejas/peblo-e2e/tasksheet-note.png' });
} catch (e) {
  console.error(e);
  check('no crash', false, String(e));
}
await finish();

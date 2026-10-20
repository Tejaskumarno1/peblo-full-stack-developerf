// Share links that allow editing: the guest edits and it saves, view-only stays read only, conflicts are caught.
import { boot } from './lib.mjs';

const { base, api, page, ctx, check, finish } = await boot();
try {
  const note = (await api('POST', '/api/notes', { title: 'Team note', content: 'Original line', tags: [] })).note;
  const todo = (await api('POST', '/api/todos', { text: 'Team task', priority: 'medium' })).todo;

  // the owner picks "Can edit" in the dialog
  await page.goto(base + '/notes/' + note.id);
  await page.locator('.s-note-row', { hasText: 'Team note' }).first().waitFor({ timeout: 15000 });
  await page.getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitem', { name: /Share link/ }).click();
  const dlg = page.getByRole('dialog', { name: /Share this note/ });
  await dlg.getByRole('radio', { name: 'Can edit' }).click();
  await dlg.getByRole('button', { name: /Create link/ }).click();
  await dlg.getByLabel('Share link').waitFor({ timeout: 5000 });
  const url = await dlg.getByLabel('Share link').inputValue();
  const tok = url.split('/').pop();
  check('dialog saved "Can edit"', (await api('GET', `/api/share/note/${note.id}`)).edit === true);
  await page.screenshot({ path: 'C:/Users/tejas/peblo-e2e/share-edit.png' });

  // a guest edits through the link
  const guest = await ctx.browser().newContext();
  const g = await guest.newPage();
  await g.goto(url);
  const ed = g.locator('.bn-editor');
  await ed.waitFor({ timeout: 15000 });
  check('guest sees the editor', true);
  check('guest has no AI menu or backlinks', (await g.locator('.block-editor-container').count()) === 1);
  await ed.click();
  await g.keyboard.press('Control+End');
  await g.keyboard.type(' guest was here');
  await g.getByRole('status').filter({ hasText: 'Saved' }).waitFor({ timeout: 8000 });
  await g.waitForTimeout(500);
  const after = (await api('GET', `/api/notes/${note.id}`)).note;
  check('guest edit reached the owner note', /guest was here/.test(after.content), after.content);

  // owner changes it meanwhile -> guest gets a conflict instead of overwriting
  await api('PATCH', `/api/notes/${note.id}`, { content: 'Owner rewrote everything' });
  await ed.click();
  await g.keyboard.press('Control+End');
  await g.keyboard.type(' more');
  await g.getByRole('alert').filter({ hasText: 'Someone else changed' }).waitFor({ timeout: 8000 });
  check('conflict is shown, nothing overwritten', (await api('GET', `/api/notes/${note.id}`)).note.content === 'Owner rewrote everything');
  await g.getByRole('button', { name: 'Keep mine' }).click();
  await g.getByRole('status').filter({ hasText: 'Saved' }).waitFor({ timeout: 8000 });
  check('Keep mine saves the guest copy', /more/.test((await api('GET', `/api/notes/${note.id}`)).note.content));

  // view only: a guest cannot save
  await api('POST', `/api/share/note/${note.id}`, { edit: false });
  const denied = await g.request.put(`${base}/api/public/note/${tok}`, { data: { content: 'hacked' } });
  check('view-only link refuses edits', denied.status() === 403, String(denied.status()));
  check('and the note is unchanged', !/hacked/.test((await api('GET', `/api/notes/${note.id}`)).note.content));

  // task: tick it off through the link
  const tt = (await api('POST', `/api/share/todo/${todo.id}`, { edit: true })).token;
  await g.goto(`${base}/s/task/${tt}`);
  await g.getByRole('button', { name: 'Mark as done' }).click();
  await g.getByRole('button', { name: /Done/ }).waitFor({ timeout: 5000 });
  const todos = await api('GET', '/api/todos');
  const mine = (todos.todos || todos).find?.((x) => x.id === todo.id);
  check('guest ticked the task on the owner account', mine?.completed === true, JSON.stringify(mine));
  await guest.close();
} catch (e) {
  check('shareedit ran', false, String(e));
} finally {
  await finish();
}

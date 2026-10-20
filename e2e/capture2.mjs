// Soft quick capture: paste a screenshot, attach, keep open, note mode with checklist tasks.
import { boot } from './lib.mjs';

const { base, api, page, check, finish } = await boot();
// a 40x30 PNG made in the page, used as the "screenshot"
const paste = (target, name = 'image.png') => target.evaluate(async (fname) => {
  const c = document.createElement('canvas'); c.width = 40; c.height = 30;
  const x = c.getContext('2d'); x.fillStyle = '#c8421d'; x.fillRect(0, 0, 40, 30);
  const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
  const dt = new DataTransfer(); dt.items.add(new File([blob], fname, { type: 'image/png' }));
  const el = document.querySelector('.s-capture');
  el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
}, name);
try {
  await page.goto(base + '/quick-capture');
  await page.locator('#s-capture-input').waitFor({ timeout: 15000 });

  // task mode: type, paste a screenshot, add
  await page.locator('#s-capture-input').fill('Revise BCNF tomorrow !high #exams');
  await paste(page);
  await page.locator('.s-cap-thumb img').waitFor({ timeout: 5000 });
  check('a pasted screenshot shows as a thumbnail', (await page.locator('.s-cap-thumb img').count()) === 1);
  check('the window knows it has something typed', (await page.evaluate(() => window.__pebloCaptureDirty)) === true);
  await page.getByRole('button', { name: 'Tomorrow', exact: true }).click();
  await page.getByRole('button', { name: 'Add task' }).click();
  const sheet = page.getByLabel('Set up your new task');
  await sheet.waitFor({ timeout: 8000 }).catch(() => {});
  check('after adding, the set-up sheet opens in the capture window', await sheet.isVisible().catch(() => false));
  await page.screenshot({ path: 'C:/Users/tejas/peblo-e2e/capture-sheet.png' });
  const todos = (await api('GET', '/api/todos')).todos;
  const t = todos.find((x) => /Revise BCNF/.test(x.text));
  check('the task keeps its parsed priority and tag', !!t && t.priority === 'high' && JSON.stringify(t.todoTags || t.tags).includes('exams'));
  check('the screenshot is saved in a note linked to the task', !!t && !!t.noteId);
  const nn = t ? (await api('GET', `/api/notes/${t.noteId}`)).note : null;
  check('that note holds the picture', !!nn && /!\[[^\]]*\]\(data:image\/jpeg/.test(nn.content), nn && nn.title);

  // keep open
  await page.goto(base + '/quick-capture');
  await page.locator('#s-capture-input').waitFor();
  await page.getByLabel('Keep open after adding').check();
  await page.locator('#s-capture-input').fill('Second quick task');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(900);
  check('keep open: the box clears and stays', (await page.locator('#s-capture-input').inputValue()) === '' && (await page.locator('.s-capture').count()) === 1);
  check('keep open: the task was saved', (await api('GET', '/api/todos')).todos.some((x) => x.text === 'Second quick task'));

  // note mode with a checklist
  await page.getByRole('tab', { name: 'Note' }).click();
  await page.locator('#s-capture-input').fill('Study group');
  await page.getByLabel('Note', { exact: true }).fill('Meet on Friday\n- [ ] Book the room\n- [ ] Bring the paper');
  await paste(page, 'board.png');
  await page.locator('.s-cap-thumb img').waitFor({ timeout: 5000 });
  await page.getByRole('button', { name: 'Make tasks from checklist' }).click();
  await page.screenshot({ path: 'C:/Users/tejas/peblo-e2e/capture-note.png' });
  await page.getByRole('button', { name: 'Save note' }).click();
  await page.waitForTimeout(1200);
  const notes = (await api('GET', '/api/notes')).notes;
  const note = notes.find((n) => n.title === 'Study group');
  check('the note is saved with its picture and #inbox', !!note && /data:image\/jpeg/.test(note.content) && note.tags.includes('inbox'));
  const todos2 = (await api('GET', '/api/todos')).todos;
  check('the checklist became 2 linked tasks', !!note && todos2.filter((x) => x.noteId === note.id).length === 2, String(todos2.filter((x) => note && x.noteId === note.id).length));
} catch (e) {
  console.error(e);
  check('no crash', false, String(e));
}
await finish();

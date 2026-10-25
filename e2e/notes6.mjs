// Notes batch 6: @ finds tasks and ties them to the note; slash "Task from this line".
import { boot } from './lib.mjs';

const { base, api, page, check, finish } = await boot();
try {
  const task = (await api('POST', '/api/todos', { text: 'Buy zebra food', priority: 'medium' })).todo;
  const n = (await api('POST', '/api/notes', { title: 'Task note', content: 'Start here.\n\nCall the vet about stripes\n', tags: ['b6'] })).note;
  await page.goto(base + `/notes/${n.id}`);
  await page.locator('.bn-editor').waitFor({ timeout: 12000 });
  await page.waitForTimeout(1000);

  await page.locator('.bn-inline-content', { hasText: 'Call the vet' }).click();
  await page.waitForTimeout(500);
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  await page.keyboard.type('@zebra f', { delay: 60 });
  await page.locator('.bn-suggestion-menu-item').first().waitFor({ timeout: 5000 }).catch(() => {});
  const menu = (await page.locator('.bn-suggestion-menu-item').allTextContents()).join(' ');
  check('@ lists the matching open task', /Buy zebra food/.test(menu), menu.slice(0, 160));
  await page.locator('.bn-suggestion-menu-item', { hasText: 'Buy zebra food' }).first().click();
  await page.waitForTimeout(1500);
  check('the task text is written into the note', /☐ Buy zebra food/.test(await page.locator('.bn-editor').innerText()));
  const t = (await api('GET', '/api/todos')).todos.find((x) => x.id === task.id);
  check('the task is now linked to this note', t && t.noteId === n.id, JSON.stringify(t));

  // slash: task from this line
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  const ln = await page.locator('.bn-inline-content', { hasText: 'Call the vet' }).boundingBox();
  await page.mouse.click(ln.x + ln.width - 2, ln.y + ln.height / 2);
  await page.waitForTimeout(500);
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  await page.keyboard.type('/task from', { delay: 60 });
  await page.locator('.bn-suggestion-menu-item').first().waitFor({ timeout: 5000 }).catch(() => {});
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1500);
  console.log('EDITOR:', JSON.stringify(await page.locator('.bn-editor').innerText()));
  const todos = (await api('GET', '/api/todos')).todos;
  check('Task from this line makes a task linked to the note', todos.some((x) => x.text === 'Call the vet about stripes' && x.noteId === n.id), todos.map((x) => x.text).join('|'));
} catch (e) { check('no crash', false, String(e).slice(0, 300)); }
await finish();

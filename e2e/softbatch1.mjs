// Soft Studio batch 1: tag chips, pin up to 3 (Home shows pinned only), linked tasks, export menu.
import { boot } from './lib.mjs';

const { base, api, page, check, finish } = await boot();
try {
  const mk = async (title, tags) => (await api('POST', '/api/notes', { title, content: 'Body of ' + title, tags })).note;
  const n1 = await mk('Alpha note', ['physics']);
  const n2 = await mk('Beta note', ['chem']);
  const n3 = await mk('Gamma note', ['chem']);
  const n4 = await mk('Delta note', ['bio']);
  const n5 = await mk('Epsilon note', ['bio']);

  // Home: nothing pinned -> empty message
  await page.goto(base + '/');
  await page.waitForSelector('#s-notes', { timeout: 15000 });
  const homeTxt = async () => (await page.locator('section[aria-labelledby="s-notes"]').textContent()) || '';
  check('Home shows no notes when none are pinned', /Pin up to 3/.test(await homeTxt()) && !/Alpha note/.test(await homeTxt()), await homeTxt());

  // Pin via API meta and check the cap in the UI
  for (const n of [n1, n2, n3]) await api('PATCH', `/api/notes/${n.id}`, { meta: { pinned: true } });
  await page.goto(base + '/');
  await page.waitForSelector('#s-notes');
  await page.waitForTimeout(800);
  const t = await homeTxt();
  check('Home shows exactly the 3 pinned notes', /Alpha note/.test(t) && /Beta note/.test(t) && /Gamma note/.test(t) && !/Delta note/.test(t), t);

  await page.goto(base + `/notes/${n4.id}`);
  await page.locator('#s-note-title').waitFor({ timeout: 10000 });
  await page.getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitem', { name: /Pin to Home/ }).click();
  await page.waitForSelector('.s-toast', { timeout: 4000 }).catch(() => {});
  check('a 4th pin is refused', /up to 3/.test((await page.locator('.s-toast').textContent().catch(() => '')) || ''));

  // A tag link (?tag=) filters the list
  await page.goto(base + '/notes?tag=chem');
  await page.waitForSelector('.s-note-row', { timeout: 15000 });
  await page.waitForTimeout(700);
  const rows = await page.locator('.s-note-row .t').allTextContents();
  check('a tag link filters the list', rows.length === 2 && rows.every((r) => /Beta|Gamma/.test(r)), rows.join('|'));
  await page.locator('.s-note-row').first().click();
  await page.locator('#s-note-title').waitFor();

  // Export menu
  await page.getByRole('button', { name: 'More' }).click();
  const items = await page.locator('.s-menu button').allTextContents();
  check('export menu offers PDF, Word, Markdown', ['PDF', 'Word', 'Markdown'].every((k) => items.some((i) => i.includes(k))), items.join('|'));
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 8000 }).catch(() => null), page.getByRole('menuitem', { name: /Word/ }).click()]);
  check('Word export downloads a .doc', !!dl && /\.doc$/.test(dl.suggestedFilename()), dl && dl.suggestedFilename());

  // Linked tasks
  await page.goto(base + `/notes/${n5.id}`);
  await page.locator('#s-note-title').waitFor();
  await page.getByLabel('Add a task to this note').fill('Revise cells');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(800);
  check('a task added from the note is linked', (await page.locator('.s-side-task', { hasText: 'Revise cells' }).count()) === 1);
  const loose = (await api('POST', '/api/todos', { text: 'Loose task', priority: 'medium' })).todo;
  await page.reload();
  await page.locator('#s-note-title').waitFor();
  await page.getByRole('button', { name: 'Link existing' }).click();
  await page.locator('.s-linker-row', { hasText: 'Loose task' }).click();
  await page.waitForTimeout(800);
  check('an existing task can be linked', (await page.locator('.s-side-task', { hasText: 'Loose task' }).count()) === 1);
  await page.getByRole('button', { name: /Unlink Loose task/ }).click();
  await page.waitForTimeout(800);
  check('a task can be unlinked', (await page.locator('.s-side-task', { hasText: 'Loose task' }).count()) === 0);
  await page.screenshot({ path: 'C:/Users/tejas/peblo-e2e/softbatch1.png' });
} catch (e) {
  console.error(e);
  check('no crash', false, String(e));
}
await finish();

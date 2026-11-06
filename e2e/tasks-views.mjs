// Tasks: saved views (save, apply, update, rename, duplicate, delete) and Manual reorder (keyboard, undo, drag).
import { boot } from './lib.mjs';

const { base, api, page, check, finish } = await boot();
const at = (d, h, m = 0) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m, 0).toISOString();
const orderOf = async () => (await page.locator('.s-list-group[data-group="today"] .s-card-open, .s-list .s-card-open').allInnerTexts());
try {
  await page.setViewportSize({ width: 1440, height: 900 });
  const n = new Date();
  const today = new Date(n.getFullYear(), n.getMonth(), n.getDate());
  for (const [t, h, p] of [['Alpha spec', 10, 'high'], ['Bravo bank', 11, 'medium'], ['Charlie PRs', 12, 'low'], ['Delta flights', 13, 'medium']]) {
    await api('POST', '/api/todos', { text: t, priority: p, deadline: at(today, h) });
  }
  await page.goto(base + '/tasks');
  await page.locator('#task-add').waitFor({ timeout: 15000 });
  await page.locator('.s-seg button', { hasText: 'List' }).click();
  await page.locator('.s-list').waitFor({ timeout: 5000 });

  // Saved views
  check('no hint paragraph is wasting space before any view is saved', (await page.locator('.s-vempty').count()) === 0 && (await page.getByRole('button', { name: 'Save view' }).count()) === 1);
  await page.locator('.s-filter button', { hasText: 'High priority' }).click().catch(() => {});
  await page.locator('.tl-seg button', { hasText: 'Priority' }).click();
  await page.locator('.s-vchip.ghost').click();
  await page.locator('#s-vname').waitFor();
  check('save popover opens with the name field focused', await page.evaluate(() => document.activeElement?.id === 's-vname'));
  check('popover lists what is remembered', /Group: Priority/.test(await page.locator('.s-vtags').innerText()));
  await page.screenshot({ path: 'tasks-saved-pop.png' });
  await page.fill('#s-vname', 'Work focus');
  await page.keyboard.press('Enter');
  await page.locator('.s-vchip', { hasText: 'Work focus' }).waitFor({ timeout: 3000 });
  check('view appears as a chip and is active', (await page.locator('.s-vchip.on', { hasText: 'Work focus' }).count()) === 1);
  check('view is stored', (await page.evaluate(() => JSON.parse(localStorage.getItem('peblo-task-views')).length)) === 1);
  await page.locator('.tl-seg button', { hasText: 'Tag' }).click();
  check('changing filters offers Update', (await page.locator('.s-vupd').count()) === 1);
  await page.locator('.s-vchip', { hasText: 'All tasks' }).click();
  check('All tasks resets grouping to Date', (await page.locator('.tl-seg button.on').innerText()) === 'Date');
  await page.locator('.s-vchip', { hasText: 'Work focus' }).click();
  check('applying a view restores its grouping', (await page.locator('.tl-seg button.on').innerText()) === 'Priority' && (await page.locator('.s-vupd').count()) === 0);
  await page.screenshot({ path: 'tasks-saved.png' });
  await page.locator('.s-vmore').click();
  await page.locator('.s-vmenu button', { hasText: 'Duplicate' }).click();
  check('duplicate adds a copy', (await page.locator('.s-vchip', { hasText: 'Work focus copy' }).count()) === 1);
  await page.locator('.s-vmore').click();
  await page.locator('.s-vmenu button', { hasText: 'Rename' }).click();
  await page.locator('.s-vrename input').fill('Copy renamed');
  await page.keyboard.press('Enter');
  check('rename works', (await page.locator('.s-vchip', { hasText: 'Copy renamed' }).count()) === 1);
  await page.locator('.s-vmore').click();
  await page.locator('.s-vmenu button', { hasText: 'Delete view' }).click();
  check('delete asks first and says no tasks go', /No tasks are deleted/.test(await page.locator('.s-vconfirm').innerText()));
  await page.screenshot({ path: 'tasks-saved-delete.png' });
  await page.locator('.s-vconfirm button', { hasText: 'Yes, delete' }).click();
  check('delete removes only the view', (await page.locator('.s-vchip', { hasText: 'Copy renamed' }).count()) === 0 && (await page.locator('.s-vchip', { hasText: 'Work focus' }).count()) === 1);
  await page.reload();
  await page.locator('.s-seg button', { hasText: 'List' }).click();
  check('views survive a reload', (await page.locator('.s-vchip', { hasText: 'Work focus' }).count()) === 1);

  // Manual reorder
  await page.locator('.s-vchip', { hasText: 'All tasks' }).click();
  await page.locator('.s-tt-sel select').selectOption('manual');
  await page.locator('.s-grip').first().waitFor({ timeout: 3000 });
  const start = await orderOf();
  check('manual mode shows grip handles', (await page.locator('.s-grip').count()) >= 4, start.join('|'));
  const second = start[1];
  await page.locator('.s-card', { hasText: second }).locator('.s-card-open').focus();
  await page.keyboard.press('Alt+ArrowUp');
  await page.waitForTimeout(900);
  const after = await orderOf();
  check('Alt+Up moves the task up one', after[0] === second, after.join('|'));
  check('focus stays on the moved task', await page.evaluate((t) => document.activeElement?.textContent === t, second));
  check('undo toast offers a way back', /Moved/.test(await page.locator('.s-toast, [role=status]').first().innerText().catch(() => '')));
  await page.screenshot({ path: 'tasks-reorder.png' });
  const stored = await api('GET', '/api/todos');
  check('order is saved on the tasks', (stored.todos || stored).filter((x) => typeof x.meta?.order === 'number').length >= 4);
  await page.reload();
  await page.locator('.s-seg button', { hasText: 'List' }).click();
  await page.locator('.tl-seg').waitFor();
  await page.locator('.s-tt-sel select').selectOption('manual');
  await page.locator('.s-grip').first().waitFor();
  check('manual order survives a reload', (await orderOf())[0] === second, (await orderOf()).join('|'));
  await page.locator('.s-card', { hasText: second }).locator('.s-card-open').focus();
  await page.keyboard.press('Alt+ArrowDown');
  await page.waitForTimeout(900);
  check('Alt+Down moves it back', (await orderOf())[1] === second, (await orderOf()).join('|'));
  await page.locator('.s-toast button, [role=status] button').first().click().catch(() => {});
  await page.waitForTimeout(900);
  check('Undo puts it back', (await orderOf())[0] === second, (await orderOf()).join('|'));
  // drag the last task to the top
  await page.locator('.s-tt-sel select').selectOption('manual');
  const o = await orderOf();
  const last = o[o.length - 1];
  const dt = await page.evaluateHandle(() => new DataTransfer());
  const src = page.locator('.s-card', { hasText: last });
  const dst = page.locator('.s-card', { hasText: o[0] });
  await src.dispatchEvent('dragstart', { dataTransfer: dt });
  await dst.dispatchEvent('dragover', { dataTransfer: dt });
  check('drop line shows on the target', (await page.locator('.s-card.drop-here').count()) === 1);
  await page.screenshot({ path: 'tasks-drag.png' });
  await dst.dispatchEvent('drop', { dataTransfer: dt });
  await src.dispatchEvent('dragend', { dataTransfer: dt });
  await page.waitForTimeout(900);
  check('dragging reorders', (await orderOf())[0] === last || (await orderOf()).indexOf(last) < o.length - 1, (await orderOf()).join('|'));
} catch (e) {
  check('no crash', false, String(e).slice(0, 300));
}
await finish();

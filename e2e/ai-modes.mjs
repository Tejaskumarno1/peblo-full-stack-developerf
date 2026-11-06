// AI chat: modes, slash commands, @ note mentions.
import { boot } from './lib.mjs';

const { base, api, page, check, finish } = await boot();
try {
  await page.setViewportSize({ width: 1440, height: 900 });
  await api('POST', '/api/notes', { title: 'Sprint planning notes', content: 'Goals for the sprint' }).catch(() => {});
  await api('POST', '/api/notes', { title: 'Database revision', content: 'BCNF and 3NF' }).catch(() => {});
  await page.goto(base + '/ai');
  const input = page.locator('#s-ai-input');
  await input.waitFor({ timeout: 15000 });

  check('four modes are shown, Ask notes first', (await page.locator('.s-modes button').allInnerTexts()).join(',') === 'Ask notes,Plan,Summarise,Quiz me');
  await page.locator('.s-modes button', { hasText: 'Plan' }).click();
  check('picking Plan changes the placeholder', /plan for/i.test(await input.getAttribute('placeholder')));
  await page.locator('.s-modes button', { hasText: 'Ask notes' }).click();

  await input.click();
  await input.fill('/');
  await page.locator('.s-slash').waitFor({ timeout: 3000 });
  check('typing / lists commands', (await page.locator('.s-slash button').count()) >= 5);
  await input.fill('/qu');
  check('commands filter as you type', (await page.locator('.s-slash button').count()) === 1);
  await page.screenshot({ path: 'ai-slash.png' });
  await page.keyboard.press('Enter');
  check('Enter picks the command and clears the box', (await page.locator('.s-modes button.on').innerText()) === 'Quiz me' && (await input.inputValue()) === '');
  check('the menu closes', (await page.locator('.s-slash').count()) === 0);

  await input.fill('look at @Sprint');
  await page.locator('.s-slash').waitFor({ timeout: 3000 });
  const opts = await page.locator('.s-slash button').allInnerTexts();
  check('@ lists matching notes', opts.length === 1 && /Sprint planning notes/.test(opts[0]), opts.join('|'));
  await page.screenshot({ path: 'ai-at.png' });
  await page.keyboard.press('Enter');
  check('picking a note adds it as a chip', (await page.locator('.s-composer-chips .s-att', { hasText: 'Sprint planning notes' }).count()) === 1);
  check('the @ text is removed', (await input.inputValue()).trim() === 'look at');
  await input.fill('/zzz');
  check('no match shows no menu and Enter does not break', (await page.locator('.s-slash').count()) === 0);

  // Action card: an answer with a list can be added as tasks, only after you press the button
  await page.evaluate(() => localStorage.setItem('peblo-ai-hub-v1', JSON.stringify([{ id: 'c1', title: 'Plan', updatedAt: Date.now(), messages: [
    { id: 'u1', role: 'user', content: 'Plan my week' },
    { id: 'a1', role: 'assistant', status: 'done', content: 'Here is a plan:\n1. Draft the spec\n2. Review the PRs\n3. Book flights', sources: [], meta: { local: false, model: 'test' } }] }])));
  await page.reload();
  await page.locator('.s-bot').first().waitFor({ timeout: 10000 });
  await page.getByRole('button', { name: 'Add as tasks' }).click();
  check('the card lists the three steps, all ticked', (await page.locator('.s-action li').count()) === 3 && (await page.locator('.s-action input:checked').count()) === 3);
  const before = (await api('GET', '/api/todos')).todos?.length ?? ((await api('GET', '/api/todos')).length || 0);
  check('nothing is added before the button', before === 0, String(before));
  await page.locator('.s-action li', { hasText: 'Book flights' }).locator('input').uncheck();
  await page.screenshot({ path: 'ai-action.png' });
  await page.getByRole('button', { name: 'Add 2 tasks' }).click();
  await page.locator('.s-action .ok').waitFor({ timeout: 5000 });
  const list = (await api('GET', '/api/todos')); const todos = list.todos || list;
  const names = todos.map((t) => t.text).sort();
  check('only the ticked steps were added', names.length === 2 && names[0] === 'Draft the spec' && names[1] === 'Review the PRs', names.join('|'));
} catch (e) {
  check('no crash', false, String(e).slice(0, 300));
}
await finish();

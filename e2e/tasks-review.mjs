// Tasks: weekly review wizard, collapsible groups, compact density.
import { boot } from './lib.mjs';

const { base, api, page, check, finish } = await boot();
const at = (d, h, m = 0) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m, 0).toISOString();
const find = async (text) => { const r = await api('GET', '/api/todos'); return (r.todos || r).find((x) => x.text === text); };
try {
  await page.setViewportSize({ width: 1440, height: 900 });
  const n = new Date();
  const day = (k) => new Date(n.getFullYear(), n.getMonth(), n.getDate() + k);
  await api('POST', '/api/todos', { text: 'Late report', priority: 'high', deadline: at(day(-3), 23, 59) });
  await api('POST', '/api/todos', { text: 'Someday idea', priority: 'low' });
  await api('POST', '/api/todos', { text: 'Soon thing', priority: 'medium', deadline: at(day(3), 23, 59) });
  await page.goto(base + '/tasks');
  await page.locator('#task-add').waitFor({ timeout: 15000 });

  // Review wizard
  await page.locator('.s-selbtn', { hasText: 'Review' }).click();
  await page.locator('.s-rv').waitFor({ timeout: 5000 });
  check('wizard opens on step 1 with the overdue task', /Step 1: Overdue/.test(await page.locator('.s-rv-main h2').innerText()) && (await page.locator('.s-rv .row', { hasText: 'Late report' }).count()) === 1);
  await page.screenshot({ path: 'tasks-review.png' });
  await page.locator('.s-rv .row', { hasText: 'Late report' }).locator('button', { hasText: 'Tomorrow' }).click();
  await page.waitForTimeout(800);
  const moved = await find('Late report');
  check('Tomorrow moves the overdue task to tomorrow', moved && new Date(moved.deadline).getDate() === day(1).getDate(), moved?.deadline);
  check('handled task leaves the step', (await page.locator('.s-rv .row', { hasText: 'Late report' }).count()) === 0);
  await page.locator('.s-rv-main .go').click();
  check('Next goes to No date', /Step 2: No date/.test(await page.locator('.s-rv-main h2').innerText()));
  await page.locator('.s-rv .row', { hasText: 'Someday idea' }).locator('button', { hasText: 'Done' }).click();
  await page.waitForTimeout(800);
  check('Done completes the task', (await find('Someday idea'))?.completed === true);
  await page.locator('.s-rv-main .go').click();
  await page.locator('.s-rv-main .go').click();
  check('wrap up shows counts', /1<\/b> done|1 done/.test(await page.locator('.s-rv-main .wrap').innerHTML().then((h) => h.replace(/<[^>]+>/g, (m) => (m === '</b>' ? '</b>' : '')))) || /1 done and 1 moved/.test(await page.locator('.s-rv-main .wrap').innerText()), await page.locator('.s-rv-main .wrap').innerText());
  await page.keyboard.press('Escape');
  await page.locator('.s-rv').waitFor({ state: 'detached', timeout: 3000 });
  check('Esc leaves the wizard', true);

  // Fold + density in list view
  await page.locator('.s-seg button', { hasText: 'List' }).click();
  await page.locator('.s-gfold').first().waitFor({ timeout: 5000 });
  const head = page.locator('.s-gfold').first();
  const group = page.locator('.s-list-group').first();
  const before = await group.locator('> *').count();
  await head.click();
  check('clicking a group heading folds it', (await group.locator('> *').count()) < before && (await head.getAttribute('aria-expanded')) === 'false');
  await page.reload();
  await page.locator('.s-seg button', { hasText: 'List' }).click();
  await page.locator('.s-gfold').first().waitFor({ timeout: 5000 });
  check('fold state is remembered', (await page.locator('.s-gfold').first().getAttribute('aria-expanded')) === 'false');
  await page.locator('.s-gfold').first().click();
  await page.locator('.s-selbtn', { hasText: 'Comfortable' }).click();
  check('density toggle makes the list compact', (await page.locator('.s-list.compact').count()) === 1);
  await page.screenshot({ path: 'tasks-compact.png' });
} catch (e) {
  check('no crash', false, String(e).slice(0, 300));
}
await finish();

import { boot } from './lib.mjs';
const { base, api, page, check, finish } = await boot();
try {
  await page.setViewportSize({ width: 1440, height: 900 });
  const d = new Date();
  const at = (h, m = 0) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m, 0).toISOString();
  await api('POST', '/api/todos', { text: 'Early thing', priority: 'medium', deadline: at(0, 5) });
  await api('POST', '/api/todos', { text: 'Late thing', priority: 'medium', deadline: at(23, 30) });
  await api('POST', '/api/todos', { text: 'Whenever thing', priority: 'low', deadline: at(23, 59) });
  await page.goto(base);
  await page.locator('.s-home-task', { hasText: 'Late thing' }).waitFor({ timeout: 15000 });
  const rows = await page.locator('.s-tile[aria-labelledby="s-today"] > *').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid') || e.textContent.trim().slice(0, 20)));
  const order = rows.filter((r) => /thing|home-now/.test(r));
  check('Now sits between the early and late tasks', order.join('|').replace(/\s+/g, ' ').match(/Early thing.*home-now.*Late thing/), order.join('|'));
  check('Now says when you are free until', /Free until 23:30/.test(await page.locator('[data-testid="home-now"]').innerText()), await page.locator('[data-testid="home-now"]').innerText());
  await page.screenshot({ path: 'D:/Peblo/_shots/home-now.png' });
} catch (e) { check('no crash', false, String(e).slice(0, 300)); }
await finish();


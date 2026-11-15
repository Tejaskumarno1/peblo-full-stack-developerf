// Loading skeleton, empty page, view-only to-do chips (mockups S33, S38).
import { boot } from './lib.mjs';
const { base, api, ctx, check, finish } = await boot({ freshGuest: true });
try {
  const empty = (await api('POST', '/api/notes', { title: 'Untitled', content: '', tags: [] })).note;
  const etok = (await api('POST', `/api/share/note/${empty.id}`, { edit: false })).token;
  const gc = await ctx.browser().newContext({ viewport: { width: 1366, height: 800 } });
  const g = await gc.newPage();
  const errors = []; g.on('pageerror', (e) => errors.push(e.message));
  await g.route('**/api/public/note/*', async (route) => { if (route.request().method() === 'GET' && !route.request().url().includes('/polls') && !route.request().url().includes('/reactions')) await new Promise((r) => setTimeout(r, 1200)); await route.continue(); });
  await g.goto(`${base}/s/note/${etok}`);
  check('1 loading shows the page skeleton', await g.locator('[data-testid="page-loading"]').waitFor({ timeout: 6000 }).then(() => true, () => false));
  await g.locator('[data-testid="join-anon"]').click({ timeout: 15000 }).catch(() => {});
  check('2 an empty page says so for viewers', await g.locator('[data-testid="empty-page"]').waitFor({ timeout: 15000 }).then(() => true, () => false));
  check('3 viewer wording', /Nothing here yet/.test(await g.locator('[data-testid="empty-page"]').innerText()));
  const made = await api('POST', '/api/todos', { text: 'Send report', priority: 'high' });
  const todo = made.todo || made;
  const ttok = (await api('POST', `/api/share/todo/${todo.id}`, { edit: false })).token;
  const t = await gc.newPage();
  await t.goto(`${base}/s/todo/${ttok}`);
  await t.locator('[data-testid="join-anon"]').click({ timeout: 8000 }).catch(() => {});
  check('4 view-only to-do says only editors can tick it', await t.locator('[data-testid="todo-lock"]').waitFor({ timeout: 15000 }).then(() => true, () => false));
  check('5 no page errors', errors.length === 0, errors.join('|'));
} catch (e) { check('run ' + e.message, false); }
await finish();

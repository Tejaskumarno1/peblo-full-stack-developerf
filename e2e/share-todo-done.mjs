// A finished shared task shows when it was done (mockup S33).
import { boot } from './lib.mjs';
const { base, api, ctx, check, finish } = await boot({ freshGuest: true });
try {
  const t = (await api('POST', '/api/todos', { text: 'Book the venue', priority: 'high' }));
  const todo = t.todo || t;
  await api('PATCH', `/api/todos/${todo.id}`, { completed: true });
  const tok = (await api('POST', `/api/share/todo/${todo.id}`, { edit: false })).token;
  const pub = await api('GET', `/api/public/todo/${tok}`);
  check('1 the server sends a done time', !!pub.completedAt, JSON.stringify(pub.completedAt));
  const g = await (await ctx.browser().newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  await g.goto(`${base}/s/todo/${tok}`);
  await g.locator('[data-testid="join-anon"]').click({ timeout: 6000 }).catch(() => {});
  await g.locator('[data-testid="todo-done-chip"]').waitFor({ timeout: 20000 });
  check('2 the chip says Done with a time', /Done\s+\S+/.test(await g.locator('[data-testid="todo-done-chip"]').innerText()));
} catch (e) { check('run ' + e.message, false); }
await finish();

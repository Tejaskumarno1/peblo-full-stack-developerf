// Shared to-do page cards (mockup S32).
import { boot } from './lib.mjs';
const { base, api, ctx, check, finish } = await boot({ freshGuest: true });
try {
  const made = await api('POST', '/api/todos', { text: 'Send the Q4 report', priority: 'high' });
  const t = made.todo || made;
  const tok = (await api('POST', `/api/share/todo/${t.id}`, { edit: true })).token;
  const gc = await ctx.browser().newContext({ viewport: { width: 1700, height: 900 } });
  const g = await gc.newPage();
  const errors = []; g.on('pageerror', (e) => errors.push(e.message));
  await g.goto(`${base}/s/todo/${tok}`);
  await g.locator('[data-testid="join-anon"]').click({ timeout: 8000 }).catch(() => {});
  await g.locator('[data-testid="todo-about"]').waitFor({ timeout: 20000 });
  const txt = await g.locator('[data-testid="todo-about"]').innerText();
  check('1 about card lists shared by, updated, link ends, role', /Shared by/.test(txt) && /Updated/.test(txt) && /Link ends/.test(txt) && /Your role/.test(txt));
  check('2 people card shows', await g.locator('[data-testid="rc-people"]').isVisible());
  check('3 keep card has a save button', /Save to my Peblo/.test(await g.locator('[data-testid="rc-keep"]').innerText()));
  await g.screenshot({ path: 'share-todo-cards.png' });
  check('4 no page errors', errors.length === 0, errors.join('|'));
} catch (e) { check('run ' + e.message, false); }
await finish();

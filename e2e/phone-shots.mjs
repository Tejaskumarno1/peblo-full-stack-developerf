// Takes phone screenshots of the share pages for a visual check against S15, S16, S29 and S34.
import { boot } from './lib.mjs';
const { base, api, ctx, check, finish } = await boot({ freshGuest: true });
const OUT = 'C:/Users/tejas/peblo-e2e';
try {
  const body = '## 1. What we heard\n\nClients praise the team but ask for fewer rounds. Most delays start with an unclear first brief.\n\n## 2. Next steps\n\nWho signs off the final numbers, and by when?';
  const note = (await api('POST', '/api/notes', { title: 'Q4 client report', content: body, tags: [] })).note;
  const view = (await api('POST', `/api/share/note/${note.id}`, { edit: false })).token;
  const todo = (await api('POST', '/api/todos', { text: 'Send the Q4 report to the client', priority: 'high' })); const t = todo.todo || todo;
  const ttok = (await api('POST', `/api/share/todo/${t.id}`, { edit: true })).token;
  const phone = async (url, name, act) => {
    const c = await ctx.browser().newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const p = await c.newPage();
    await p.goto(url);
    await p.locator('[data-testid="join-anon"]').click({ timeout: 5000 }).catch(() => {});
    await p.waitForTimeout(2500);
    if (act) await act(p);
    await p.waitForTimeout(600);
    await p.screenshot({ path: `${OUT}/phone-${name}.png` });
    const ov = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
    check(`${name} has no sideways scroll`, ov.sw <= ov.cw + 1, JSON.stringify(ov));
    await c.close();
  };
  await phone(`${base}/s/note/${view}`, 'viewer');
  await phone(`${base}/s/todo/${ttok}`, 'todo');
  await phone(`${base}/s/note/nope-nope-nope-nope-nope`, 'gone');
  await phone(`${base}/s/note/${view}`, 'outline', async (p) => { await p.locator('.mbar button[aria-label="Outline"]').click({ timeout: 4000 }); });
  await phone(`${base}/s/note/${view}`, 'comments', async (p) => { await p.locator('[data-testid="mbar-comments"]').click({ timeout: 4000 }); check('comments sheet opens with cards', await p.locator('[data-testid="cards-sheet"] [data-testid="rc-ask"]').isVisible()); });
  await phone(`${base}/s/todo/${ttok}`, 'todo-long', async (p) => { await p.evaluate(() => { const t = document.querySelector('.task-title-in'); if (t) { const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; set.call(t, 'Send the Q4 report to the client and ask Priya to check every date first'); t.dispatchEvent(new Event('input', { bubbles: true })); } }); });
} catch (e) { check('run ' + e.message, false); }
await finish();

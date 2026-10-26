// The owner's notification bell: joins, knocks and extend requests in one place.
import { boot } from './lib.mjs';

const { base, api, page, ctx, check, finish } = await boot();
const until = async (fn, ms = 15000) => { const end = Date.now() + ms; while (Date.now() < end) { try { if (await fn()) return true; } catch { /* retry */ } await new Promise((r) => setTimeout(r, 250)); } return false; };
try {
  const note = (await api('POST', '/api/notes', { title: 'Bell note', content: '## One\n\nHello.', tags: [] })).note;
  const tok = (await api('POST', `/api/share/note/${note.id}`, { edit: false, expiresInDays: 1 })).token;
  await page.addInitScript(() => { try { localStorage.setItem('peblo-collab-tip', '1'); } catch { /* ignore */ } });
  await page.setViewportSize({ width: 1440, height: 860 });
  await page.goto(`${base}/notes/${note.id}`);
  await page.locator('.bn-editor').waitFor({ timeout: 15000 });
  await page.getByTestId('share-chips').getByRole('button', { name: /live collaboration/i }).click();
  await page.getByTestId('live-panel').waitFor({ timeout: 5000 });
  check('the bell is there with nothing new', (await page.getByTestId('notif-bell').count()) === 1 && (await page.getByTestId('notif-count').count()) === 0);
  const c = await ctx.browser().newContext({ viewport: { width: 1100, height: 800 } });
  await c.addInitScript(() => { try { localStorage.setItem('peblo-guest-tour', '1'); } catch { /* ignore */ } });
  const g = await c.newPage();
  await g.goto(`${base}/s/note/${tok}`);
  await g.locator('article .doc').waitFor({ timeout: 15000 });
  check('a join lights up the bell', await until(async () => (await page.getByTestId('notif-count').count()) === 1));
  await g.getByTestId('extend-ask').click();
  check('an extend request adds to the count', await until(async () => /^2$/.test((await page.getByTestId('notif-count').innerText()).trim())));
  await page.getByTestId('notif-bell').click();
  const txt = await page.getByTestId('notif-list').innerText();
  check('the list names the guest and the ask', /Guest/.test(txt) && /keep the link going/.test(txt), txt);
  await page.screenshot({ path: 'C:/Users/tejas/peblo-e2e/notif-1.png' });
  check('opening marks the joins as seen', await until(async () => !/(^|\n)\s*2\s*$/.test((await page.getByTestId('notif-bell').innerText()).trim())));
  await page.getByRole('button', { name: /see all activity/i }).click();
  check('See all activity opens the tab', (await page.getByTestId('live-activity').count()) === 1);
} catch (e) { check('notif ran without error', false, String(e)); }
await finish();

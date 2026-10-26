// Owner link numbers: visits, people, edits, last 7 days.
import { boot } from './lib.mjs';

const { base, api, page, ctx, check, finish } = await boot();
try {
  const note = (await api('POST', '/api/notes', { title: 'Stats note', content: '# S\n\nHello', tags: [] })).note;
  const tok = (await api('POST', `/api/share/note/${note.id}`, { edit: false })).token;
  const r0 = await api('GET', `/api/share/note/${note.id}/activity`);
  check('a new link starts at zero', r0.stats && r0.stats.visits === 0 && r0.stats.edits === 0 && r0.stats.perDay.length === 7, JSON.stringify(r0.stats));
  const c = await ctx.browser().newContext({ viewport: { width: 1280, height: 800 } });
  const g = await c.newPage();
  await g.goto(`${base}/s/note/${tok}`);
  await g.locator('article .doc').waitFor({ timeout: 15000 });
  await g.waitForTimeout(2500);
  const r1 = await api('GET', `/api/share/note/${note.id}/activity`);
  check('a visit is counted', r1.stats.visits >= 1 && r1.stats.people >= 1, JSON.stringify(r1.stats));
  check('today is the last bar', r1.stats.perDay[6] >= 1, JSON.stringify(r1.stats.perDay));
  await page.addInitScript(() => { try { localStorage.setItem('peblo-collab-tip', '1'); } catch { /* ignore */ } });
  await page.setViewportSize({ width: 1440, height: 860 });
  await page.goto(`${base}/notes/${note.id}`);
  await page.locator('.bn-editor').waitFor({ timeout: 15000 });
  await page.getByTestId('share-chips').getByRole('button', { name: /live collaboration/i }).click();
  await page.getByTestId('live-panel').waitFor({ timeout: 5000 });
  await page.getByRole('tab', { name: 'Activity' }).click();
  await page.getByTestId('link-stats').waitFor({ timeout: 8000 });
  check('the Activity tab shows the numbers', /Visits/.test(await page.getByTestId('link-stats').innerText()));
  await page.screenshot({ path: 'C:/Users/tejas/peblo-e2e/stats-1.png' });
} catch (e) { check('stats test ran without error', false, String(e)); }
await finish();

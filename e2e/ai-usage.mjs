// AI usage meter: counts answered requests (counts only) and shows them under Your AI.
import http from 'node:http';
import { boot } from './lib.mjs';

const mock = http.createServer((req, res) => {
  res.setHeader('content-type', 'application/json');
  if (/models/.test(req.url)) return res.end(JSON.stringify({ data: [{ id: 'mock-1' }] }));
  req.resume();
  req.on('end', () => res.end(JSON.stringify({ id: 'x', object: 'chat.completion', choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify({ title: 'Mock title' }) } }] })));
});
await new Promise((r) => mock.listen(0, '127.0.0.1', r));
const port = mock.address().port;
const { base, api, page, check, finish } = await boot();
try {
  await page.setViewportSize({ width: 1440, height: 900 });
  const u0 = await api('GET', '/api/ai/connections/usage');
  check('usage starts at zero', u0.month === 0 && u0.today === 0 && u0.days.length === 14, JSON.stringify(u0).slice(0, 120));
  let add;
  try { add = await api('POST', '/api/ai/connections', { provider: 'custom', key: 'sk-mock-1234567890', baseUrl: `http://127.0.0.1:${port}/v1`, model: 'mock-1' }); } catch (e) { add = { error: String(e).slice(0, 200) }; }
  check('mock connection added', !add.error, JSON.stringify(add).slice(0, 200));
  const note = await api('POST', '/api/notes', { title: 'Untitled', content: 'Plan the database revision for BCNF and 3NF next week' });
  const id = note.note?.id || note.id;
  for (let i = 0; i < 2; i++) await api('POST', `/api/notes/${id}/ai/title`, {}).catch(() => {});
  await new Promise((r) => setTimeout(r, 600));
  const u1 = await api('GET', '/api/ai/connections/usage');
  check('answered requests are counted', u1.month >= 2 && u1.today >= 2, JSON.stringify(u1).slice(0, 200));
  check('split by provider and feature', u1.providers.length >= 1 && u1.features.length >= 1);
  await page.goto(base + '/ai/connections');
  await page.locator('[data-testid="ai-usage"]').first().waitFor({ timeout: 15000 }).catch(() => {});
  check('meter shows on the page', (await page.locator('[data-testid="ai-usage"]').count()) >= 1);
  if (await page.locator('[data-testid="ai-usage"]').count()) {
    check('meter shows the counts', /requests this month/.test(await page.locator('[data-testid="ai-usage"]').first().innerText()));
    await page.locator('[data-testid="ai-usage"]').first().scrollIntoViewIfNeeded();
    await page.screenshot({ path: 'D:/Peblo/_shots/ai-usage.png' });
  }
} catch (e) { check('no crash', false, String(e).slice(0, 300)); }
mock.close();
await finish();



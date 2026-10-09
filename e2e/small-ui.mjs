// PEB-86: small UI defects, in real Chrome against the compiled app.
import { boot } from './lib.mjs';
const { base, api, page, ctx, check, finish } = await boot();
const setStyle = async (s) => {
  await page.goto(base + '/tasks');
  await page.evaluate((v) => localStorage.setItem('peblo-style', v), s);
  await page.goto(base + '/tasks');
  await page.waitForTimeout(800);
};
try {
  // Ctrl+J opens the AI Hub in every style
  for (const s of ['studio', 'console', 'soft', 'river', 'orbit']) {
    await setStyle(s);
    await page.locator('body').click({ position: { x: 5, y: 5 } }).catch(() => {});
    await page.keyboard.press('Control+j');
    await page.waitForTimeout(700);
    check(`Ctrl+J opens the AI Hub in ${s}`, /\/ai(\?|$|\/)/.test(page.url()), page.url());
  }

  // Tasks timeline shows 06:30 and delete asks first
  await setStyle('studio');
  const early = await page.evaluate(() => { const d = new Date(); d.setHours(6, 30, 0, 0); return d.toISOString(); });
  const made = await api('POST', '/api/todos', { text: 'Early bird task', deadline: early });
  const id = made?.todo?.id || made?.id;
  await page.goto(base + '/tasks');
  await page.locator('.tasks-row', { hasText: 'Early bird task' }).first().waitFor({ timeout: 15000 });
  check('06:30 task is drawn on the day timeline', (await page.locator('.tasks-block', { hasText: 'Early bird task' }).count()) === 1);
  const tlTop = (await page.locator('.tasks-timeline').boundingBox()).y;
  const blkTop = (await page.locator('.tasks-block', { hasText: 'Early bird task' }).first().boundingBox()).y;
  check('06:30 block sits inside the timeline, not above it', blkTop >= tlTop - 1, `block=${blkTop} timeline=${tlTop}`);
  const row = page.locator('.tasks-row', { hasText: 'Early bird task' }).first();
  await row.getByLabel(/^Delete/).click({ force: true });
  await page.waitForTimeout(300);
  check('delete asks before removing', await row.getByRole('button', { name: 'Keep' }).isVisible());
  await row.getByRole('button', { name: 'Keep' }).click();
  const still = await api('GET', '/api/todos');
  check('Keep leaves the task alone', (still.todos || []).some((t) => t.text === 'Early bird task'));
  await row.getByLabel(/^Delete/).click({ force: true });
  await row.getByRole('button', { name: 'Delete', exact: true }).click();
  await page.waitForTimeout(800);
  const after = await api('GET', '/api/todos');
  check('confirmed delete removes it', !(after.todos || []).some((t) => t.text === 'Early bird task'));

  // Sidebar: Inbox is highlighted on /notes?tag=inbox, Notes is not
  await page.goto(base + '/notes?tag=inbox');
  await page.waitForTimeout(1200);
  const act = async (t) => (await page.locator(`.pb-nav-link[title="${t}"]`).first().getAttribute('class')) || '';
  check('Inbox link is active on /notes?tag=inbox', (await act('Inbox')).includes('active'), await act('Inbox'));
  check('Notes link is not active there', !(await act('Notes')).includes('active'), await act('Notes'));
  await page.goto(base + '/notes');
  await page.waitForTimeout(1200);
  check('Notes link is active on /notes', (await act('Notes')).includes('active'));
  check('Inbox link is not active on /notes', !(await act('Inbox')).includes('active'));

  // AI Hub: a server error shows a message instead of an empty bubble
  await page.route('**/api/ai/hub/models', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ local: { enabled: false }, routing: 'auto', cloud: [{ configured: true, provider: 'openai', model: 'stub-model' }] }) }));
  await page.route('**/api/ai/hub/chat', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Model exploded' }) }));
  await page.goto(base + '/ai');
  const input = page.locator('#hub-input, input[id$="-ai-input"]').first();
  await input.waitFor({ timeout: 15000 });
  await input.fill('hello there');
  await input.press('Enter');
  await page.waitForTimeout(1500);
  check('Hub shows the server error text', await page.getByText('Model exploded').isVisible().catch(() => false));
  await page.unroute('**/api/ai/hub/chat');

  // The quick-capture window follows a style change made in the main window
  await setStyle('studio');
  const cap = await ctx.newPage();
  await cap.goto(base + '/quick-capture');
  await cap.waitForTimeout(1500);
  check('capture window starts in studio style', (await cap.evaluate(() => document.body.getAttribute('data-style'))) === 'studio');
  await page.evaluate(() => localStorage.setItem('peblo-style', 'soft'));
  await cap.waitForTimeout(1200);
  check('capture window switches style when the main window changes it', (await cap.evaluate(() => document.body.getAttribute('data-style'))) === 'soft');
  await cap.close();

  // Link preview waits for typing to stop, and ignores half-typed urls
  let hits = 0;
  await page.route('**/api/ai/link-preview**', (r) => { hits++; r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ url: 'https://example.com/abc', title: 'Example', description: 'd', domain: 'example.com' }) }); });
  await page.goto(base + '/notes');
  await page.getByLabel('New note', { exact: true }).first().click();
  await page.getByPlaceholder('Untitled note').waitFor({ timeout: 15000 });
  const ed = page.locator('.editor-content [contenteditable="true"]').first();
  await ed.click();
  await page.keyboard.type('read https://example.com/abc', { delay: 40 });
  await page.waitForTimeout(2200);
  check('typing a url fires one preview request, not one per keystroke', hits === 1, `hits=${hits}`);
} catch (e) { console.error(e); process.exitCode = 1; }
await finish();

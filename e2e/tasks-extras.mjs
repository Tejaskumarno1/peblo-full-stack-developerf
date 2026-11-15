// The features left over from the task-page mockups: custom repeat, snooze after a meeting, time over days,
// break it down with AI, the PDF and MCP rows of the share panel, and finding pictures by the text inside them.
import { boot, REPO } from './lib.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const { base, api, page, ctx, check, finish, token } = await boot();
const shots = 'D:/Peblo/_shots';
fs.mkdirSync(shots, { recursive: true });
const at = (d, h, m = 0) => { const x = new Date(); x.setDate(x.getDate() + d); x.setHours(h, m, 0, 0); return x.toISOString(); };
const rpc = async (url, method, params, id = 1) => {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id, method, params }) });
  const text = await r.text();
  const line = text.split('\n').find((l) => l.startsWith('data:'));
  let body = {}; try { body = JSON.parse(line ? line.slice(5) : text); } catch { /* not json */ }
  return { status: r.status, body };
};
try {
  await page.setViewportSize({ width: 1440, height: 1000 });

  // ---- 1. custom repeat: server rule ----
  const mk = await api('POST', '/api/todos', { text: 'Water plants', deadline: at(1, 9), recurrence: 'every:3:day' });
  const series = (await api('GET', '/api/todos')).todos.filter((t) => t.text === 'Water plants').map((t) => new Date(t.deadline).getTime()).sort((a, b) => a - b);
  const gaps = series.slice(1, 6).map((x, i) => Math.round((x - series[i]) / 3600000));
  check('every:3:day makes a series spaced three days apart', series.length > 5 && gaps.every((g) => g >= 71 && g <= 73), JSON.stringify(gaps));
  const mm = await api('POST', '/api/todos', { text: 'Pay gym', deadline: at(1, 9), recurrence: 'every:2:month' });
  const months = (await api('GET', '/api/todos')).todos.filter((t) => t.text === 'Pay gym').map((t) => new Date(t.deadline)).sort((a, b) => a - b);
  check('every:2:month skips a month', months.length >= 2 && ((months[1].getFullYear() * 12 + months[1].getMonth()) - (months[0].getFullYear() * 12 + months[0].getMonth())) === 2, months.map((d) => d.toISOString()).join(' '));
  const bad = await api('POST', '/api/todos', { text: 'Bad rule', deadline: at(1, 9), recurrence: 'every:0:day' });
  check('a nonsense rule is refused', !bad.todo, JSON.stringify(bad).slice(0, 120));

  // ---- 1b. custom repeat: the sheet ----
  await api('POST', '/api/todos', { text: 'Call dentist', deadline: at(2, 10) });
  await page.goto(base + '/tasks');
  await page.locator('#task-add').waitFor({ timeout: 15000 });
  await page.getByRole('button', { name: 'Call dentist' }).first().click();
  const dlg = page.getByRole('dialog');
  await dlg.waitFor();
  await dlg.getByRole('radio', { name: 'Custom' }).click();
  const grp = dlg.getByRole('group', { name: 'Custom repeat' });
  await grp.waitFor();
  await grp.getByLabel('Repeat every').fill('4');
  await grp.getByLabel('Repeat unit').selectOption('week');
  check('the sheet says what the custom rule means', /Every 4 weeks/.test(await dlg.innerText()), (await dlg.innerText()).slice(0, 300));
  await page.screenshot({ path: `${shots}/extras-custom-repeat.png` });
  await dlg.getByRole('button', { name: 'Save' }).click();
  await page.waitForTimeout(1500);
  const dent = (await api('GET', '/api/todos')).todos.filter((t) => t.text === 'Call dentist');
  check('custom repeat from the sheet is saved', dent.length > 3 && dent[0].recurrence === 'every:4:week', JSON.stringify(dent.map((d) => d.recurrence).slice(0, 3)));
  check('and the card names the rule', (await page.getByText('Every 4 weeks').count()) >= 1);

  // ---- 2. snooze until after the next meeting ----
  await api('POST', '/api/todos', { text: 'Team sync', deadline: at(1, 15), startTime: '15:00', endTime: '16:00' });
  await page.goto('about:blank');
  const rem = (await api('POST', '/api/todos', { text: 'Ring me', deadline: new Date(Date.now() + 60000).toISOString(), meta: { remindMin: 10 } })).todo;
  await page.goto(base + '/tasks');
  const ring = page.getByTestId('task-ring');
  await ring.waitFor({ timeout: 30000 });
  check('the ring offers "After my next meeting"', (await ring.getByTestId('snooze-meeting').count()) === 1);
  await page.screenshot({ path: `${shots}/extras-snooze.png` });
  await ring.getByTestId('snooze-meeting').click();
  await page.waitForTimeout(900);
  const snz = (await api('GET', '/api/todos')).todos.find((t) => t.id === rem.id).meta?.snoozeUntil;
  const want = new Date(at(1, 16, 1)).getTime();
  check('snooze lands one minute after the meeting ends', !!snz && Math.abs(new Date(snz).getTime() - want) < 120000, String(snz));

  // ---- 3. time over days ----
  const worked = (await api('POST', '/api/todos', { text: 'Write report', deadline: at(0, 23, 30) })).todo;
  const saved = await api('PATCH', `/api/todos/${worked.id}`, { meta: { spentMin: 70, timeLog: { '2026-11-03': 30, '2026-11-04': 40, nonsense: 9 } } });
  check('time per day is kept and bad keys are dropped', JSON.stringify(saved.todo?.meta?.timeLog) === JSON.stringify({ '2026-11-03': 30, '2026-11-04': 40 }), JSON.stringify(saved.todo?.meta));
  await page.goto(`${base}/tasks/focus/${worked.id}`);
  await page.getByTestId('focus-timer').waitFor({ timeout: 15000 });
  check('focus shows "1 h 10 min over 2 days"', /1 h 10 min over 2 days/.test(await page.getByTestId('focus-timer').innerText()));
  await page.screenshot({ path: `${shots}/extras-focus-time.png` });

  // ---- 4. break it down with AI ----
  const real = await api('POST', '/api/ai/task-steps', { text: 'Plan the trip' });
  check('without an AI key the server says so and makes no steps', !real.steps && !!real.error, JSON.stringify(real).slice(0, 160));
  await page.route('**/api/ai/task-steps', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ steps: ['Pick the dates', 'Book the train', 'Reserve a hotel'] }) }));
  await api('POST', '/api/todos', { text: 'Plan the trip', deadline: at(3, 10) });
  await page.goto(base + '/tasks');
  await page.locator('#task-add').waitFor({ timeout: 15000 });
  await page.getByRole('button', { name: 'Plan the trip' }).first().click();
  const d4 = page.getByRole('dialog');
  await d4.waitFor();
  await d4.getByTestId('break-down').click();
  await d4.getByText('Book the train').waitFor({ timeout: 5000 });
  check('the AI steps are added to the task', /Pick the dates/.test(await d4.innerText()) && /Reserve a hotel/.test(await d4.innerText()) && /Added 3 steps/.test(await d4.innerText()));
  await page.screenshot({ path: `${shots}/extras-breakdown.png` });
  await d4.getByRole('button', { name: 'Save' }).click();
  await page.waitForTimeout(1200);
  const trip = (await api('GET', '/api/todos')).todos.find((t) => t.text === 'Plan the trip');
  check('and they are saved with the task', (trip.meta?.subtasks || []).length === 3);
  await page.unroute('**/api/ai/task-steps');

  // ---- 5. share panel: PDF and link-scoped MCP ----
  await api('POST', '/api/todos', { text: 'Revise BCNF', deadline: at(0, 22), meta: { list: 'Exams', subtasks: [{ text: 'Read notes', done: true }] } });
  await api('POST', '/api/todos', { text: 'Past paper', deadline: at(2, 10), meta: { list: 'Exams' } });
  const sh = await api('POST', '/api/task-lists/share', { list: 'Exams', perm: 'view' });
  const url = `${base}/s/list/${sh.token}`;
  const pdf = await fetch(url + '.pdf');
  const pdfBuf = Buffer.from(await pdf.arrayBuffer());
  check('the .pdf link gives a real PDF', pdf.status === 200 && /application\/pdf/.test(pdf.headers.get('content-type') || '') && pdfBuf.subarray(0, 5).toString() === '%PDF-', String(pdf.status));
  const mcpUrl = `${base}/mcp/list/${sh.token}`;
  check('MCP is closed until the owner turns it on', (await rpc(mcpUrl, 'tools/list', {})).status === 404);
  await api('POST', '/api/task-lists/share', { list: 'Exams', mcp: true });
  let tl = await rpc(mcpUrl, 'tools/list', {});
  let names = (tl.body?.result?.tools || []).map((t) => t.name);
  check('a view-only link offers only get_list', names.join() === 'get_list', JSON.stringify(tl.body).slice(0, 200));
  const got = await rpc(mcpUrl, 'tools/call', { name: 'get_list', arguments: {} }, 2);
  check('get_list returns the tasks', /Revise BCNF/.test(JSON.stringify(got.body)) && /Past paper/.test(JSON.stringify(got.body)));
  await api('POST', '/api/task-lists/share', { list: 'Exams', perm: 'add' });
  tl = await rpc(mcpUrl, 'tools/list', {});
  names = (tl.body?.result?.tools || []).map((t) => t.name).sort();
  check('an add link also offers tick, comment and propose', names.join() === 'comment_on_task,get_list,propose_task,tick_task', names.join());
  const prop = await rpc(mcpUrl, 'tools/call', { name: 'propose_task', arguments: { text: 'Ask about the viva' } }, 3);
  check('an agent proposal waits for approval', /waiting/.test(JSON.stringify(prop.body)) && !(await api('GET', '/api/todos')).todos.some((t) => t.text === 'Ask about the viva') && (await api('GET', '/api/todos?proposals=only')).todos.some((t) => t.text === 'Ask about the viva'), JSON.stringify(prop.body).slice(0, 200));
  await api('POST', '/api/task-lists/share', { list: 'Exams', mcp: false });
  check('turning MCP off closes it again', (await rpc(mcpUrl, 'tools/list', {})).status === 404);
  await api('POST', '/api/task-lists/share', { list: 'Exams', mcp: true });

  // the dialog shows the PDF row and the MCP opt-in
  await page.goto(base + '/tasks');
  await page.locator('#task-add').waitFor({ timeout: 15000 });
  const lists = page.getByRole('button', { name: 'Lists', exact: true });
  if (await page.locator('[data-testid="list-card"]').count() === 0) await lists.click();
  await page.locator('[data-testid="list-card"][data-list="Exams"]').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Share' }).click();
  const sd = page.getByRole('dialog', { name: /Share the list Exams/ });
  await sd.getByLabel('PDF version link').waitFor();
  check('dialog shows the PDF link', (await sd.getByLabel('PDF version link').inputValue()) === url + '.pdf');
  check('dialog shows the MCP address for this list', (await sd.getByLabel('MCP address').inputValue()) === mcpUrl);
  await sd.getByRole('checkbox', { name: /Let AI agents connect/ }).click();
  await sd.getByLabel('MCP address').waitFor({ state: 'detached', timeout: 4000 });
  check('unticking the opt-in hides the MCP address', (await sd.getByLabel('MCP address').count()) === 0);
  await sd.getByRole('checkbox', { name: /Let AI agents connect/ }).click();
  await sd.getByLabel('MCP address').waitFor();
  await page.screenshot({ path: `${shots}/extras-share-panel.png` });
  await page.keyboard.press('Escape');

  // ---- 6. find a picture by the text inside it ----
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const up = await (await fetch(base + '/api/media', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'image/png' }, body: png })).json();
  const { encField } = await import(pathToFileURL(path.join(REPO, 'dist', 'server', 'dataCrypto.js')).href);
  const { default: prisma } = await import(pathToFileURL(path.join(REPO, 'dist', 'server', 'db.js')).href);
  const desc = 'A screenshot of a bank page. Text in the picture:\nInvoice 4821 due 30 November';
  await prisma.$executeRaw`UPDATE media SET description = ${encField('media', 'description', up.id, desc)}, described_at = now() WHERE id = ${up.id}`;
  const found = await api('GET', '/api/media/search?q=invoice%204821');
  check('the picture is found by text inside it', found.pictures?.length === 1 && /Invoice 4821/.test(found.pictures[0].snippet), JSON.stringify(found).slice(0, 200));
  check('a word that is not in any picture finds nothing', (await api('GET', '/api/media/search?q=zebra')).pictures?.length === 0);
  await page.goto(base + '/tasks');
  await page.locator('#task-add').waitFor({ timeout: 15000 });
  await page.keyboard.press('Control+k');
  await page.locator('.cmd-search input, .cmd-input, input[placeholder*="Search"]').last().fill('invoice 4821');
  await page.getByTestId('picture-hit').waitFor({ timeout: 6000 });
  check('the palette lists the picture under Pictures', /pictures/i.test(await page.locator(".cmd-list").innerText()) && /Invoice 4821/.test(await page.getByTestId('picture-hit').innerText()));
  await page.screenshot({ path: `${shots}/extras-palette-picture.png` });
} catch (e) { console.error(e); check('no crash: ' + String(e.message).split('\n')[0], false); }
await finish();

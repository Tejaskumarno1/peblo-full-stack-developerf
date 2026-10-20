// PEB-95: personal access tokens + the Peblo MCP server (stdio), driven by the real MCP client from the SDK.
import path from 'path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { boot, REPO } from './lib.mjs';

const { base, api, token, page, check, finish } = await boot();
const raw = (method, url, bearer, body) =>
  fetch(base + url, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}` }, body: body ? JSON.stringify(body) : undefined });
let client;
try {
  const made = await api('POST', '/api/tokens', { name: 'Claude Desktop' });
  check('a token is made and shown once (pbl_...)', typeof made.token === 'string' && made.token.startsWith('pbl_'), JSON.stringify(made));
  const pat = made.token;
  const list = await api('GET', '/api/tokens');
  check('the list has the token but never its secret', list.tokens?.length === 1 && !JSON.stringify(list).includes(pat) && list.tokens[0].prefix === pat.slice(0, 10), JSON.stringify(list));

  const n = await raw('GET', '/api/notes', pat);
  check('the token can read notes', n.status === 200, n.status);
  check('a bad token is refused', (await raw('GET', '/api/notes', 'pbl_nonsense')).status === 401);
  check('a token cannot list tokens', (await raw('GET', '/api/tokens', pat)).status === 403);
  check('a token cannot make tokens', (await raw('POST', '/api/tokens', pat, { name: 'x' })).status === 403);
  check('a token cannot read the profile', (await raw('GET', '/api/profile', pat)).status === 403);
  check('a token cannot touch auth', (await raw('POST', '/api/auth/change-password', pat, { currentPassword: 'a', newPassword: 'b' })).status === 403);
  check('a token needs a name', (await raw('POST', '/api/tokens', token, { name: '  ' })).status === 400);

  // the MCP server, over stdio
  client = new Client({ name: 'e2e', version: '1.0.0' });
  await client.connect(new StdioClientTransport({
    command: process.execPath,
    args: [path.join(REPO, 'dist', 'server', 'mcp', 'index.js')],
    env: { ...process.env, PEBLO_URL: base, PEBLO_TOKEN: pat },
  }));
  const tools = (await client.listTools()).tools.map((t) => t.name).sort();
  check('the server offers its eight tools', tools.join() === ['append_to_note', 'complete_task', 'create_note', 'create_task', 'get_note', 'list_tags', 'list_tasks', 'search_notes'].join(), tools.join());
  check('no tool deletes anything', !tools.some((t) => /delete|remove|trash/.test(t)));
  const call = async (name, args) => {
    const r = await client.callTool({ name, arguments: args || {} });
    const text = r.content?.[0]?.text ?? '';
    let json; try { json = JSON.parse(text); } catch { json = text; }
    return { error: !!r.isError, json, text };
  };

  const created = await call('create_note', { title: 'Orbit from MCP', content: 'First line.\n\nSecond <b>line</b>.', tags: ['mcp'] });
  check('create_note makes a note', !created.error && created.json.id, created.text);
  const id = created.json.id;
  const found = await call('search_notes', { query: 'Orbit from' });
  check('search_notes finds it', Array.isArray(found.json) && found.json.some((x) => x.id === id), found.text);
  await call('append_to_note', { id, text: 'Appended by Claude.' });
  const got = await call('get_note', { id });
  check('append_to_note adds to the end and keeps what was there', /First line/.test(got.json.text) && /Appended by Claude/.test(got.json.text) && got.json.text.indexOf('First') < got.json.text.indexOf('Appended'), got.text);
  check('plain text is escaped, not run as HTML', /&lt;b&gt;line&lt;\/b&gt;/.test(got.json.html), got.json.html);

  const t = await call('create_task', { text: 'Ship the MCP server', priority: 'high' });
  check('create_task makes a task', !t.error && t.json.id, t.text);
  const open = await call('list_tasks', {});
  const all = [...(open.json.today || []), ...(open.json.overdue || []), ...(open.json.upcoming || [])];
  const viaApi = (await api('GET', '/api/todos')).todos || [];
  check('the new task exists for the account', viaApi.some((x) => x.id === t.json.id));
  const done = await call('complete_task', { id: t.json.id });
  check('complete_task marks it done', done.json.completed === true, done.text);
  check('list_tasks accepts a date', !(await call('list_tasks', { date: '2030-01-01' })).error);
  check('list_tags works', !(await call('list_tags')).error);
  const missing = await call('get_note', { id: 'does-not-exist' });
  check('a missing note comes back as a tool error, not a crash', missing.error, missing.text);
  void all;

  // the Settings screen makes a token the same way
  await page.goto(base + '/notes');
  await page.waitForTimeout(2500);
  await page.evaluate(() => window.dispatchEvent(new Event('peblo:open-settings')));
  await page.locator('.settings-hub-container').waitFor({ timeout: 10000 });
  await page.locator('.settings-tab-btn', { hasText: 'Data' }).first().click();
  await page.locator('#token-name').fill('Cursor');
  await page.getByRole('button', { name: 'Make token' }).click();
  const shown = await page.getByTestId('new-token').textContent({ timeout: 5000 }).catch(() => '');
  check('Settings shows a new token once', /^pbl_/.test(shown || ''), shown);
  check('the token from Settings works', (await raw('GET', '/api/notes', shown)).status === 200);
  check('Settings lists it by name', (await page.locator('li', { hasText: 'Cursor' }).count()) === 1);

  // revoking cuts access straight away
  await client.close(); client = null;
  const del = await api('DELETE', '/api/tokens/' + made.id);
  check('a token can be revoked', del.ok === true, JSON.stringify(del));
  check('a revoked token stops working', (await raw('GET', '/api/notes', pat)).status === 401);
} catch (e) {
  check('test ran without throwing', false, e?.stack || e);
} finally {
  try { await client?.close(); } catch {}
  await finish();
}

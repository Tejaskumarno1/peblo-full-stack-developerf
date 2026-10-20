// The Peblo MCP server, driven by a real MCP client over stdio.
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { boot, REPO } from './lib.mjs';

const { base, api, check, finish } = await boot();
let client;
try {
  const t = await api('POST', '/api/tokens', { name: 'e2e', scope: 'full' });
  const transport = new StdioClientTransport({
    command: 'node',
    args: [path.join(REPO, 'dist', 'server', 'mcp', 'index.js')],
    env: { ...process.env, PEBLO_URL: base, PEBLO_TOKEN: t.token },
  });
  client = new Client({ name: 'e2e', version: '1' });
  await client.connect(transport);
  const tools = (await client.listTools()).tools.map((x) => x.name);
  check('server lists tools', tools.length >= 6, tools.join(','));
  check('no delete tool', !tools.some((n) => /delete|remove/.test(n)), tools.join(','));
  const call = async (name, args) => {
    const r = await client.callTool({ name, arguments: args });
    const text = r.content?.[0]?.text || '';
    return { err: !!r.isError, text, json: (() => { try { return JSON.parse(text); } catch { return null; } })() };
  };
  const made = await call('create_note', { title: 'From MCP', content: '# Hello\n\nA line from Claude.', tags: ['mcp'] });
  check('create_note works', !made.err && made.json?.id, made.text);
  const id = made.json.id;
  const app = await call('append_to_note', { id, text: 'Second paragraph.' });
  check('append_to_note works', !app.err, app.text);
  const got = await call('get_note', { id });
  check('get_note returns the markdown', /# Hello/.test(got.json?.markdown || '') && /Second paragraph/.test(got.json?.text || ''), got.text);
  const via = (await api('GET', `/api/notes/${id}`)).note;
  check('note stored as plain Markdown, not HTML', !/<p>/.test(via.content) && /A line from Claude\.\n\nSecond paragraph\./.test(via.content), JSON.stringify(via.content));
  const found = await call('search_notes', { query: 'Hello' });
  check('search_notes finds it', Array.isArray(found.json) && found.json.some((n) => n.id === id), found.text);
  const task = await call('create_task', { text: 'Task from MCP', priority: 'high' });
  check('create_task works', !task.err && task.json?.id, task.text);
  const done = await call('complete_task', { id: task.json.id });
  check('complete_task works', !done.err && done.json?.completed === true, done.text);
  const list = await call('list_tasks', {});
  check('list_tasks works', !list.err, list.text);

  // a read-only token cannot write
  const ro = await api('POST', '/api/tokens', { name: 'ro', scope: 'read' });
  const t2 = new StdioClientTransport({ command: 'node', args: [path.join(REPO, 'dist', 'server', 'mcp', 'index.js')], env: { ...process.env, PEBLO_URL: base, PEBLO_TOKEN: ro.token } });
  const c2 = new Client({ name: 'e2e2', version: '1' });
  await c2.connect(t2);
  const w = await c2.callTool({ name: 'create_note', arguments: { title: 'nope' } });
  check('read-only token cannot create notes', !!w.isError, w.content?.[0]?.text);
  await c2.close();
} catch (e) {
  check('mcp test ran', false, String(e));
} finally {
  try { await client?.close(); } catch { /* ignore */ }
  await finish();
}

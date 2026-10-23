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

  // new tools
  const upd = await call('update_note', { id, title: 'Renamed by MCP', tags: ['mcp', 'edited'] });
  check('update_note renames and retags', !upd.err && upd.json?.title === 'Renamed by MCP' && upd.json.tags.includes('edited'), upd.text);
  const tk = await call('create_task', { text: 'MCP task', deadline: '2026-11-03T10:00:00.000Z', priority: 'low' });
  const tid = tk.json?.id;
  const ut = await call('update_task', { id: tid, text: 'MCP task edited', priority: 'high', noteId: id });
  check('update_task edits and links to the note', !ut.err && ut.json?.priority === 'high' && ut.json?.noteId === id, ut.text);
  const cal = await call('get_calendar', { from: '2026-11-01', to: '2026-11-07' });
  check('get_calendar lists the task in range', !cal.err && Array.isArray(cal.json) && cal.json.some((x) => x.id === tid), cal.text);
  const sh = await call('create_share_link', { kind: 'note', id });
  check('create_share_link returns a public link', !sh.err && /\/s\/note\/[\w-]{20,}$/.test(sh.json?.url || ''), sh.text);
  const off = await call('stop_sharing', { kind: 'note', id });
  check('stop_sharing turns it off', !off.err && (await api('GET', '/api/share/note/' + id)).token === null, off.text);
  check('still no delete tool', !(await client.listTools()).tools.some((x) => /delete|remove/.test(x.name)));

  // the hosted /mcp endpoint records what an app did
  const rpc = await fetch(base + '/mcp', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: 'Bearer ' + t.token }, body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'list_tags', arguments: {} } }) });
  check('hosted /mcp answers a tool call', rpc.status === 200, String(rpc.status));
  await new Promise((r) => setTimeout(r, 400));
  const act = (await api('GET', '/api/tokens/activity')).activity || [];
  check('activity log shows the call', act.some((a) => a.tool === 'list_tags' && a.app === 'e2e' && a.ok), JSON.stringify(act).slice(0, 200));
  await api('DELETE', '/api/tokens/activity');
  check('activity can be cleared', ((await api('GET', '/api/tokens/activity')).activity || []).length === 0);

  // more tools
  const ev = await call('create_task', { text: 'Weekly sync', deadline: '2026-11-04T00:00:00.000Z', startTime: '10:00', endTime: '10:30', recurrence: 'weekly' });
  check('create_task makes a repeating event with times', !ev.err && ev.json?.id, ev.text);
  const ar = await call('archive_note', { id });
  check('archive_note archives', !ar.err, ar.text);
  await call('archive_note', { id, archived: false });
  const pn = await call('pin_note', { id });
  check('pin_note pins', !pn.err && (await api('GET', '/api/notes/' + id)).note.meta?.pinned === true, pn.text);
  const tr = await call('trash_note', { id });
  const lt = await call('list_trash', {});
  check('trash_note moves it to the trash (listed)', !tr.err && Array.isArray(lt.json) && lt.json.some((n) => n.id === id), lt.text);
  const rs = await call('restore_note', { id });
  check('restore_note brings it back', !rs.err && !(await api('GET', '/api/notes/' + id)).note.isDeleted, rs.text);
  const bl = await call('get_backlinks', { id });
  check('get_backlinks answers', !bl.err, bl.text);
  const hist = await call('list_note_history', { id });
  check('list_note_history answers', !hist.err, hist.text);
  const rt = await call('rename_tag', { from: 'edited', to: 'edited-2' });
  check('rename_tag renames', !rt.err && (await api('GET', '/api/notes/' + id)).note.tags.includes('edited-2'), rt.text);
  check('no permanent-delete tool', !(await client.listTools()).tools.some((x) => /delete|remove|empty|purge/.test(x.name)));

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
  // an address pasted with a full stop on the end still works
  const init = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '1' } } });
  const dotted = await fetch(base + '/mcp.', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: init });
  check('/mcp. (trailing full stop) is treated as /mcp', dotted.status === 401, String(dotted.status));
  const dotWk = await fetch(base + '/.well-known/oauth-protected-resource.');
  check('well-known with a trailing full stop works', dotWk.status === 200, String(dotWk.status));
  await finish();
}


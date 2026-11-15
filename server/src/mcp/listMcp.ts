import { Router } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { liveShare } from '../routes/listShare.js';

/*
 * A shared task list offered to AI agents over MCP, at /mcp/list/<link secret>. Off until the owner turns it on for that list.
 * The agent has exactly what a person with the link has: it reads the list, and may tick or propose tasks only when the link's
 * permission allows it. Tasks it proposes wait in the owner's Approval inbox. The server is a thin client of the guest routes.
 */
export const listMcpRoutes = Router();

listMcpRoutes.all('/:token', async (req, res) => {
  const token = String(req.params.token || '');
  const s = await liveShare(token).catch(() => null);
  if (!s || !s.mcp_enabled) return res.status(404).json({ jsonrpc: '2.0', error: { code: -32001, message: 'This list is not shared with AI agents.' }, id: null });
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Use POST.' }, id: null }); }

  const base = `http://127.0.0.1:${req.socket.localPort}/api/public/list/${encodeURIComponent(token)}`;
  const sessionId = `mcpagent${token.slice(0, 16)}`;
  const call = async (method: string, path: string, body?: Record<string, unknown>) => {
    const r = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify({ sessionId, name: 'AI agent', ...body }) : undefined, signal: AbortSignal.timeout(30_000) });
    const data: any = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data?.error || `Peblo answered ${r.status}`);
    return data;
  };
  const ok = (v: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(v, null, 2) }] });
  const fail = (e: unknown) => ({ isError: true, content: [{ type: 'text' as const, text: e instanceof Error ? e.message : String(e) }] });
  const run = (fn: () => Promise<unknown>) => fn().then(ok, fail);

  const server = new McpServer({ name: 'peblo-list', version: '1.0.0' });
  const reg = server.registerTool.bind(server) as any;
  reg('get_list', { description: `Read the shared task list "${s.list_name}": its tasks, due dates, steps, comments and progress.`, inputSchema: {}, annotations: { readOnlyHint: true, openWorldHint: false } },
    () => run(async () => {
      const d = await call('GET', '');
      return { list: d.list, access: d.perm, progress: d.progress, tasks: d.tasks.map((t: any) => ({ id: t.id, text: t.text, done: t.completed, due: t.deadline, priority: t.priority, steps: t.steps, comments: t.comments })) };
    }));
  if (s.perm !== 'view') {
    reg('tick_task', { description: 'Tick or untick a task on the shared list.', inputSchema: { id: z.string(), done: z.boolean() }, annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false } },
      ({ id, done }: { id: string; done: boolean }) => run(() => call('PUT', `/tasks/${encodeURIComponent(id)}`, { completed: done })));
    reg('comment_on_task', { description: 'Write a short comment on a task of the shared list.', inputSchema: { id: z.string(), comment: z.string().max(300) }, annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false } },
      ({ id, comment }: { id: string; comment: string }) => run(() => call('POST', `/tasks/${encodeURIComponent(id)}/comments`, { body: comment })));
  }
  if (s.perm === 'add' || s.perm === 'edit') {
    reg('propose_task', { description: s.perm === 'add' ? 'Propose a new task for the shared list. The owner approves it before it joins the list.' : 'Add a new task to the shared list.', inputSchema: { text: z.string().min(1).max(500) }, annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false } },
      ({ text }: { text: string }) => run(() => call('POST', '/tasks', { text })));
  }

  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on('close', () => { transport.close().catch(() => {}); server.close().catch(() => {}); });
  try { await server.connect(transport); await transport.handleRequest(req, res, req.body); }
  catch { if (!res.headersSent) res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal error' }, id: null }); }
});

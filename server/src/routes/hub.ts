import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { listHubModels, streamHubChat, HubMessage } from '../services/aiService.js';
import { retrieve, sourcesPrompt } from '../services/retrieval.js';

const router = Router();
router.use(authenticate);

// GET /api/ai/hub/models — installed local models, cloud keys and the routing setting
router.get('/models', async (req, res, next) => {
  try {
    res.json(await listHubModels(req.user!.id));
  } catch (error) {
    next(error);
  }
});

// POST /api/ai/hub/search — the sources a question would use (for previews)
router.post('/search', async (req, res, next) => {
  try {
    const result = await retrieve(req.user!.id, String(req.body?.query || ''), { noteIds: req.body?.noteIds });
    res.json({ ...result, sources: result.sources.map(({ text, ...s }) => s) });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/ai/hub/chat — Server-Sent Events.
 * Body: { messages: [{role, content}], noteIds?: string[], provider?, model?, allowCloud? }
 * Events: {type:'sources'} → {type:'delta', text}* → {type:'done', provider, model, local, ms}
 *         or {type:'consent', provider, message} / {type:'error', code, message}
 */
router.post('/chat', async (req, res) => {
  const userId = req.user!.id;
  const messages: HubMessage[] = (Array.isArray(req.body?.messages) ? req.body.messages : [])
    .filter((m: any) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .slice(-12);
  const last = messages[messages.length - 1];

  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  const send = (event: any) => res.write(`data: ${JSON.stringify(event)}\n\n`);

  if (!last || last.role !== 'user' || !last.content.trim()) {
    send({ type: 'error', code: 'BAD_REQUEST', message: 'Type a message first.' });
    return res.end();
  }

  const controller = new AbortController();
  res.on('close', () => controller.abort());
  const started = Date.now();

  try {
    const found = await retrieve(userId, last.content, { noteIds: req.body?.noteIds });
    send({
      type: 'sources',
      sources: found.sources.map(({ text, ...s }) => s),
      searched: found.searched,
      excludedPrivate: found.excludedPrivate,
    });

    const today = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    const system = [
      "You are Peblo's assistant, inside the user's private notes, tasks and calendar app.",
      `Today is ${today}.`,
      'When the sources below are relevant, use them and cite them inline as [1], [2] using their numbers. Only cite numbers that exist.',
      "If the sources don't answer the question, say so briefly and answer from general knowledge without citations.",
      'Be concise and practical. Use Markdown: short paragraphs, bullet lists, and bold for key facts.',
    ].join('\n');

    const withSources = messages.map((m, i) =>
      i === messages.length - 1 ? { ...m, content: m.content + sourcesPrompt(found.sources) } : m
    );

    const result = await streamHubChat(
      userId,
      system,
      withSources,
      { provider: req.body?.provider, model: req.body?.model, allowCloud: req.body?.allowCloud === true, signal: controller.signal },
      (text) => send({ type: 'delta', text })
    );
    send({ type: 'done', ...result, ms: Date.now() - started });
  } catch (error: any) {
    if (!controller.signal.aborted) {
      if (error?.code === 'CLOUD_CONSENT') send({ type: 'consent', provider: error.provider, message: error.message });
      else send({ type: 'error', code: error?.code || 'AI_FAILED', message: error?.message || 'Something went wrong.' });
    }
  }
  res.end();
});

export default router;

import { Router } from 'express';
import prisma from '../db.js';
import { authenticate } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { encryptSecret, isUnreadable } from '../secrets.js';
import { saveKeys } from '../services/profile.js';
import { PROVIDERS, providerById, detectConnection, verifyConnection, checkBaseUrl, suggestModel } from '../services/aiProviders.js';
import { hosted } from '../utils/ollamaPolicy.js';

/** Mounted at /api/ai/connections: the person's own AI providers (any number of them). Every query is scoped to the signed-in person. */
const router = Router();
router.use(authenticate);

const MAX_CONNECTIONS = 20;
// Checking a key calls another company's server, so it is limited per account (it is not an AI request and does not count against the AI quota).
const checkLimit = rateLimit({ windowMs: 60_000, max: 20, key: (req) => `conn:${(req as any).user?.id || ''}`, message: 'Too many key checks. Wait a minute and try again.' });
const bad = (res: any, message: string, status = 400) => res.status(status).json({ error: message });

/** What the app may see of a connection: never the key itself. */
const shape = (c: any) => ({
  id: c.id, provider: c.provider, label: c.label, baseUrl: c.baseUrl, model: c.model,
  enabled: c.enabled, position: c.position, hasKey: !!c.apiKey, unreadable: isUnreadable(c.apiKey),
});

const listFor = (userId: string) => prisma.aiConnection.findMany({ where: { userId }, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] });

router.get('/', async (req, res, next) => {
  try {
    res.json({
      connections: (await listFor(req.user!.id)).map(shape),
      providers: PROVIDERS.map(({ id, label, defaultModel, keyHint, baseUrl, slot }) => ({ id, label, defaultModel, keyHint, fixedAddress: !!baseUrl, slot: slot || null })),
      // On a shared server a custom address must be public https; the desktop app may also point at localhost (LM Studio, vLLM...).
      localAddressesAllowed: !hosted(),
    });
  } catch (error) { next(error); }
});

// Step 1 of adding: look at a pasted key. Saves nothing; answers which provider accepted it and which models it offers.
router.post('/detect', checkLimit, async (req, res, next) => {
  try {
    const key = typeof req.body?.key === 'string' ? req.body.key.trim() : '';
    const provider = typeof req.body?.provider === 'string' ? req.body.provider : undefined;
    const baseUrl = typeof req.body?.baseUrl === 'string' ? req.body.baseUrl : undefined;
    if (key.length > 500) return bad(res, 'That does not look like an API key.');
    if (provider && !providerById(provider)) return bad(res, 'Unknown provider.');
    if (!key && provider !== 'custom') return bad(res, 'Paste an API key first.');
    const found = await detectConnection(key, provider || baseUrl ? { provider: provider || 'custom', baseUrl } : undefined);
    if (!found.ok || !found.result) return res.json({ ok: false, needsProvider: !!found.needsProvider, error: found.error || 'That key was not accepted.' });
    const r = found.result;
    res.json({ ok: true, provider: r.provider, label: r.label, baseUrl: r.baseUrl, models: r.models.slice(0, 300), suggestedModel: suggestModel(r.provider, r.models) });
  } catch (error) { next(error); }
});

// Step 2: save it. OpenAI and Gemini keys go to their own fields (so the existing key boxes show them); everything else becomes a connection.
router.post('/', checkLimit, async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const { provider, key, model, label } = req.body || {};
    const apiKey = typeof key === 'string' ? key.trim() : '';
    const info = typeof provider === 'string' ? providerById(provider) : undefined;
    if (!info) return bad(res, 'Pick a provider.');
    if (apiKey.length > 500) return bad(res, 'That does not look like an API key.');

    if (info.slot) {
      if (!apiKey) return bad(res, 'Paste an API key first.');
      const v = await verifyConnection(info.id, apiKey);
      if (!v.ok) return bad(res, v.error || 'That key was not accepted.');
      await saveKeys(userId, { [info.slot]: apiKey });
      return res.status(201).json({ slot: info.slot });
    }

    let baseUrl = info.baseUrl;
    if (info.id === 'custom') {
      const c = await checkBaseUrl(String(req.body?.baseUrl || ''));
      if (c.problem || !c.url) return bad(res, c.problem || 'Bad address.');
      baseUrl = c.url;
    } else if (!apiKey) return bad(res, 'Paste an API key first.');

    const modelName = typeof model === 'string' ? model.trim() : '';
    if (!modelName || modelName.length > 200) return bad(res, 'Pick a model.');
    const name = (typeof label === 'string' && label.trim() ? label.trim() : info.id === 'custom' ? new URL(baseUrl).hostname : info.label).slice(0, 60);
    if (await prisma.aiConnection.count({ where: { userId } }) >= MAX_CONNECTIONS) return bad(res, `You can keep up to ${MAX_CONNECTIONS} connections.`);

    const last = await prisma.aiConnection.findFirst({ where: { userId }, orderBy: { position: 'desc' }, select: { position: true } });
    const row = await prisma.aiConnection.create({
      data: { userId, provider: info.id, label: name, baseUrl, apiKey: encryptSecret(apiKey), model: modelName, position: (last?.position ?? -1) + 1 },
    });
    res.status(201).json({ connection: shape(row) });
  } catch (error) { next(error); }
});

// Put them in the order the person arranged: the first one that works answers.
router.put('/order', async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const ids: unknown = req.body?.ids;
    if (!Array.isArray(ids) || ids.some((i) => typeof i !== 'string') || ids.length > MAX_CONNECTIONS) return bad(res, 'Send the connection ids in the order you want.');
    const mine = new Set((await prisma.aiConnection.findMany({ where: { userId }, select: { id: true } })).map((c: any) => c.id));
    const wanted = (ids as string[]).filter((i) => mine.has(i));
    await prisma.$transaction(wanted.map((id, position) => prisma.aiConnection.updateMany({ where: { id, userId }, data: { position } })));
    res.json({ connections: (await listFor(userId)).map(shape) });
  } catch (error) { next(error); }
});

router.patch('/:id', async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const data: any = {};
    if (req.body?.enabled !== undefined) { if (typeof req.body.enabled !== 'boolean') return bad(res, 'enabled must be true or false.'); data.enabled = req.body.enabled; }
    if (req.body?.model !== undefined) { const m = String(req.body.model).trim(); if (!m || m.length > 200) return bad(res, 'Pick a model.'); data.model = m; }
    if (req.body?.label !== undefined) { const l = String(req.body.label).trim().slice(0, 60); if (!l) return bad(res, 'Give it a name.'); data.label = l; }
    if (!Object.keys(data).length) return bad(res, 'Nothing to change.');
    const done = await prisma.aiConnection.updateMany({ where: { id: String(req.params.id), userId }, data });
    if (!done.count) return bad(res, 'Connection not found.', 404);
    res.json({ connection: shape(await prisma.aiConnection.findFirst({ where: { id: String(req.params.id), userId } })) });
  } catch (error) { next(error); }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const done = await prisma.aiConnection.deleteMany({ where: { id: String(req.params.id), userId: req.user!.id } });
    if (!done.count) return bad(res, 'Connection not found.', 404);
    res.json({ ok: true });
  } catch (error) { next(error); }
});

export default router;

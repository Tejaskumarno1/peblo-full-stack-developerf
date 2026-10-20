import { Router } from 'express';
import { generateSummary, extractActions, suggestTitle, suggestTagForNote, processBlockAI, processVoiceCommand, getLinkPreview } from '../controllers/aiController.js';
import { authenticate } from '../middleware/auth.js';
import { checkOllama } from '../services/aiService.js';
import { aiLimit } from '../middleware/rateLimit.js';
import prisma from '../db.js';
import { hosted, effectiveOllamaUrl } from '../utils/ollamaPolicy.js';
import { CATALOG, hardware, recommendedChat, fits, pullsSnapshot, startPull, cancelPull, findOllama, startOllama, detectGpu, removeModel } from '../services/localModels.js';

const router = Router();

router.use(authenticate);

// Mounted at /api/ai
router.get('/link-preview', getLinkPreview);
router.get('/ollama/check', async (req, res) => {
  res.json(await checkOllama(typeof req.query.url === 'string' ? req.query.url : undefined));
});
// --- Local model store (PEB-281): desktop only; a shared server never downloads models ---
const userOllamaUrl = async (userId: string) => ((await prisma.user.findUnique({ where: { id: userId }, select: { settings: true } }))?.settings as any)?.ollamaUrl;
router.get('/local/status', async (req, res, next) => {
  try {
    if (hosted()) return res.json({ available: false });
    const hw = hardware();
    const base = effectiveOllamaUrl(await userOllamaUrl(req.user!.id), 'http://127.0.0.1:11434');
    let running = false; let installed: string[] = [];
    if (base) {
      try {
        const r = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(2500) });
        if (r.ok) { running = true; installed = ((await r.json()) as any).models?.map((m: any) => m.name) || []; }
      } catch { /* not running */ }
    }
    const gpu = await detectGpu();
    const rec = recommendedChat(hw.ramGb);
    const has = (id: string) => installed.some((n) => n === id || n === `${id}:latest`);
    res.json({
      available: true, running, onDisk: !!findOllama(), hardware: { ...hw, gpu }, recommendedChat: rec,
      catalog: CATALOG.map((m) => ({ ...m, fits: fits(m, hw.ramGb), gpuFast: !!gpu?.vramGb && gpu.vramGb >= m.sizeGb * 1.15, installed: has(m.id), recommended: m.id === rec || m.kind === 'search' })),
      pulls: pullsSnapshot(),
    });
  } catch (error) { next(error); }
});
router.post('/local/pull', async (req, res, next) => {
  try {
    if (hosted()) return res.status(403).json({ error: 'Local AI is only available in the desktop app.' });
    const r = await startPull(await userOllamaUrl(req.user!.id), String(req.body?.model || ''));
    if (!r.ok) return res.status(400).json({ error: r.error });
    res.json({ ok: true });
  } catch (error) { next(error); }
});
router.post('/local/remove', async (req, res, next) => {
  try {
    if (hosted()) return res.status(403).json({ error: 'Local AI is only available in the desktop app.' });
    const r = await removeModel(await userOllamaUrl(req.user!.id), String(req.body?.model || ''));
    if (!r.ok) return res.status(400).json({ error: r.error });
    res.json({ ok: true });
  } catch (error) { next(error); }
});
router.post('/local/start', async (req, res, next) => {
  try {
    if (hosted()) return res.status(403).json({ error: 'Local AI is only available in the desktop app.' });
    const r = await startOllama(await userOllamaUrl(req.user!.id));
    if (!r.ok) return res.status(400).json({ error: r.error });
    res.json({ ok: true });
  } catch (error) { next(error); }
});
router.post('/local/cancel', (req, res) => {
  if (hosted()) return res.status(403).json({ error: 'Local AI is only available in the desktop app.' });
  res.json({ ok: cancelPull(String(req.body?.model || '')) });
});
router.post('/voice-command', ...aiLimit, processVoiceCommand);

// Mounted at /api/notes: AI actions on one note or one block of text
export const noteAiRoutes = Router();
noteAiRoutes.use(authenticate);
noteAiRoutes.post('/block/ai', ...aiLimit, processBlockAI);
noteAiRoutes.post('/:id/ai/summary', ...aiLimit, generateSummary);
noteAiRoutes.post('/:id/ai/actions', ...aiLimit, extractActions);
noteAiRoutes.post('/:id/ai/title', ...aiLimit, suggestTitle);
noteAiRoutes.post('/:id/ai/tags', ...aiLimit, suggestTagForNote);

export default router;

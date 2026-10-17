import { Router } from 'express';
import { generateSummary, extractActions, suggestTitle, suggestTagForNote, processBlockAI, processVoiceCommand, getLinkPreview } from '../controllers/aiController.js';
import { authenticate } from '../middleware/auth.js';
import { checkOllama } from '../services/aiService.js';
import { aiLimit } from '../middleware/rateLimit.js';

const router = Router();

router.use(authenticate);

// Mounted at /api/ai
router.get('/link-preview', getLinkPreview);
router.get('/ollama/check', async (req, res) => {
  res.json(await checkOllama(typeof req.query.url === 'string' ? req.query.url : undefined));
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

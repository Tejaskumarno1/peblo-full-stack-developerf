import { Router } from 'express';
import { generateSummary, extractActions, suggestTitle, suggestTagForNote, processBlockAI, processVoiceCommand, getLinkPreview } from '../controllers/aiController.js';
import { authenticate } from '../middleware/auth.js';
import { checkOllama } from '../services/aiService.js';

const router = Router();

router.use(authenticate);

// Mounted at /api/ai
router.get('/link-preview', getLinkPreview);
router.get('/ollama/check', async (req, res) => {
  res.json(await checkOllama(typeof req.query.url === 'string' ? req.query.url : undefined));
});
router.post('/voice-command', processVoiceCommand);

// Mounted at /api/notes: AI actions on one note or one block of text
export const noteAiRoutes = Router();
noteAiRoutes.use(authenticate);
noteAiRoutes.post('/block/ai', processBlockAI);
noteAiRoutes.post('/:id/ai/summary', generateSummary);
noteAiRoutes.post('/:id/ai/actions', extractActions);
noteAiRoutes.post('/:id/ai/title', suggestTitle);
noteAiRoutes.post('/:id/ai/tags', suggestTagForNote);

export default router;

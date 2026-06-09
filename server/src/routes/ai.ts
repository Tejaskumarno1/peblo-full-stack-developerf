import { Router } from 'express';
import { generateSummary, extractActions, suggestTitle, suggestTagForNote, processBlockAI, processVoiceCommand, getLinkPreview } from '../controllers/aiController.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

router.use(authenticate);

router.get('/link-preview', getLinkPreview);
router.post('/block/ai', processBlockAI);
router.post('/:id/ai/summary', generateSummary);
router.post('/:id/ai/actions', extractActions);
router.post('/:id/ai/title', suggestTitle);
router.post('/:id/ai/tags', suggestTagForNote);

router.post('/voice-command', processVoiceCommand);

export default router;

import { Router } from 'express';
import { generateSummary, extractActions, suggestTitle } from '../controllers/aiController.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

router.use(authenticate);

router.post('/:id/ai/summary', generateSummary);
router.post('/:id/ai/actions', extractActions);
router.post('/:id/ai/title', suggestTitle);

export default router;

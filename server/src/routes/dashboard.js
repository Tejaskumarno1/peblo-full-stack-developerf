import { Router } from 'express';
import { getInsights } from '../controllers/dashboardController.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

router.get('/insights', authenticate, getInsights);

export default router;

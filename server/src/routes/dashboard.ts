import { Router } from 'express';
import { getInsights, toggleTask, getDailyBriefing, getWeeklyReport } from '../controllers/dashboardController.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

router.get('/insights', authenticate, getInsights);
router.post('/toggle-task', authenticate, toggleTask);
router.get('/daily-briefing', authenticate, getDailyBriefing);
router.get('/weekly-report', authenticate, getWeeklyReport);

export default router;

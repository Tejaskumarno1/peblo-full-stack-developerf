import { Router } from 'express';
import { syncTodosToCalendar, handleCalendarWebhook } from '../controllers/calendarController.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

router.post('/sync', authenticate, syncTodosToCalendar);
router.post('/webhook', handleCalendarWebhook);

export default router;

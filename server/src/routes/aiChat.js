import { Router } from 'express';
import { chatAndCreateNotes } from '../controllers/aiChatController.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

router.use(authenticate);
router.post('/chat', chatAndCreateNotes);

export default router;

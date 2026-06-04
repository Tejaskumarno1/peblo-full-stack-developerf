import { Router } from 'express';
import { chatAndCreateNotes, smartIntake } from '../controllers/aiChatController.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

router.use(authenticate);
router.post('/chat', chatAndCreateNotes);
router.post('/smart-intake', smartIntake);

export default router;

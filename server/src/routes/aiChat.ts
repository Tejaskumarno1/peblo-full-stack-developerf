import { Router } from 'express';
import { chatAndCreateNotes, chatStream, smartIntake, smartIntakeUpload } from '../controllers/aiChatController.js';
import multer from 'multer';
import { authenticate } from '../middleware/auth.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

router.use(authenticate);
router.post('/chat', chatAndCreateNotes);
router.post('/chat-stream', chatStream);
router.post('/smart-intake', smartIntake);
router.post('/smart-intake-upload', upload.single('file'), smartIntakeUpload);

export default router;

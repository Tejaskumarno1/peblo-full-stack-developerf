import { Router } from 'express';
import { chatAndCreateNotes, chatStream, smartIntake, smartIntakeUpload } from '../controllers/aiChatController.js';
import multer from 'multer';
import { authenticate } from '../middleware/auth.js';
import { aiLimit } from '../middleware/rateLimit.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1 } }); // PEB-62: upload limits

router.use(authenticate);
router.post('/chat', ...aiLimit, chatAndCreateNotes);
router.post('/chat-stream', ...aiLimit, chatStream);
router.post('/smart-intake', ...aiLimit, smartIntake);
router.post('/smart-intake-upload', ...aiLimit, upload.single('file'), smartIntakeUpload);

export default router;

import { Router } from 'express';
import { chatAndCreateNotes, chatStream, smartIntake, smartIntakeUpload, applyChatUpdate } from '../controllers/aiChatController.js';
import multer from 'multer';
import { authenticate } from '../middleware/auth.js';
import { policyOfSpace } from '../utils/orgPolicy.js';
import { aiLimit } from '../middleware/rateLimit.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1 } }); // PEB-62: upload limits

router.use(authenticate);
// An organization can turn AI off for its team notes (Policy > AI features).
router.use(async (req, res, next) => {
  try {
    const sp = String(req.headers['x-peblo-space'] ?? '').trim();
    if (sp && sp !== 'personal') { const pol = await policyOfSpace(sp); if (pol && !pol.aiFeatures) return res.status(403).json({ error: 'Your organization has turned AI off for shared notes.' }); }
    next();
  } catch (e) { next(e); }
});
router.post('/chat', ...aiLimit, chatAndCreateNotes);
router.post('/chat-stream', ...aiLimit, chatStream);
router.post('/chat/apply-update', applyChatUpdate); // the person said yes to a suggested change: no AI call
router.post('/smart-intake', ...aiLimit, smartIntake);
router.post('/smart-intake-upload', ...aiLimit, upload.single('file'), smartIntakeUpload);

export default router;

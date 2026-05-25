import { Router } from 'express';
import { signup, login, me, refresh } from '../controllers/authController.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

router.post('/signup', signup);
router.post('/login', login);
router.get('/me', authenticate, me);
router.post('/refresh', refresh);

export default router;

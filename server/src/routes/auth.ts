import { Router } from 'express';
import { signup, login, me, refresh } from '../controllers/authController.js';
import { authenticate } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { authSchemas } from '../schemas/index.js';

const router = Router();

router.post('/signup', validate(authSchemas.signup), signup);
router.post('/login', validate(authSchemas.login), login);
router.get('/me', authenticate, me);
router.post('/refresh', refresh);

export default router;

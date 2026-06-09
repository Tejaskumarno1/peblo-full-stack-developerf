import { Router } from 'express';
import { signup, login, googleLogin, me, refresh, updateProfile, updatePassword, logoutAll, linkGoogle } from '../controllers/authController.js';
import { authenticate } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { authSchemas } from '../schemas/index.js';

const router = Router();

router.post('/signup', validate(authSchemas.signup), signup);
router.post('/login', validate(authSchemas.login), login);
router.post('/google', googleLogin);
router.get('/me', authenticate, me);
router.post('/refresh', refresh);

// Profile and Settings
router.put('/profile', authenticate, updateProfile);
router.post('/password', authenticate, updatePassword);
router.post('/logout-all', authenticate, logoutAll);
router.post('/google-link', authenticate, linkGoogle);

export default router;

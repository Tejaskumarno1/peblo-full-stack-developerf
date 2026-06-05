import { Router } from 'express';
import { getSharedNote } from '../controllers/shareController.js';

const router = Router();

router.get('/:shareId', getSharedNote);

export default router;

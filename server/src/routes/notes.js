import { Router } from 'express';
import { getNotes, getNote, createNote, updateNote, deleteNote, archiveNote, shareNote, getBackups, revertBackup } from '../controllers/notesController.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

router.use(authenticate);

router.get('/', getNotes);
router.post('/', createNote);
router.get('/:id', getNote);
router.patch('/:id', updateNote);
router.delete('/:id', deleteNote);
router.post('/:id/archive', archiveNote);
router.post('/:id/share', shareNote);
router.get('/:id/backups', getBackups);
router.post('/:id/backups/:backupId/revert', revertBackup);

export default router;

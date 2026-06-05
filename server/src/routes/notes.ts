import { Router } from 'express';
import { getNotes, getNote, createNote, updateNote, deleteNote, archiveNote, shareNote, getBackups, revertBackup } from '../controllers/notesController.js';
import { authenticate } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { noteSchemas } from '../schemas/index.js';

const router = Router();

router.use(authenticate);

router.get('/', getNotes);
router.post('/', validate(noteSchemas.create), createNote);
router.get('/:id', getNote);
router.patch('/:id', validate(noteSchemas.update), updateNote);
router.delete('/:id', deleteNote);
router.post('/:id/archive', archiveNote);
router.post('/:id/share', shareNote);
router.get('/:id/backups', getBackups);
router.post('/:id/backups/:backupId/revert', revertBackup);

export default router;

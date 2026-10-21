import { Router } from 'express';
import { getNotes, getNote, createNote, updateNote, deleteNote, restoreNote, archiveNote, getBackups, getBackup, revertBackup, getBacklinks, getMentions, linkMention, openDailyNote } from '../controllers/notesController.js';
import { authenticate } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { noteSchemas } from '../schemas/index.js';

const router = Router();

router.use(authenticate);

router.get('/', getNotes);
router.post('/', validate(noteSchemas.create), createNote);
router.post('/daily', openDailyNote);
router.get('/:id/backlinks', getBacklinks);
router.get('/:id/mentions', getMentions);
router.post('/:id/mentions/:otherId/link', linkMention);
router.get('/:id', getNote);
router.patch('/:id', validate(noteSchemas.update), updateNote);
router.delete('/:id', deleteNote);
router.post('/:id/restore', restoreNote);
router.post('/:id/archive', archiveNote);
router.get('/:id/backups', getBackups);
router.get('/:id/backups/:backupId', getBackup);
router.post('/:id/backups/:backupId/revert', revertBackup);

export default router;

import { Router } from 'express';
import { getNotes, getNote, createNote, updateNote, deleteNote, restoreNote, archiveNote, getBackups, getBackup, revertBackup, nameVersion, renameBackup, getBacklinks, getMentions, linkMention, openDailyNote } from '../controllers/notesController.js';
import { moveNote, copyNote } from '../controllers/notesMove.js';
import { authenticate } from '../middleware/auth.js';
import { hidePrivateFromTokens } from '../middleware/tokenPrivacy.js';
import { validate } from '../middleware/validate.js';
import { noteSchemas } from '../schemas/index.js';

const router = Router();

router.use(authenticate);
router.param('id', (req, res, next) => { void hidePrivateFromTokens(req, res, next); });

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
router.post('/:id/move', moveNote);
router.post('/:id/copy', copyNote);
router.get('/:id/backups', getBackups);
router.post('/:id/versions', nameVersion);
router.patch('/:id/backups/:backupId', renameBackup);
router.get('/:id/backups/:backupId', getBackup);
router.post('/:id/backups/:backupId/revert', revertBackup);

export default router;

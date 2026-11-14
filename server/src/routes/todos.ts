import { Router } from 'express';
import { getTodos, getTodayTodos, getTodosRange, createTodo, updateTodo, deleteTodo, bulkTodos } from '../controllers/todosController.js';
import { getBoard, putBoard } from '../controllers/boardController.js';
import { getThread, postComment, requestReview } from '../controllers/teamTalk.js';
import { authenticate } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { todoSchemas } from '../schemas/index.js';

const router = Router();

router.use(authenticate);

router.get('/board', getBoard);
router.put('/board', putBoard);
router.get('/', getTodos);
router.get('/today', getTodayTodos);
router.get('/range', getTodosRange);
router.post('/', validate(todoSchemas.create), createTodo);
router.post('/bulk', bulkTodos);
router.get('/:id/thread', getThread);
router.post('/:id/comments', postComment);
router.post('/:id/review', requestReview);
router.patch('/:id', validate(todoSchemas.update), updateTodo);
router.delete('/:id', deleteTodo);

export default router;

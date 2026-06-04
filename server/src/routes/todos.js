import { Router } from 'express';
import { getTodos, getTodayTodos, getTodosRange, createTodo, updateTodo, deleteTodo } from '../controllers/todosController.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

router.use(authenticate);

router.get('/', getTodos);
router.get('/today', getTodayTodos);
router.get('/range', getTodosRange);
router.post('/', createTodo);
router.patch('/:id', updateTodo);
router.delete('/:id', deleteTodo);

export default router;

import { Router } from 'express';
import { getTodos, getTodayTodos, getTodosRange, createTodo, updateTodo, deleteTodo } from '../controllers/todosController.js';
import { authenticate } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { todoSchemas } from '../schemas/index.js';

const router = Router();

router.use(authenticate);

router.get('/', getTodos);
router.get('/today', getTodayTodos);
router.get('/range', getTodosRange);
router.post('/', validate(todoSchemas.create), createTodo);
router.patch('/:id', validate(todoSchemas.update), updateTodo);
router.delete('/:id', deleteTodo);

export default router;

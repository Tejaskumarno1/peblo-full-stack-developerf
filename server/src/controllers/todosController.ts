import { Request, Response, NextFunction } from 'express';
import prisma from '../db.js';
import { autoSyncTodoToGoogle } from './calendarController.js';

export async function getTodos(req: Request, res: Response, next: NextFunction) {
  try {
    const { date, from, to, priority, completed } = req.query;
    const where: any = { userId: req.user!.id };

    // Filter by single date
    if (date) {
      const dayStart = new Date(date as string);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(date as string);
      dayEnd.setHours(23, 59, 59, 999);
      where.deadline = { gte: dayStart, lte: dayEnd }; 
    }

    // Filter by date range
    if (from && to) {
      where.deadline = { gte: new Date(from as string), lte: new Date(to as string) };
    }

    // Filter by priority
    if (priority) {
      where.priority = priority as string;
    }

    // Filter by completion status
    if (completed !== undefined) {
      where.completed = completed === 'true';
    }

    const todos = await prisma.todo.findMany({
      where,
      include: {
        note: { select: { id: true, title: true } }
      },
      orderBy: [
        { completed: 'asc' },
        { deadline: 'asc' },
        { createdAt: 'desc' }
      ]
    });
    res.json({ todos });
  } catch (error) {
    next(error);
  }
}

// GET /todos/today — Tasks due today + overdue, sorted by priority
export async function getTodayTodos(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.id;
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999).toISOString();
    const threeDaysLater = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 3, 23, 59, 59, 999).toISOString();

    // Single raw SQL query fetches ALL incomplete tasks with deadlines up to 3 days out
    // We split them into today/overdue/upcoming in JS (zero extra round-trips)
    const allTasks = await prisma.$queryRaw<any[]>`
      SELECT t.id, t.text, t.is_completed AS "completed", t.priority, t.deadline,
             t.tags AS "todoTags", t.start_time AS "startTime", t.end_time AS "endTime",
             t.recurrence, t.created_at AS "createdAt", t.updated_at AS "updatedAt",
             CASE WHEN t.linked_note_id IS NOT NULL
               THEN json_build_object('id', n.id, 'title', n.title)
               ELSE NULL
             END AS note
      FROM todos t
      LEFT JOIN notes n ON n.id = t.linked_note_id
      WHERE t.user_id = ${userId}
        AND t.is_completed = false
        AND t.deadline IS NOT NULL
        AND t.deadline <= ${threeDaysLater}::timestamptz
      ORDER BY t.deadline ASC
    `;

    const todayStartDate = new Date(todayStart);
    const todayEndDate = new Date(todayEnd);

    const priorityOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };
    const sortByPriority = (a: any, b: any) =>
      (priorityOrder[a.priority] ?? 1) - (priorityOrder[b.priority] ?? 1);

    const todayTasks = allTasks
      .filter(t => t.deadline >= todayStartDate && t.deadline <= todayEndDate)
      .sort(sortByPriority);

    const overdueTasks = allTasks
      .filter(t => t.deadline < todayStartDate)
      .sort(sortByPriority);

    const upcomingTasks = allTasks
      .filter(t => t.deadline > todayEndDate)
      .sort(sortByPriority);

    res.json({ todayTasks, overdueTasks, upcomingTasks });
  } catch (error) {
    next(error);
  }
}

// GET /todos/range?from=...&to=... — Tasks in a date range (for Calendar)
export async function getTodosRange(req: Request, res: Response, next: NextFunction) {
  try {
    const { from, to } = req.query;
    if (!from || !to) {
      return res.status(400).json({ error: 'from and to query params are required' });
    }

    const todos = await prisma.todo.findMany({
      where: {
        userId: req.user!.id,
        deadline: { gte: new Date(from as string), lte: new Date(to as string) }
      },
      include: { note: { select: { id: true, title: true } } },
      orderBy: [{ deadline: 'asc' }, { priority: 'asc' }]
    });

    res.json({ todos });
  } catch (error) {
    next(error);
  }
}

export async function createTodo(req: Request, res: Response, next: NextFunction) {
  try {
    const { text, priority, deadline, tags, noteId, startTime, endTime, recurrence, timezone } = req.body;
    if (!text || text.trim() === '') {
      return res.status(400).json({ error: 'Text is required' });
    }

    const validPriorities = ['high', 'medium', 'low'];
    const safePriority = validPriorities.includes(priority) ? priority : 'medium';

    const validRecurrence = ['none', 'daily', 'weekly', 'monthly', 'yearly'];
    const safeRecurrence = validRecurrence.includes(recurrence) ? recurrence : 'none';

    if (noteId) {
      const note = await prisma.note.findFirst({
        where: { id: noteId as string, userId: req.user!.id }
      });
      if (!note) {
        return res.status(400).json({ error: 'Invalid note ID' });
      }
    }

    let currentDeadline = deadline ? new Date(deadline) : null;
    const count = (!currentDeadline || safeRecurrence === 'none') ? 1 : 
      (safeRecurrence === 'daily' ? 30 : 
      (safeRecurrence === 'weekly' ? 12 : 
      (safeRecurrence === 'monthly' ? 12 : 
      (safeRecurrence === 'yearly' ? 5 : 1))));
    
    const dataToInsert = [];

    for (let i = 0; i < count; i++) {
      dataToInsert.push({
        text: text.trim(),
        priority: safePriority,
        deadline: currentDeadline,
        startTime: startTime || null,
        endTime: endTime || null,
        recurrence: safeRecurrence,
        todoTags: Array.isArray(tags) ? tags.map((t: any) => t.trim()).filter(Boolean) : [],
        noteId: noteId || null,
        userId: req.user!.id
      });

      if (currentDeadline && safeRecurrence !== 'none') {
        currentDeadline = new Date(currentDeadline);
        if (safeRecurrence === 'daily') currentDeadline.setDate(currentDeadline.getDate() + 1);
        else if (safeRecurrence === 'weekly') currentDeadline.setDate(currentDeadline.getDate() + 7);
        else if (safeRecurrence === 'monthly') currentDeadline.setMonth(currentDeadline.getMonth() + 1);
        else if (safeRecurrence === 'yearly') currentDeadline.setFullYear(currentDeadline.getFullYear() + 1);
      }
    }

    if (count === 1) {
      const todo = await prisma.todo.create({
        data: dataToInsert[0],
        include: { note: { select: { id: true, title: true } } }
      });
      // Background sync
      autoSyncTodoToGoogle(todo, req.user!.id, 'create', timezone);
      
      const io = req.app.get('io');
      if (io) io.to(req.user!.id).emit('todos_changed');
      
      return res.status(201).json({ todo });
    }

    await prisma.todo.createMany({ data: dataToInsert });
    
    const firstTodo = await prisma.todo.findFirst({
      where: { userId: req.user!.id, text: text.trim(), deadline: dataToInsert[0].deadline },
      orderBy: { createdAt: 'desc' },
      include: { note: { select: { id: true, title: true } } }
    });

    // Background sync the first recurrence instance
    if (firstTodo) {
      autoSyncTodoToGoogle(firstTodo, req.user!.id, 'create', timezone);
    }

    const io = req.app.get('io');
    if (io) io.to(req.user!.id).emit('todos_changed');

    res.status(201).json({ todo: firstTodo });
  } catch (error) {
    next(error);
  }
}

export async function updateTodo(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    const { text, completed, priority, deadline, tags, noteId, startTime, endTime, recurrence, timezone } = req.body;

    const todo = await prisma.todo.findFirst({
      where: { id: id as string, userId: req.user!.id }
    });

    if (!todo) {
      return res.status(404).json({ error: 'Todo not found' });
    }

    const data: any = {};
    if (text !== undefined) data.text = text.trim();
    if (completed !== undefined) data.completed = completed;
    if (priority !== undefined) {
      const validPriorities = ['high', 'medium', 'low'];
      data.priority = validPriorities.includes(priority) ? priority : todo.priority;
    }
    if (deadline !== undefined) data.deadline = deadline ? new Date(deadline) : null;
    if (startTime !== undefined) data.startTime = startTime || null;
    if (endTime !== undefined) data.endTime = endTime || null;
    if (recurrence !== undefined) {
      const validRecurrence = ['none', 'daily', 'weekly', 'monthly', 'yearly'];
      data.recurrence = validRecurrence.includes(recurrence) ? recurrence : todo.recurrence;
    }
    if (tags !== undefined) data.todoTags = Array.isArray(tags) ? tags.map((t: any) => t.trim()).filter(Boolean) : [];
    if (noteId !== undefined) {
      if (noteId) {
        const note = await prisma.note.findFirst({
          where: { id: noteId as string, userId: req.user!.id }
        });
        if (!note) {
          return res.status(400).json({ error: 'Invalid note ID' });
        }
      }
      data.noteId = noteId || null;
    }

    const updatedTodo = await prisma.todo.update({
      where: { id: id as string },
      data,
      include: { note: { select: { id: true, title: true } } }
    });

    // Background sync
    autoSyncTodoToGoogle(updatedTodo, req.user!.id, 'update', timezone);

    const io = req.app.get('io');
    if (io) io.to(req.user!.id).emit('todos_changed');

    res.json({ todo: updatedTodo });
  } catch (error) {
    next(error);
  }
}

export async function deleteTodo(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    const userId = req.user!.id;

    // Fetch todo data for Google sync before deleting (still needed for sync)
    const todo = await prisma.todo.findFirst({
      where: { id: id as string, userId }
    });

    if (!todo) {
      return res.status(404).json({ error: 'Todo not found' });
    }

    await prisma.todo.delete({
      where: { id: id as string }
    });

    // Background sync deletion (non-blocking)
    autoSyncTodoToGoogle(todo, userId, 'delete');

    const io = req.app.get('io');
    if (io) io.to(userId).emit('todos_changed');

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
}

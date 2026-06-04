import prisma from '../db.js';

export async function getTodos(req, res, next) {
  try {
    const { date, from, to, priority, completed } = req.query;
    const where = { userId: req.user.id };

    // Filter by single date
    if (date) {
      const dayStart = new Date(date);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(date);
      dayEnd.setHours(23, 59, 59, 999);
      where.deadline = { gte: dayStart, lte: dayEnd };
    }

    // Filter by date range
    if (from && to) {
      where.deadline = { gte: new Date(from), lte: new Date(to) };
    }

    // Filter by priority
    if (priority) {
      where.priority = priority;
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
export async function getTodayTodos(req, res, next) {
  try {
    const userId = req.user.id;
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

    const priorityOrder = { high: 0, medium: 1, low: 2 };

    // Tasks due today
    const todayTasks = await prisma.todo.findMany({
      where: {
        userId,
        completed: false,
        deadline: { gte: todayStart, lte: todayEnd }
      },
      include: { note: { select: { id: true, title: true } } }
    });

    // Overdue tasks (deadline before today, not completed)
    const overdueTasks = await prisma.todo.findMany({
      where: {
        userId,
        completed: false,
        deadline: { lt: todayStart, not: null }
      },
      include: { note: { select: { id: true, title: true } } }
    });

    // Upcoming tasks (next 3 days after today)
    const threeDaysLater = new Date(todayEnd);
    threeDaysLater.setDate(threeDaysLater.getDate() + 3);

    const upcomingTasks = await prisma.todo.findMany({
      where: {
        userId,
        completed: false,
        deadline: { gt: todayEnd, lte: threeDaysLater }
      },
      include: { note: { select: { id: true, title: true } } }
    });

    // Sort by priority
    const sortByPriority = (a, b) => (priorityOrder[a.priority] ?? 1) - (priorityOrder[b.priority] ?? 1);

    res.json({
      todayTasks: todayTasks.sort(sortByPriority),
      overdueTasks: overdueTasks.sort(sortByPriority),
      upcomingTasks: upcomingTasks.sort(sortByPriority)
    });
  } catch (error) {
    next(error);
  }
}

// GET /todos/range?from=...&to=... — Tasks in a date range (for Calendar)
export async function getTodosRange(req, res, next) {
  try {
    const { from, to } = req.query;
    if (!from || !to) {
      return res.status(400).json({ error: 'from and to query params are required' });
    }

    const todos = await prisma.todo.findMany({
      where: {
        userId: req.user.id,
        deadline: { gte: new Date(from), lte: new Date(to) }
      },
      include: { note: { select: { id: true, title: true } } },
      orderBy: [{ deadline: 'asc' }, { priority: 'asc' }]
    });

    res.json({ todos });
  } catch (error) {
    next(error);
  }
}

export async function createTodo(req, res, next) {
  try {
    const { text, priority, deadline, tags, noteId, startTime, endTime, recurrence } = req.body;
    if (!text || text.trim() === '') {
      return res.status(400).json({ error: 'Text is required' });
    }

    const validPriorities = ['high', 'medium', 'low'];
    const safePriority = validPriorities.includes(priority) ? priority : 'medium';

    const validRecurrence = ['none', 'daily', 'weekly', 'monthly', 'yearly'];
    const safeRecurrence = validRecurrence.includes(recurrence) ? recurrence : 'none';

    if (noteId) {
      const note = await prisma.note.findFirst({
        where: { id: noteId, userId: req.user.id }
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
        todoTags: Array.isArray(tags) ? tags.map(t => t.trim()).filter(Boolean) : [],
        noteId: noteId || null,
        userId: req.user.id
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
      return res.status(201).json({ todo });
    }

    await prisma.todo.createMany({ data: dataToInsert });
    
    const firstTodo = await prisma.todo.findFirst({
      where: { userId: req.user.id, text: text.trim(), deadline: dataToInsert[0].deadline },
      orderBy: { createdAt: 'desc' },
      include: { note: { select: { id: true, title: true } } }
    });

    res.status(201).json({ todo: firstTodo });
  } catch (error) {
    next(error);
  }
}

export async function updateTodo(req, res, next) {
  try {
    const { id } = req.params;
    const { text, completed, priority, deadline, tags, noteId, startTime, endTime, recurrence } = req.body;

    const todo = await prisma.todo.findFirst({
      where: { id, userId: req.user.id }
    });

    if (!todo) {
      return res.status(404).json({ error: 'Todo not found' });
    }

    const data = {};
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
    if (tags !== undefined) data.todoTags = Array.isArray(tags) ? tags.map(t => t.trim()).filter(Boolean) : [];
    if (noteId !== undefined) {
      if (noteId) {
        const note = await prisma.note.findFirst({
          where: { id: noteId, userId: req.user.id }
        });
        if (!note) {
          return res.status(400).json({ error: 'Invalid note ID' });
        }
      }
      data.noteId = noteId || null;
    }

    const updatedTodo = await prisma.todo.update({
      where: { id },
      data,
      include: { note: { select: { id: true, title: true } } }
    });

    res.json({ todo: updatedTodo });
  } catch (error) {
    next(error);
  }
}

export async function deleteTodo(req, res, next) {
  try {
    const { id } = req.params;

    const todo = await prisma.todo.findFirst({
      where: { id, userId: req.user.id }
    });

    if (!todo) {
      return res.status(404).json({ error: 'Todo not found' });
    }

    await prisma.todo.delete({
      where: { id }
    });

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
}

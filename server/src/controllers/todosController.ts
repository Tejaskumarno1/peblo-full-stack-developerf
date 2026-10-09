import { Request, Response, NextFunction } from 'express';
import prisma from '../db.js';
import { tzOf, dayBounds, dayBoundsOf } from '../utils/userTime.js';
import { RECURRENCES, isRepeating, topUpSeries } from '../services/todoSeries.js';

export async function getTodos(req: Request, res: Response, next: NextFunction) {
  try {
    const { date, from, to, priority, completed, noteId } = req.query;
    await topUpSeries(req.user!.id); // repeating tasks never run out
    const where: any = { userId: req.user!.id };
    if (typeof noteId === 'string' && noteId) where.noteId = noteId;

    // Filter by single date
    if (date) {
      // "2026-10-12" names a calendar day; a full timestamp means the day that moment falls on. Either way the person's day.
      const tz = tzOf(req);
      const ymd = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date));
      let b;
      if (ymd) b = dayBoundsOf(Number(ymd[1]), Number(ymd[2]), Number(ymd[3]), tz);
      else {
        const at = new Date(String(date));
        if (Number.isNaN(at.getTime())) return res.status(400).json({ error: 'Invalid date' });
        b = dayBounds(tz, at);
      }
      where.deadline = { gte: b.start, lte: b.end };
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
    await topUpSeries(userId);
    const tz = tzOf(req);
    const todayStart = dayBounds(tz).start.toISOString();
    const todayEnd = dayBounds(tz).end.toISOString();
    const threeDaysLater = dayBounds(tz, new Date(), 3).end.toISOString();

    // One query fetches all incomplete tasks due up to 3 days out;
    // they are split into today/overdue/upcoming below.
    const allTasks = await prisma.todo.findMany({
      where: { userId, completed: false, deadline: { not: null, lte: new Date(threeDaysLater) } },
      include: { note: { select: { id: true, title: true } } },
      orderBy: { deadline: 'asc' },
    }) as any[];

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
    await topUpSeries(req.user!.id);

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

const SERIES_FIELDS = ['text', 'priority', 'todoTags', 'startTime', 'endTime', 'noteId'] as const;
const SCOPES = ['this', 'following', 'all'];
const scopeOf = (v: unknown) => (typeof v === 'string' && SCOPES.includes(v) ? v : 'this');

export async function createTodo(req: Request, res: Response, next: NextFunction) {
  try {
    const { text, priority, deadline, tags, noteId, startTime, endTime, recurrence } = req.body;
    if (!text || text.trim() === '') {
      return res.status(400).json({ error: 'Text is required' });
    }

    const validPriorities = ['high', 'medium', 'low'];
    const safePriority = validPriorities.includes(priority) ? priority : 'medium';
    const safeRecurrence = (RECURRENCES as readonly string[]).includes(recurrence) ? recurrence : 'none';

    if (noteId) {
      const note = await prisma.note.findFirst({
        where: { id: noteId as string, userId: req.user!.id }
      });
      if (!note) {
        return res.status(400).json({ error: 'Invalid note ID' });
      }
    }

    const userId = req.user!.id;
    const when = deadline ? new Date(deadline) : null;
    const cleanTags = Array.isArray(tags) ? tags.map((t: any) => t.trim()).filter(Boolean) : [];
    const base = {
      text: text.trim(), priority: safePriority, startTime: startTime || null, endTime: endTime || null,
      recurrence: safeRecurrence, todoTags: cleanTags, noteId: noteId || null, userId,
    };

    let todo;
    if (when && isRepeating(safeRecurrence)) {
      // One series; the first occurrence is this task, the rest are generated ahead (and kept topped up).
      const series = await prisma.todoSeries.create({
        data: {
          userId, recurrence: safeRecurrence, timezone: tzOf(req), anchor: when, lastGenerated: when,
          text: base.text, priority: safePriority, todoTags: cleanTags, startTime: base.startTime, endTime: base.endTime, noteId: base.noteId,
        },
      });
      todo = await prisma.todo.create({ data: { ...base, deadline: when, seriesId: series.id }, include: { note: { select: { id: true, title: true } } } });
      await topUpSeries(userId, series.id);
    } else {
      todo = await prisma.todo.create({ data: { ...base, deadline: when }, include: { note: { select: { id: true, title: true } } } });
    }

    const io = req.app.get('io');
    if (io) io.to(userId).emit('todos_changed');

    res.status(201).json({ todo });
  } catch (error) {
    next(error);
  }
}

export async function updateTodo(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    const userId = req.user!.id;
    const { text, completed, priority, deadline, tags, noteId, startTime, endTime, recurrence } = req.body;
    const scope = scopeOf(req.body.scope);

    const todo = await prisma.todo.findFirst({
      where: { id: id as string, userId }
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
    if (tags !== undefined) data.todoTags = Array.isArray(tags) ? tags.map((t: any) => t.trim()).filter(Boolean) : [];
    if (noteId !== undefined) {
      if (noteId) {
        const note = await prisma.note.findFirst({
          where: { id: noteId as string, userId }
        });
        if (!note) {
          return res.status(400).json({ error: 'Invalid note ID' });
        }
      }
      data.noteId = noteId || null;
    }

    // Changing "repeat" ends the old series after this task and starts a new one from it (or none).
    const newRule = recurrence !== undefined && (RECURRENCES as readonly string[]).includes(recurrence) ? recurrence : undefined;
    const ruleChanged = newRule !== undefined && newRule !== (todo.recurrence || 'none');
    let startSeries = false;
    if (ruleChanged) {
      if (todo.seriesId) {
        await prisma.todo.deleteMany({ where: { seriesId: todo.seriesId, id: { not: todo.id }, completed: false, deadline: { gt: todo.deadline ?? new Date(0) } } });
        await prisma.todoSeries.update({ where: { id: todo.seriesId }, data: { endedAt: new Date() } });
        data.seriesId = null;
      }
      data.recurrence = newRule;
      startSeries = isRepeating(newRule) && !!(data.deadline ?? todo.deadline);
    }

    const updatedTodo = await prisma.todo.update({
      where: { id: id as string },
      data,
      include: { note: { select: { id: true, title: true } } }
    });

    if (startSeries && updatedTodo.deadline) {
      const series = await prisma.todoSeries.create({
        data: {
          userId, recurrence: newRule as string, timezone: tzOf(req), anchor: updatedTodo.deadline, lastGenerated: updatedTodo.deadline,
          text: updatedTodo.text, priority: updatedTodo.priority, todoTags: updatedTodo.todoTags ?? [], startTime: updatedTodo.startTime, endTime: updatedTodo.endTime, noteId: updatedTodo.noteId,
        },
      });
      await prisma.todo.update({ where: { id: updatedTodo.id }, data: { seriesId: series.id } });
      (updatedTodo as any).seriesId = series.id;
      await topUpSeries(userId, series.id);
    } else if (!ruleChanged && todo.seriesId && scope !== 'this') {
      // "This and following" / "all": the shared details change for the other open occurrences too, and for the ones still to come.
      const shared: any = {};
      for (const f of SERIES_FIELDS) if (f in data) shared[f] = data[f];
      if (Object.keys(shared).length) {
        const where: any = { seriesId: todo.seriesId, completed: false, id: { not: todo.id } };
        if (scope === 'following' && todo.deadline) where.deadline = { gte: todo.deadline };
        await prisma.todo.updateMany({ where, data: shared });
        await prisma.todoSeries.update({ where: { id: todo.seriesId }, data: shared });
      }
    }

    const io = req.app.get('io');
    if (io) io.to(userId).emit('todos_changed');

    res.json({ todo: updatedTodo });
  } catch (error) {
    next(error);
  }
}

export async function deleteTodo(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    const userId = req.user!.id;
    const scope = scopeOf(req.query.scope);

    const todo = await prisma.todo.findFirst({
      where: { id: id as string, userId }
    });

    if (!todo) {
      return res.status(404).json({ error: 'Todo not found' });
    }

    if (todo.seriesId && scope === 'all') {
      await prisma.todo.deleteMany({ where: { seriesId: todo.seriesId, userId } });
      await prisma.todoSeries.deleteMany({ where: { id: todo.seriesId, userId } });
    } else if (todo.seriesId && scope === 'following') {
      // Delete this one and every later one, and stop the series so it does not start again.
      await prisma.todo.deleteMany({ where: { seriesId: todo.seriesId, userId, ...(todo.deadline ? { deadline: { gte: todo.deadline } } : { id: todo.id }) } });
      await prisma.todoSeries.update({ where: { id: todo.seriesId }, data: { endedAt: new Date() } });
    } else {
      await prisma.todo.delete({ where: { id: id as string } });
    }

    const io = req.app.get('io');
    if (io) io.to(userId).emit('todos_changed');

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
}

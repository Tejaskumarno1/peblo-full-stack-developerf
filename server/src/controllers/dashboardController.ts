import { Request, Response, NextFunction } from 'express';
import prisma from '../db.js';
import {
  buildDailyActivity,
  buildYearHeatmap,
  calculateStreakStats,
  getEditsThisMonth,
} from '../utils/activityStats.js';

// prisma imported from db.js

export async function getInsights(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.id;
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const oneYearAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();

    const sevenDaysAgoDate = new Date(sevenDaysAgo);
    const oneYearAgoDate = new Date(oneYearAgo);

    const [
      totalNotes,
      archivedNotes,
      totalAiUsage,
      tagLinks,
      recentNoteRows,
      recentAiGenerations,
      aiStats,
      heatmapNotes,
      categoryRows,
      todoNotes,
      openTasks,
    ] = await Promise.all([
      prisma.note.count({ where: { userId, isArchived: false, isDeleted: false } }),
      prisma.note.count({ where: { userId, isArchived: true, isDeleted: false } }),
      prisma.aiGeneration.count({ where: { userId } }),
      prisma.noteTag.findMany({
        where: { note: { userId, isDeleted: false } },
        select: { tag: { select: { id: true, name: true } } },
      }),
      prisma.note.findMany({
        where: { userId, isDeleted: false, updatedAt: { gte: sevenDaysAgoDate } },
        select: { id: true, title: true, updatedAt: true, tags: { select: { tag: { select: { name: true } } } } },
        orderBy: { updatedAt: 'desc' },
        take: 5,
      }),
      prisma.aiGeneration.findMany({
        where: { userId },
        select: { id: true, type: true, createdAt: true, note: { select: { title: true } } },
        orderBy: { createdAt: 'desc' },
        take: 5,
      }),
      prisma.aiGeneration.groupBy({ by: ['type'], where: { userId }, _count: { _all: true } }),
      prisma.note.findMany({
        where: { userId, updatedAt: { gte: oneYearAgoDate } },
        select: { createdAt: true, updatedAt: true },
      }),
      prisma.note.groupBy({
        by: ['category'],
        where: { userId, isArchived: false, isDeleted: false, category: { not: null } },
        _count: { _all: true },
      }),
      prisma.todo.findMany({
        where: { userId },
        include: { note: { select: { id: true, title: true } } },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
      prisma.todo.count({ where: { userId, completed: false } }),
    ]);

    const tagCounts = new Map<string, number>();
    for (const link of tagLinks) {
      tagCounts.set(link.tag.name, (tagCounts.get(link.tag.name) || 0) + 1);
    }
    const topTagRows = [...tagCounts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    const counts = { totalNotes, archivedNotes, totalAiUsage, uniqueTagCount: tagCounts.size };
    const recentNotes = recentNoteRows.map((n) => ({ ...n, tags: n.tags.map((t) => ({ name: t.tag.name })) }));
    const categories = categoryRows.map((c) => ({ category: c.category, count: c._count._all }));

    // ── Lightweight JS post-processing (no more DB calls) ──

    const topTags = topTagRows;

    const recentAiActivity = recentAiGenerations.map((g: any) => {
      const title = g.note?.title || 'Untitled';
      const action =
        g.type === 'summary'
          ? `Summarized "${title}" notes`
          : g.type === 'action_items'
            ? `Extracted actions from "${title}"`
            : `Suggested title for "${title}"`;
      return { id: g.id, type: g.type, message: action, createdAt: g.createdAt };
    });

    const aiUsage = {
      total: counts.totalAiUsage,
      byType: aiStats.reduce((acc: any, stat: any) => {
        acc[stat.type] = stat._count._all;
        return acc;
      }, {}),
    };

    // Activity heatmap & streak
    const dayMap = buildDailyActivity(heatmapNotes);

    const todayKey = new Date().toISOString().split('T')[0];
    if (!dayMap[todayKey]) {
      dayMap[todayKey] = { date: todayKey, created: 0, updated: 0, total: 0 };
    }
    if (dayMap[todayKey].total === 0) {
      dayMap[todayKey].total = 1;
      dayMap[todayKey].updated = 1;
    }

    const activityHeatmap = buildYearHeatmap(dayMap);
    const streakStats = calculateStreakStats(dayMap);
    const editsThisMonth = getEditsThisMonth(dayMap);

    res.json({
      totalNotes: counts.totalNotes,
      archivedNotes: counts.archivedNotes,
      openTasks,
      dashboardTasks: todoNotes || [],
      recentNotes: recentNotes.map((n: any) => ({
        id: n.id,
        title: n.title,
        updatedAt: n.updatedAt,
        tags: (n.tags || []).map((t: any) => t.name),
      })),
      topTags,
      uniqueTagCount: counts.uniqueTagCount,
      recentAiActivity,
      aiUsage,
      activityHeatmap,
      streakStats,
      editsThisMonth,
      categories: categories.map((c: any) => ({
        name: c.category || 'Uncategorized',
        count: c.count,
      })),
    });
  } catch (error) {
    next(error);
  }
}

export async function toggleTask(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.id;
    const { id, completed } = req.body ?? {};
    if (typeof id !== 'string' || !id || typeof completed !== 'boolean') {
      return res.status(400).json({ error: 'Validation Error', details: [{ path: 'id', message: 'id (string) and completed (boolean) are required' }] });
    }

    // Single query: updateMany enforces userId ownership without a separate findFirst
    const { count } = await prisma.todo.updateMany({
      where: { id, userId },
      data: { completed }
    });

    if (count === 0) {
      return res.status(404).json({ error: 'Todo not found' });
    }

    res.json({ success: true, updatedTodo: { id, completed } });
  } catch (error) {
    next(error);
  }
}

export async function getDailyBriefing(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.id;
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999).toISOString();
    const yesterdayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1).toISOString();

    const todayStartD = new Date(todayStart);
    const todayEndD = new Date(todayEnd);
    const yesterdayStartD = new Date(yesterdayStart);
    const priorityRank: Record<string, number> = { high: 0, medium: 1, low: 2 };

    const [completedYesterday, totalActive, overdueTasks, todayTasksRaw, recentNotes] = await Promise.all([
      prisma.todo.count({
        where: { userId, completed: true, updatedAt: { gte: yesterdayStartD, lt: todayStartD } },
      }),
      prisma.todo.count({ where: { userId, completed: false } }),
      prisma.todo.findMany({
        where: { userId, completed: false, deadline: { not: null, lt: todayStartD } },
        select: { id: true, text: true, priority: true, deadline: true },
        orderBy: { deadline: 'asc' },
        take: 10,
      }),
      prisma.todo.findMany({
        where: { userId, completed: false, deadline: { gte: todayStartD, lte: todayEndD } },
        select: { id: true, text: true, priority: true, startTime: true, endTime: true },
      }),
      prisma.note.findMany({
        where: { userId, isArchived: false, isDeleted: false, updatedAt: { gte: yesterdayStartD } },
        select: { id: true, title: true, updatedAt: true },
        orderBy: { updatedAt: 'desc' },
        take: 5,
      }),
    ]);
    const todayTasks = todayTasksRaw.sort(
      (x, y) => (priorityRank[x.priority] ?? 1) - (priorityRank[y.priority] ?? 1)
    );
    const countRow = { completedYesterday, totalActive };

    const hour = now.getHours();
    const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

    res.json({
      greeting,
      date: now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }),
      stats: {
        overdue: overdueTasks.length,
        dueToday: todayTasks.length,
        totalActive: countRow.totalActive,
        completedYesterday: countRow.completedYesterday,
      },
      overdueTasks: overdueTasks.map((t: any) => ({ id: t.id, text: t.text, priority: t.priority, deadline: t.deadline })),
      todayTasks: todayTasks.map((t: any) => ({ id: t.id, text: t.text, priority: t.priority, startTime: t.startTime, endTime: t.endTime })),
      recentNotes: recentNotes.map((n: any) => ({ id: n.id, title: n.title, updatedAt: n.updatedAt })),
      tip: getDailyTip(),
    });
  } catch (error) {
    next(error);
  }
}

function getDailyTip() {
  const tips = [
    "Start with your hardest task — you'll feel unstoppable after.",
    "Try the 2-minute rule: if it takes less than 2 minutes, do it now.",
    "Take a 5-minute break every 25 minutes to stay sharp.",
    "End your day by planning tomorrow — you'll sleep better and start faster.",
    "Block notifications for 90 minutes of deep work.",
    "Don't break the chain — maintain your streak!",
    "Listen to instrumental music for better focus during complex tasks.",
    "Eat the frog first — tackle your most dreaded task before anything else.",
  ];
  // One tip per day, so it doesn't change every time the home screen refreshes.
  const day = Math.floor((Date.now() - new Date().getTimezoneOffset() * 60000) / 86400000);
  return tips[day % tips.length];
}

export async function getWeeklyReport(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.id;
    const now = new Date();
    const weekAgo = new Date(now);
    weekAgo.setDate(weekAgo.getDate() - 7);

    const [tasksCreated, completedTodos, notesCreated, editedNotes, aiUsage, openTasks] = await Promise.all([
      prisma.todo.count({ where: { userId, createdAt: { gte: weekAgo } } }),
      prisma.todo.findMany({
        where: { userId, completed: true, updatedAt: { gte: weekAgo, lte: now } },
        select: { updatedAt: true },
      }),
      prisma.note.count({ where: { userId, createdAt: { gte: weekAgo } } }),
      prisma.note.findMany({
        where: { userId, updatedAt: { gte: weekAgo, lte: now } },
        select: { updatedAt: true, tags: { select: { tag: { select: { name: true } } } } },
      }),
      prisma.aiGeneration.count({ where: { userId, createdAt: { gte: weekAgo } } }),
      prisma.todo.count({ where: { userId, completed: false } }),
    ]);

    const countRow = {
      tasksCreated,
      tasksCompleted: completedTodos.length,
      notesCreated,
      notesEdited: editedNotes.length,
      aiUsage,
    };

    const tagTally = new Map<string, number>();
    for (const n of editedNotes) {
      for (const t of n.tags) tagTally.set(t.tag.name, (tagTally.get(t.tag.name) || 0) + 1);
    }
    const topTags = [...tagTally.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((x, y) => y.count - x.count)
      .slice(0, 5);

    // One bucket per day for the last 7 days (local time), oldest first
    const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const dailyBreakdown: any[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      dailyBreakdown.push({ date: d, key: dayKey(d), tasksCompleted: 0, notesEdited: 0 });
    }
    const byKey = new Map(dailyBreakdown.map((d) => [d.key, d]));
    for (const t of completedTodos) { const b = byKey.get(dayKey(t.updatedAt)); if (b) b.tasksCompleted++; }
    for (const n of editedNotes) { const b = byKey.get(dayKey(n.updatedAt)); if (b) b.notesEdited++; }

    // Of everything on your plate this week (finished this week + still open), how much you finished.
    const onPlate = countRow.tasksCompleted + openTasks;
    const completionRate = onPlate > 0 ? Math.round((countRow.tasksCompleted / onPlate) * 100) : 0;

    res.json({
      period: {
        from: weekAgo.toISOString().split('T')[0],
        to: now.toISOString().split('T')[0],
      },
      stats: {
        tasksCreated: countRow.tasksCreated,
        tasksCompleted: countRow.tasksCompleted,
        completionRate,
        notesCreated: countRow.notesCreated,
        notesEdited: countRow.notesEdited,
        aiUsage: countRow.aiUsage,
      },
      dailyBreakdown: dailyBreakdown.map((d: any) => ({
        day: new Date(d.date).toLocaleDateString('en-US', { weekday: 'short' }),
        date: d.key,
        tasksCompleted: d.tasksCompleted,
        notesEdited: d.notesEdited,
      })),
      topTags,
    });
  } catch (error) {
    next(error);
  }
}

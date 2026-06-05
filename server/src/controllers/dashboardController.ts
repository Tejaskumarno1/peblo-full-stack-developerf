import prisma from '../db.js';
import {
  buildDailyActivity,
  buildYearHeatmap,
  calculateStreakStats,
  getEditsThisMonth,
} from '../utils/activityStats.js';

// prisma imported from db.js

export async function getInsights(req, res, next) {
  console.time('getInsights');
  try {
    const userId = req.user.id;

    // Run ALL queries in a single transaction to use only 1 connection, 
    // preventing connection pool saturation and massive latency
    const [
      totalNotes,
      archivedNotes,
      recentNotes,
      allNoteTags,
      recentAiGenerations,
      aiStats,
      totalAiUsage,
      allNotes,
      categories,
      todoNotes,
    ] = await prisma.$transaction([
      // Total notes count
      prisma.note.count({ where: { userId, isArchived: false } }),

      // Archived notes count
      prisma.note.count({ where: { userId, isArchived: true } }),

      // Recently edited notes (last 7 days)
      prisma.note.findMany({
        where: {
          userId,
          updatedAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
        },
        select: {
          id: true,
          title: true,
          updatedAt: true,
          isPublic: true,
          tags: {
            include: { tag: true }
          }
        },
        orderBy: { updatedAt: 'desc' },
        take: 5,
      }),

      // All note tags for tag cloud (Optimized: group by tagId in DB)
      prisma.noteTag.groupBy({
        by: ['tagId'],
        where: { note: { userId } },
        _count: { tagId: true },
        orderBy: { _count: { tagId: 'desc' } },
        take: 10,
      }),

      // Recent AI generations
      prisma.aiGeneration.findMany({
        where: { userId },
        include: { note: { select: { title: true } } },
        orderBy: { createdAt: 'desc' },
        take: 5,
      }),

      // AI stats by type
      prisma.aiGeneration.groupBy({
        by: ['type'],
        where: { userId },
        _count: { id: true },
      }),

      // Total AI usage
      prisma.aiGeneration.count({ where: { userId } }),

      // All notes for heatmap (lightweight select)
      prisma.note.findMany({
        where: { userId, updatedAt: { gte: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000) } },
        select: { createdAt: true, updatedAt: true, isPublic: true },
      }),

      // Categories breakdown
      prisma.note.groupBy({
        by: ['category'],
        where: { userId, isArchived: false, category: { not: null } },
        _count: { id: true },
      }),

      // Find pending tasks from the Todo table
      prisma.todo.findMany({
        where: { userId },
        include: { note: { select: { id: true, title: true } } },
        orderBy: { createdAt: 'desc' },
        take: 10
      }),
    ]);

    // We now have the top 10 tagIds, we need to fetch their names
    const topTagIds = allNoteTags.map((nt) => nt.tagId);
    const resolvedTags = await prisma.tag.findMany({
      where: { id: { in: topTagIds } },
      select: { id: true, name: true }
    });
    
    // Process tag counts
    const uniqueTagCount = await prisma.noteTag.groupBy({
      by: ['tagId'],
      where: { note: { userId } }
    }).then(res => res.length);

    const topTags = allNoteTags.map((nt) => {
      const tag = resolvedTags.find(t => t.id === nt.tagId);
      return {
        name: tag ? tag.name : 'Unknown',
        count: nt._count.tagId
      };
    });

    // Process AI activity
    const recentAiActivity = recentAiGenerations.map((g) => {
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
      total: totalAiUsage,
      byType: aiStats.reduce((acc, stat) => {
        acc[stat.type] = stat._count.id;
        return acc;
      }, {}),
    };

    // Activity heatmap & streak — also include login activity (today)
    const dayMap = buildDailyActivity(allNotes);

    // Always mark today as active (user is logged in right now)
    const todayKey = new Date().toISOString().split('T')[0];
    if (!dayMap[todayKey]) {
      dayMap[todayKey] = { date: todayKey, created: 0, updated: 0, total: 0 };
    }
    // Ensure at least 1 activity for today since user is viewing the dashboard
    if (dayMap[todayKey].total === 0) {
      dayMap[todayKey].total = 1;
      dayMap[todayKey].updated = 1;
    }

    const activityHeatmap = buildYearHeatmap(dayMap);
    const streakStats = calculateStreakStats(dayMap);
    const editsThisMonth = getEditsThisMonth(dayMap);

    const publicNotes = allNotes.filter((n) => n.isPublic).length;

    // Use the 10th item from the transaction array (which we named todoNotes previously)
    const dashboardTasks = todoNotes || [];

    res.json({
      totalNotes,
      archivedNotes,
      publicNotes,
      dashboardTasks,
      recentNotes: recentNotes.map((n) => ({
        id: n.id,
        title: n.title,
        updatedAt: n.updatedAt,
        isPublic: n.isPublic,
        tags: n.tags.map((nt) => nt.tag.name),
      })),
      topTags,
      uniqueTagCount,
      recentAiActivity,
      aiUsage,
      activityHeatmap,
      streakStats,
      editsThisMonth,
      categories: categories.map((c) => ({
        name: c.category || 'Uncategorized',
        count: c._count.id,
      })),
    });
    console.timeEnd('getInsights');
  } catch (error) {
    console.timeEnd('getInsights');
    next(error);
  }
}

export async function toggleTask(req, res, next) {
  try {
    const userId = req.user.id;
    const { id, completed } = req.body;

    const todo = await prisma.todo.findFirst({
      where: { id, userId }
    });

    if (!todo) {
      return res.status(404).json({ error: 'Todo not found' });
    }

    const updatedTodo = await prisma.todo.update({
      where: { id },
      data: { completed }
    });

    res.json({ success: true, updatedTodo });
  } catch (error) {
    next(error);
  }
}

export async function getDailyBriefing(req, res, next) {
  try {
    const userId = req.user.id;
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    const yesterdayStart = new Date(todayStart);
    yesterdayStart.setDate(yesterdayStart.getDate() - 1);

    const [overdueTasks, todayTasks, recentNotes, yesterdayCompleted, totalActive] = await prisma.$transaction([
      // Overdue tasks
      prisma.todo.findMany({
        where: { userId, completed: false, deadline: { lt: todayStart, not: null } },
        orderBy: { deadline: 'asc' },
        take: 10,
      }),
      // Today's tasks
      prisma.todo.findMany({
        where: { userId, completed: false, deadline: { gte: todayStart, lte: todayEnd } },
        orderBy: { priority: 'asc' },
      }),
      // Notes edited in last 24 hours
      prisma.note.findMany({
        where: { userId, isArchived: false, updatedAt: { gte: yesterdayStart } },
        select: { id: true, title: true, updatedAt: true },
        orderBy: { updatedAt: 'desc' },
        take: 5,
      }),
      // Tasks completed yesterday
      prisma.todo.count({
        where: { userId, completed: true, updatedAt: { gte: yesterdayStart, lt: todayStart } },
      }),
      // Total active tasks
      prisma.todo.count({
        where: { userId, completed: false },
      }),
    ]);

    const hour = now.getHours();
    const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

    const briefing = {
      greeting,
      date: now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }),
      stats: {
        overdue: overdueTasks.length,
        dueToday: todayTasks.length,
        totalActive,
        completedYesterday: yesterdayCompleted,
      },
      overdueTasks: overdueTasks.map(t => ({ id: t.id, text: t.text, priority: t.priority, deadline: t.deadline })),
      todayTasks: todayTasks.map(t => ({ id: t.id, text: t.text, priority: t.priority, startTime: t.startTime, endTime: t.endTime })),
      recentNotes: recentNotes.map(n => ({ id: n.id, title: n.title, updatedAt: n.updatedAt })),
      tip: getDailyTip(),
    };

    res.json(briefing);
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
  return tips[Math.floor(Math.random() * tips.length)];
}

export async function getWeeklyReport(req, res, next) {
  try {
    const userId = req.user.id;
    const now = new Date();
    const weekAgo = new Date(now);
    weekAgo.setDate(weekAgo.getDate() - 7);

    const [
      tasksCreated,
      tasksCompleted,
      notesCreated,
      notesEdited,
      aiUsage,
      topTags,
    ] = await prisma.$transaction([
      prisma.todo.count({ where: { userId, createdAt: { gte: weekAgo } } }),
      prisma.todo.count({ where: { userId, completed: true, updatedAt: { gte: weekAgo } } }),
      prisma.note.count({ where: { userId, createdAt: { gte: weekAgo } } }),
      prisma.note.count({ where: { userId, updatedAt: { gte: weekAgo } } }),
      prisma.aiGeneration.count({ where: { userId, createdAt: { gte: weekAgo } } }),
      prisma.noteTag.groupBy({
        by: ['tagId'],
        where: { note: { userId, updatedAt: { gte: weekAgo } } },
        _count: { tagId: true },
        orderBy: { _count: { tagId: 'desc' } },
        take: 5,
      }),
    ]);

    // Resolve tag names
    const tagIds = topTags.map(t => t.tagId);
    const resolvedTags = tagIds.length > 0
      ? await prisma.tag.findMany({ where: { id: { in: tagIds } }, select: { id: true, name: true } })
      : [];

    // Daily breakdown for the week
    const [weeklyCompletedTodos, weeklyNotes] = await prisma.$transaction([
      prisma.todo.findMany({
        where: { userId, completed: true, updatedAt: { gte: weekAgo, lte: now } },
        select: { updatedAt: true }
      }),
      prisma.note.findMany({
        where: { userId, updatedAt: { gte: weekAgo, lte: now } },
        select: { updatedAt: true }
      })
    ]);

    const dailyStats = [];
    for (let i = 6; i >= 0; i--) {
      const day = new Date(now);
      day.setDate(day.getDate() - i);
      const dayStart = new Date(day.getFullYear(), day.getMonth(), day.getDate());
      const dayEnd = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 23, 59, 59, 999);

      const completed = weeklyCompletedTodos.filter(t => t.updatedAt >= dayStart && t.updatedAt <= dayEnd).length;
      const created = weeklyNotes.filter(n => n.updatedAt >= dayStart && n.updatedAt <= dayEnd).length;

      dailyStats.push({
        day: dayStart.toLocaleDateString('en-US', { weekday: 'short' }),
        date: dayStart.toISOString().split('T')[0],
        tasksCompleted: completed,
        notesEdited: created,
      });
    }

    const completionRate = tasksCreated > 0 ? Math.round((tasksCompleted / tasksCreated) * 100) : 0;

    res.json({
      period: {
        from: weekAgo.toISOString().split('T')[0],
        to: now.toISOString().split('T')[0],
      },
      stats: {
        tasksCreated,
        tasksCompleted,
        completionRate,
        notesCreated,
        notesEdited,
        aiUsage,
      },
      dailyBreakdown: dailyStats,
      topTags: topTags.map(t => {
        const tag = resolvedTags.find(r => r.id === t.tagId);
        return { name: tag?.name || 'Unknown', count: t._count.tagId };
      }),
    });
  } catch (error) {
    next(error);
  }
}

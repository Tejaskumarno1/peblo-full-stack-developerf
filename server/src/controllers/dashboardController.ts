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
  console.time('getInsights');
  try {
    const userId = req.user!.id;
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const oneYearAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();

    // ── Single raw SQL query for ALL scalar counts ──
    // This replaces 4 separate Prisma count() calls with 1 DB round-trip
    const [counts] = await prisma.$queryRaw<any[]>`
      SELECT
        (SELECT COUNT(*) FROM notes WHERE user_id = ${userId} AND is_archived = false)::int AS "totalNotes",
        (SELECT COUNT(*) FROM notes WHERE user_id = ${userId} AND is_archived = true)::int  AS "archivedNotes",
        (SELECT COUNT(*) FROM ai_generations WHERE user_id = ${userId})::int                AS "totalAiUsage",
        (SELECT COUNT(DISTINCT nt.tag_id) FROM note_tags nt JOIN notes n ON n.id = nt.note_id WHERE n.user_id = ${userId})::int AS "uniqueTagCount"
    `;

    // ── Parallel fetch for row-returning queries (each needs its own result set) ──
    // These are fired concurrently over the connection pool — still only 1 RTT each
    const [
      recentNotes,
      topTagRows,
      recentAiGenerations,
      aiStats,
      heatmapNotes,
      categories,
      todoNotes,
    ] = await Promise.all([
      // Recently edited notes (last 7 days) — need joined tag names
      prisma.$queryRaw<any[]>`
        SELECT n.id, n.title, n.updated_at AS "updatedAt", n.is_public AS "isPublic",
               COALESCE(json_agg(json_build_object('name', t.name)) FILTER (WHERE t.name IS NOT NULL), '[]') AS tags
        FROM notes n
        LEFT JOIN note_tags nt ON nt.note_id = n.id
        LEFT JOIN tags t ON t.id = nt.tag_id
        WHERE n.user_id = ${userId} AND n.updated_at >= ${sevenDaysAgo}::timestamptz
        GROUP BY n.id
        ORDER BY n.updated_at DESC
        LIMIT 5
      `,

      // Top 10 tags with counts (replaces groupBy + separate tag name fetch)
      prisma.$queryRaw<any[]>`
        SELECT t.name, COUNT(*)::int AS count
        FROM note_tags nt
        JOIN tags t ON t.id = nt.tag_id
        JOIN notes n ON n.id = nt.note_id
        WHERE n.user_id = ${userId}
        GROUP BY t.name
        ORDER BY count DESC
        LIMIT 10
      `,

      // Recent AI generations with note titles
      prisma.$queryRaw<any[]>`
        SELECT ag.id, ag.type, ag.created_at AS "createdAt", n.title AS "noteTitle"
        FROM ai_generations ag
        LEFT JOIN notes n ON n.id = ag.note_id
        WHERE ag.user_id = ${userId}
        ORDER BY ag.created_at DESC
        LIMIT 5
      `,

      // AI stats grouped by type
      prisma.$queryRaw<any[]>`
        SELECT type, COUNT(*)::int AS count
        FROM ai_generations
        WHERE user_id = ${userId}
        GROUP BY type
      `,

      // Heatmap data — lightweight select for the last year
      prisma.$queryRaw<any[]>`
        SELECT created_at AS "createdAt", updated_at AS "updatedAt", is_public AS "isPublic"
        FROM notes
        WHERE user_id = ${userId} AND updated_at >= ${oneYearAgo}::timestamptz
      `,

      // Categories breakdown
      prisma.$queryRaw<any[]>`
        SELECT category, COUNT(*)::int AS count
        FROM notes
        WHERE user_id = ${userId} AND is_archived = false AND category IS NOT NULL
        GROUP BY category
      `,

      // Recent todos (limit 10)
      prisma.$queryRaw<any[]>`
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
        ORDER BY t.created_at DESC
        LIMIT 10
      `,
    ]);

    // ── Lightweight JS post-processing (no more DB calls) ──

    const topTags = topTagRows;

    const recentAiActivity = recentAiGenerations.map((g: any) => {
      const title = g.noteTitle || 'Untitled';
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
        acc[stat.type] = stat.count;
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

    const publicNotes = heatmapNotes.filter((n: any) => n.isPublic).length;

    res.json({
      totalNotes: counts.totalNotes,
      archivedNotes: counts.archivedNotes,
      publicNotes,
      dashboardTasks: todoNotes || [],
      recentNotes: recentNotes.map((n: any) => ({
        id: n.id,
        title: n.title,
        updatedAt: n.updatedAt,
        isPublic: n.isPublic,
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
    console.timeEnd('getInsights');
  } catch (error) {
    console.timeEnd('getInsights');
    next(error);
  }
}

export async function toggleTask(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.id;
    const { id, completed } = req.body;

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

    // Single raw SQL for scalar counts + concurrent task/note fetches
    const [countRow, overdueTasks, todayTasks, recentNotes] = await Promise.all([
      // All scalar counts in one query
      prisma.$queryRaw<any[]>`
        SELECT
          (SELECT COUNT(*) FROM todos WHERE user_id = ${userId} AND is_completed = true
            AND updated_at >= ${yesterdayStart}::timestamptz AND updated_at < ${todayStart}::timestamptz)::int AS "completedYesterday",
          (SELECT COUNT(*) FROM todos WHERE user_id = ${userId} AND is_completed = false)::int AS "totalActive"
      `.then((rows: any[]) => rows[0]),

      // Overdue tasks
      prisma.$queryRaw<any[]>`
        SELECT id, text, priority, deadline
        FROM todos
        WHERE user_id = ${userId} AND is_completed = false AND deadline IS NOT NULL AND deadline < ${todayStart}::timestamptz
        ORDER BY deadline ASC
        LIMIT 10
      `,

      // Today's tasks
      prisma.$queryRaw<any[]>`
        SELECT id, text, priority, start_time AS "startTime", end_time AS "endTime"
        FROM todos
        WHERE user_id = ${userId} AND is_completed = false
          AND deadline >= ${todayStart}::timestamptz AND deadline <= ${todayEnd}::timestamptz
        ORDER BY priority ASC
      `,

      // Recent notes
      prisma.$queryRaw<any[]>`
        SELECT id, title, updated_at AS "updatedAt"
        FROM notes
        WHERE user_id = ${userId} AND is_archived = false AND updated_at >= ${yesterdayStart}::timestamptz
        ORDER BY updated_at DESC
        LIMIT 5
      `,
    ]);

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
  return tips[Math.floor(Math.random() * tips.length)];
}

export async function getWeeklyReport(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.id;
    const now = new Date();
    const weekAgo = new Date(now);
    weekAgo.setDate(weekAgo.getDate() - 7);
    const weekAgoISO = weekAgo.toISOString();
    const nowISO = now.toISOString();

    // All counts + top tags + daily breakdown in 3 parallel raw queries
    const [countRow, topTags, dailyBreakdown] = await Promise.all([
      // Single query for ALL scalar counts
      prisma.$queryRaw<any[]>`
        SELECT
          (SELECT COUNT(*) FROM todos WHERE user_id = ${userId} AND created_at >= ${weekAgoISO}::timestamptz)::int AS "tasksCreated",
          (SELECT COUNT(*) FROM todos WHERE user_id = ${userId} AND is_completed = true AND updated_at >= ${weekAgoISO}::timestamptz)::int AS "tasksCompleted",
          (SELECT COUNT(*) FROM notes WHERE user_id = ${userId} AND created_at >= ${weekAgoISO}::timestamptz)::int AS "notesCreated",
          (SELECT COUNT(*) FROM notes WHERE user_id = ${userId} AND updated_at >= ${weekAgoISO}::timestamptz)::int AS "notesEdited",
          (SELECT COUNT(*) FROM ai_generations WHERE user_id = ${userId} AND created_at >= ${weekAgoISO}::timestamptz)::int AS "aiUsage"
      `.then((rows: any[]) => rows[0]),

      // Top tags with names resolved in a single JOIN (no separate tag resolution)
      prisma.$queryRaw<any[]>`
        SELECT t.name, COUNT(*)::int AS count
        FROM note_tags nt
        JOIN tags t ON t.id = nt.tag_id
        JOIN notes n ON n.id = nt.note_id
        WHERE n.user_id = ${userId} AND n.updated_at >= ${weekAgoISO}::timestamptz
        GROUP BY t.name
        ORDER BY count DESC
        LIMIT 5
      `,

      // Daily breakdown computed entirely in SQL (replaces fetching rows + JS filtering)
      prisma.$queryRaw<any[]>`
        SELECT
          d.day::date AS date,
          COALESCE(tc.cnt, 0)::int AS "tasksCompleted",
          COALESCE(ne.cnt, 0)::int AS "notesEdited"
        FROM generate_series(
          ${weekAgoISO}::timestamptz + interval '1 day',
          ${nowISO}::timestamptz,
          interval '1 day'
        ) AS d(day)
        LEFT JOIN (
          SELECT date_trunc('day', updated_at) AS day, COUNT(*) AS cnt
          FROM todos
          WHERE user_id = ${userId} AND is_completed = true
            AND updated_at >= ${weekAgoISO}::timestamptz AND updated_at <= ${nowISO}::timestamptz
          GROUP BY day
        ) tc ON tc.day = date_trunc('day', d.day)
        LEFT JOIN (
          SELECT date_trunc('day', updated_at) AS day, COUNT(*) AS cnt
          FROM notes
          WHERE user_id = ${userId}
            AND updated_at >= ${weekAgoISO}::timestamptz AND updated_at <= ${nowISO}::timestamptz
          GROUP BY day
        ) ne ON ne.day = date_trunc('day', d.day)
        ORDER BY d.day ASC
      `,
    ]);

    const completionRate = countRow.tasksCreated > 0 
      ? Math.round((countRow.tasksCompleted / countRow.tasksCreated) * 100) 
      : 0;

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
        date: new Date(d.date).toISOString().split('T')[0],
        tasksCompleted: d.tasksCompleted,
        notesEdited: d.notesEdited,
      })),
      topTags,
    });
  } catch (error) {
    next(error);
  }
}

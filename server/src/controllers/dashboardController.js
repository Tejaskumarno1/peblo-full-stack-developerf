import { PrismaClient } from '@prisma/client';
import {
  buildDailyActivity,
  buildYearHeatmap,
  calculateStreakStats,
  getEditsThisMonth,
} from '../utils/activityStats.js';

const prisma = new PrismaClient();

export async function getInsights(req, res, next) {
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
        include: { tags: { include: { tag: true } } },
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

    res.json({
      totalNotes,
      archivedNotes,
      publicNotes,
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
  } catch (error) {
    next(error);
  }
}

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

    // Run ALL queries in parallel for maximum speed
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
    ] = await Promise.all([
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

      // All note tags for tag cloud
      prisma.noteTag.findMany({
        where: { note: { userId } },
        include: { tag: true },
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
        where: { userId },
        select: { createdAt: true, updatedAt: true, isPublic: true },
      }),

      // Categories breakdown
      prisma.note.groupBy({
        by: ['category'],
        where: { userId, isArchived: false, category: { not: null } },
        _count: { id: true },
      }),
    ]);

    // Process tag counts
    const tagCounts = {};
    allNoteTags.forEach((nt) => {
      tagCounts[nt.tag.name] = (tagCounts[nt.tag.name] || 0) + 1;
    });

    const uniqueTagCount = Object.keys(tagCounts).length;

    const topTags = Object.entries(tagCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([name, count]) => ({ name, count }));

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

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

    // Total notes count
    const totalNotes = await prisma.note.count({
      where: { userId, isArchived: false }
    });

    // Archived notes count
    const archivedNotes = await prisma.note.count({
      where: { userId, isArchived: true }
    });

    // Recently edited notes (last 7 days)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const recentNotes = await prisma.note.findMany({
      where: {
        userId,
        updatedAt: { gte: sevenDaysAgo }
      },
      include: { tags: { include: { tag: true } } },
      orderBy: { updatedAt: 'desc' },
      take: 5
    });

    // Most used tags
    const allNoteTags = await prisma.noteTag.findMany({
      where: { note: { userId } },
      include: { tag: true }
    });

    const tagCounts = {};
    allNoteTags.forEach(nt => {
      tagCounts[nt.tag.name] = (tagCounts[nt.tag.name] || 0) + 1;
    });

    const uniqueTagCount = Object.keys(tagCounts).length;

    const topTags = Object.entries(tagCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([name, count]) => ({ name, count }));

    const recentAiGenerations = await prisma.aiGeneration.findMany({
      where: { userId },
      include: { note: { select: { title: true } } },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });

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

    // AI usage statistics
    const aiStats = await prisma.aiGeneration.groupBy({
      by: ['type'],
      where: { userId },
      _count: { id: true }
    });

    const totalAiUsage = await prisma.aiGeneration.count({ where: { userId } });

    const aiUsage = {
      total: totalAiUsage,
      byType: aiStats.reduce((acc, stat) => {
        acc[stat.type] = stat._count.id;
        return acc;
      }, {})
    };

    // Activity heatmap & streak (from all notes)
    const allNotes = await prisma.note.findMany({
      where: { userId },
      select: { createdAt: true, updatedAt: true, isPublic: true },
    });

    const dayMap = buildDailyActivity(allNotes);
    const activityHeatmap = buildYearHeatmap(dayMap);
    const streakStats = calculateStreakStats(dayMap);
    const editsThisMonth = getEditsThisMonth(dayMap);

    const publicNotes = allNotes.filter((n) => n.isPublic).length;

    // Categories breakdown
    const categories = await prisma.note.groupBy({
      by: ['category'],
      where: { userId, isArchived: false, category: { not: null } },
      _count: { id: true }
    });

    res.json({
      totalNotes,
      archivedNotes,
      publicNotes,
      recentNotes: recentNotes.map(n => ({
        id: n.id,
        title: n.title,
        updatedAt: n.updatedAt,
        isPublic: n.isPublic,
        tags: n.tags.map(nt => nt.tag.name)
      })),
      topTags,
      uniqueTagCount,
      recentAiActivity,
      aiUsage,
      activityHeatmap,
      streakStats,
      editsThisMonth,
      categories: categories.map(c => ({ name: c.category || 'Uncategorized', count: c._count.id }))
    });
  } catch (error) {
    next(error);
  }
}

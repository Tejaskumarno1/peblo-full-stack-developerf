import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const user = await prisma.user.findFirst();
  if (!user) {
    console.log("No user found");
    return;
  }
  const userId = user.id;
  
  console.time('dashboard-queries');
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
    prisma.note.count({ where: { userId, isArchived: false } }),
    prisma.note.count({ where: { userId, isArchived: true } }),
    prisma.note.findMany({
      where: { userId, updatedAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } },
      select: { id: true, title: true, updatedAt: true, isPublic: true, tags: { include: { tag: true } } },
      orderBy: { updatedAt: 'desc' },
      take: 5,
    }),
    prisma.noteTag.groupBy({
      by: ['tagId'], where: { note: { userId } }, _count: { tagId: true }, orderBy: { _count: { tagId: 'desc' } }, take: 10,
    }),
    prisma.aiGeneration.findMany({
      where: { userId }, include: { note: { select: { title: true } } }, orderBy: { createdAt: 'desc' }, take: 5,
    }),
    prisma.aiGeneration.groupBy({
      by: ['type'], where: { userId }, _count: { id: true },
    }),
    prisma.aiGeneration.count({ where: { userId } }),
    prisma.note.findMany({
      where: { userId, updatedAt: { gte: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000) } },
      select: { createdAt: true, updatedAt: true, isPublic: true },
    }),
    prisma.note.groupBy({
      by: ['category'], where: { userId, isArchived: false, category: { not: null } }, _count: { id: true },
    }),
    prisma.todo.findMany({
      where: { userId }, include: { note: { select: { id: true, title: true } } }, orderBy: { createdAt: 'desc' }, take: 10
    }),
  ]);
  console.timeEnd('dashboard-queries');
  console.log("Success");
}

main().then(() => prisma.$disconnect());

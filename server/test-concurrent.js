import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const user = await prisma.user.findFirst();
  const userId = user.id;

  console.time('Total Concurrent');
  
  const now = new Date();
  const weekAgo = new Date(now); weekAgo.setDate(weekAgo.getDate() - 7);
  const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  const threeDaysLater = new Date(todayEnd); threeDaysLater.setDate(threeDaysLater.getDate() + 3);

  const p1 = prisma.$transaction([
    prisma.note.count({ where: { userId, isArchived: false } }),
    prisma.note.findMany({ take: 5 })
  ]);

  const p2 = prisma.$transaction([
    prisma.todo.findMany({ take: 10 }),
    prisma.todo.findMany({ take: 10 })
  ]);

  const p3 = prisma.$transaction([
    prisma.todo.count(),
    prisma.note.findMany({ take: 5 })
  ]);

  const p4 = prisma.$transaction([
    prisma.todo.findMany({ take: 5 }),
    prisma.note.count()
  ]);

  await Promise.all([p1, p2, p3, p4]);
  
  console.timeEnd('Total Concurrent');
}
main().then(() => prisma.$disconnect());

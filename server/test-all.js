import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const user = await prisma.user.findFirst();
  const userId = user.id;

  console.time('Total');

  console.time('insights');
  // ... omitting body to just test
  await prisma.$transaction([
    prisma.note.count({ where: { userId, isArchived: false } }),
    prisma.note.count({ where: { userId, isArchived: true } }),
    prisma.note.findMany({ take: 5 })
  ]);
  console.timeEnd('insights');

  console.time('today');
  await prisma.$transaction([
    prisma.todo.findMany({ take: 10 }),
    prisma.todo.findMany({ take: 10 }),
    prisma.todo.findMany({ take: 10 })
  ]);
  console.timeEnd('today');

  console.time('briefing');
  await prisma.$transaction([
    prisma.todo.findMany({ take: 10 }),
    prisma.todo.findMany({ take: 10 }),
    prisma.note.findMany({ take: 5 }),
    prisma.todo.count(),
    prisma.todo.count()
  ]);
  console.timeEnd('briefing');

  console.time('weekly');
  await prisma.$transaction([
    prisma.todo.findMany({ take: 10 }),
    prisma.note.findMany({ take: 10 })
  ]);
  console.timeEnd('weekly');

  console.timeEnd('Total');
}
main().then(() => prisma.$disconnect());

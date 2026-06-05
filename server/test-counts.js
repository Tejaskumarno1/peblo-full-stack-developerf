import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const user = await prisma.user.findFirst();
  const notesCount = await prisma.note.count({ where: { userId: user.id } });
  const todosCount = await prisma.todo.count({ where: { userId: user.id } });
  console.log('Notes:', notesCount, 'Todos:', todosCount);
}
main().then(() => prisma.$disconnect());

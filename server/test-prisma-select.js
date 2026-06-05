import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  try {
    await prisma.note.findMany({
      select: {
        id: true,
        tags: { include: { tag: true } }
      }
    });
    console.log("Success");
  } catch (err) {
    console.log("Error:", err.message);
  }
}
main().then(() => prisma.$disconnect());

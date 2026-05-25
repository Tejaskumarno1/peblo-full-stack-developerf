import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function run() {
  await prisma.user.create({ data: { name: 'Test', email: 'test' + Date.now() + '@peblo.dev', passwordHash: 'hash' } });
  console.log('Inserted');
}
run();

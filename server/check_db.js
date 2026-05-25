import { PrismaClient } from '@prisma/client';

async function check() {
  process.env.DATABASE_URL = "file:./dev.db";
  const p1 = new PrismaClient();
  try {
    const c1 = await p1.user.count();
    console.log("prisma/dev.db users:", c1);
  } catch(e) { console.log("prisma/dev.db error:", e.message); }

  process.env.DATABASE_URL = "file:./prisma/dev.db";
  const p2 = new PrismaClient();
  try {
    const c2 = await p2.user.count();
    console.log("prisma/prisma/dev.db users:", c2);
  } catch(e) { console.log("prisma/prisma/dev.db error:", e.message); }
}
check();

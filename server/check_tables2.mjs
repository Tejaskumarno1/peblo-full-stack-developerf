import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function check() {
  try {
    const user = await prisma.user.findFirst();
    console.log("Database works, user found:", user ? user.email : "none");
  } catch(e) {
    console.log("Error:", e.message);
  }
}
check();

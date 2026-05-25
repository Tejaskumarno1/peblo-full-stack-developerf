import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
console.log(prisma._engineConfig?.env?.DATABASE_URL || 'default connection');

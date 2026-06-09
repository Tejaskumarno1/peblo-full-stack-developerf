import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Automatically update database schema with soft-delete fields on start if missing
(async () => {
  try {
    const columns = await prisma.$queryRawUnsafe<any[]>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'notes' AND column_name = 'is_deleted'`
    );
    if (!columns || columns.length === 0) {
      console.log('Soft-delete columns are missing in Supabase notes table. Applying schema patch...');
      await prisma.$executeRawUnsafe(`
        ALTER TABLE "notes" ADD COLUMN IF NOT EXISTS "is_deleted" BOOLEAN DEFAULT false;
      `);
      await prisma.$executeRawUnsafe(`
        ALTER TABLE "notes" ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMP WITH TIME ZONE;
      `);
      await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS "notes_user_id_is_deleted_idx" ON "notes"("user_id", "is_deleted");
      `);
      console.log('Successfully applied soft-delete schema updates to Supabase!');
    }
  } catch (err) {
    console.error('Failed to run auto-schema updates:', err);
  }
})();

export default prisma;

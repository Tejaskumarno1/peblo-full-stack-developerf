import type { PrismaClient as PrismaClientType } from '../generated/prisma/index.js';
import { readFileSync, readdirSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

// The database is a hosted Postgres instance (e.g. a free Supabase/Neon project), shared
// by every user. DATABASE_URL must be set — in the Electron app's own .env next to the
// packaged server, or in the hosting platform's environment once this is deployed.
if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is not set. Point it at your Postgres connection string ' +
    '(e.g. from Supabase: Project Settings → Database → Connection string).'
  );
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// The generated client lives in server/generated/prisma. This file runs either from
// server/src (dev, via tsx) or from dist/server (built app), so try both locations.
function loadPrismaClient(): typeof PrismaClientType {
  const candidates = [
    path.join(__dirname, '../generated/prisma'),
    path.join(__dirname, '../../server/generated/prisma'),
  ];
  const dir = candidates.find((d) => existsSync(path.join(d, 'index.js')));
  if (!dir) throw new Error('Prisma client not generated. Run: npx prisma generate --schema server/prisma/schema.prisma');
  return require(dir).PrismaClient;
}

const PrismaClient = loadPrismaClient();
const prisma = new PrismaClient();

function findSqlDir(): string {
  const candidates = [
    process.env.PEBLO_SQL_DIR,
    path.join(__dirname, '../prisma/sql'),
    path.join(__dirname, '../../server/prisma/sql'),
  ].filter(Boolean) as string[];
  const dir = candidates.find((d) => existsSync(d));
  if (!dir) throw new Error(`Could not find SQL migrations folder (looked in ${candidates.join(', ')})`);
  return dir;
}

/**
 * Applies any pending SQL migrations (prisma/sql/NNN_name.sql) in order.
 * The applied version is tracked in its own tiny table (`_peblo_migrations`) rather than
 * SQLite's `PRAGMA user_version`, since Postgres has no equivalent pragma.
 */
async function migrate() {
  await prisma.$executeRawUnsafe(
    'CREATE TABLE IF NOT EXISTS "_peblo_migrations" ("version" INTEGER PRIMARY KEY, "name" TEXT NOT NULL, "applied_at" TIMESTAMPTZ NOT NULL DEFAULT now())'
  );
  const applied = await prisma.$queryRawUnsafe<{ version: number }[]>('SELECT version FROM "_peblo_migrations"');
  const current = applied.reduce((max, row) => Math.max(max, Number(row.version)), 0);

  const dir = findSqlDir();
  const files = readdirSync(dir)
    .filter((f) => /^\d+_.*\.sql$/.test(f))
    .sort();

  for (const file of files) {
    const version = parseInt(file.split('_')[0], 10);
    if (version <= current) continue;

    const sql = readFileSync(path.join(dir, file), 'utf8');
    const statements = sql
      .split(/;\s*(?:\r?\n|$)/)
      .map((s) => s.replace(/^\s*--.*$/gm, '').trim())
      .filter(Boolean);

    await prisma.$transaction(async (tx) => {
      for (const stmt of statements) {
        await tx.$executeRawUnsafe(stmt);
      }
      await tx.$executeRawUnsafe(`INSERT INTO "_peblo_migrations" (version, name) VALUES (${version}, '${file.replace(/'/g, "''")}')`);
    });
    console.log(`[db] applied migration ${file}`);
  }
}

let ready: Promise<void> | null = null;

/** Applies any pending migrations to the shared Postgres database. Call once at startup. */
export function initDatabase(): Promise<void> {
  if (!ready) {
    ready = migrate();
  }
  return ready;
}

export default prisma;

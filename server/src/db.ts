import type { PrismaClient as PrismaClientType } from '../generated/prisma/index.js';
import { readFileSync, readdirSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

// The desktop shell (Electron) sets DATABASE_URL to a SQLite file inside the
// user's app-data folder before this module loads. Fall back to a local file
// for `npm run dev` (peblo-dev.db in the project folder).
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = 'file:' + path.resolve('peblo-dev.db').replace(/\\/g, '/');
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

export const LOCAL_USER_ID = 'local-user';

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
 * The applied version is tracked with SQLite's built-in `PRAGMA user_version`,
 * so no separate migrations table or Prisma migrate engine is needed at runtime.
 */
async function migrate() {
  const [{ user_version: current }] = await prisma.$queryRawUnsafe<any[]>('PRAGMA user_version');
  const dir = findSqlDir();
  const files = readdirSync(dir)
    .filter((f) => /^\d+_.*\.sql$/.test(f))
    .sort();

  for (const file of files) {
    const version = parseInt(file.split('_')[0], 10);
    if (version <= Number(current)) continue;

    const sql = readFileSync(path.join(dir, file), 'utf8');
    const statements = sql
      .split(/;\s*(?:\r?\n|$)/)
      .map((s) => s.replace(/^\s*--.*$/gm, '').trim())
      .filter(Boolean);

    await prisma.$transaction(async (tx) => {
      for (const stmt of statements) {
        await tx.$executeRawUnsafe(stmt);
      }
      await tx.$executeRawUnsafe(`PRAGMA user_version = ${version}`);
    });
    console.log(`[db] applied migration ${file}`);
  }
}

let ready: Promise<void> | null = null;

/** Creates/updates the local database and makes sure the single local user exists. */
export function initDatabase(): Promise<void> {
  if (!ready) {
    ready = (async () => {
      await prisma.$executeRawUnsafe('PRAGMA foreign_keys = ON');
      await prisma.$queryRawUnsafe('PRAGMA journal_mode = WAL');
      await migrate();
      await prisma.user.upsert({
        where: { id: LOCAL_USER_ID },
        update: {},
        create: { id: LOCAL_USER_ID, name: 'You' },
      });
    })();
  }
  return ready;
}

export default prisma;

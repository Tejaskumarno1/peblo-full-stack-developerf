import type { PrismaClient as PrismaClientType } from '../generated/prisma/index.js';
import { readFileSync, readdirSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

// The database is a MySQL server (local MySQL 8 while developing, a hosted one in production),
// shared by every user. DATABASE_URL must be set — in the Electron app's own .env next to the
// packaged server, or in the hosting platform's environment once this is deployed.
if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is not set. Point it at your MySQL connection string ' +
    '(e.g. mysql://user:password@localhost:3306/peblo).'
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

/** MySQL "it is already there" errors: a statement that was applied before a crash can safely be skipped on the next run. */
const ALREADY_DONE = [1050, 1060, 1061, 1826, 1022, 1068, 1091];
function alreadyDone(err: any): boolean {
  const code = Number(err?.meta?.code ?? err?.code?.match?.(/\d+/)?.[0] ?? NaN);
  if (ALREADY_DONE.includes(code)) return true;
  const msg = String(err?.message || '');
  return /Duplicate column name|Duplicate key name|already exists|Duplicate foreign key|Can't DROP|check that column\/key exists/i.test(msg);
}

/**
 * Applies any pending SQL migrations (NNN_name.sql in `dir`) in order.
 * The applied version is tracked in its own tiny table (`_peblo_migrations`).
 * MySQL commits each DDL statement on its own, so a migration file is not one transaction: the version row is
 * written last, once every statement has run. Two things keep that safe:
 *  - a named lock (GET_LOCK) so only one app migrates at a time; the others wait, then find nothing left to do;
 *  - statements that fail because the change is already there (a previous run died halfway) are skipped, so the
 *    file can simply be run again.
 * Statements are split on ";" + newline: write one statement per block, and no stored procedures or triggers.
 */
export async function runMigrations(dir: string = findSqlDir(), lockSeconds = 120): Promise<void> {
  await prisma.$executeRawUnsafe(
    'CREATE TABLE IF NOT EXISTS `_peblo_migrations` (`version` INT NOT NULL PRIMARY KEY, `name` VARCHAR(191) NOT NULL, `applied_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3))'
  );
  const files = readdirSync(dir)
    .filter((f) => /^\d+_.*\.sql$/.test(f))
    .sort();

  // One pinned connection holds the lock for the whole run (GET_LOCK belongs to a connection, not to the pool).
  await prisma.$transaction(async (tx: any) => {
    const got: any[] = await tx.$queryRawUnsafe(`SELECT GET_LOCK('peblo_migrate', ${Math.max(1, Math.floor(lockSeconds))}) AS got`);
    if (Number(got?.[0]?.got) !== 1) throw new Error('Another Peblo is updating the database and did not finish in time. Try starting again in a minute.');
    try {
      // Read what is applied only now, after the lock: a Peblo that was ahead of us may have done the work already.
      const applied: { version: number }[] = await tx.$queryRawUnsafe('SELECT version FROM `_peblo_migrations`');
      const current = applied.reduce((max, row) => Math.max(max, Number(row.version)), 0);
      for (const file of files) {
        const version = parseInt(file.split('_')[0], 10);
        if (version <= current) continue;
        const sql = readFileSync(path.join(dir, file), 'utf8');
        const statements = sql
          .split(/;\s*(?:\r?\n|$)/)
          .map((st) => st.replace(/^\s*--.*$/gm, '').trim())
          .filter(Boolean);
        for (const stmt of statements) {
          try { await tx.$executeRawUnsafe(stmt); }
          catch (err) { if (!alreadyDone(err)) throw err; console.log(`[db] ${file}: skipped a step that was already applied`); }
        }
        await tx.$executeRawUnsafe(`INSERT IGNORE INTO \`_peblo_migrations\` (version, name) VALUES (${version}, '${file.replace(/'/g, "''")}')`);
        console.log(`[db] applied migration ${file}`);
      }
    } finally {
      await tx.$queryRawUnsafe("SELECT RELEASE_LOCK('peblo_migrate')").catch(() => {});
    }
  }, { timeout: (lockSeconds + 600) * 1000, maxWait: 30_000 });
}

const migrate = () => runMigrations();

let ready: Promise<void> | null = null;

/** Applies any pending migrations to the shared MySQL database. Call once at startup. */
export function initDatabase(): Promise<void> {
  if (!ready) {
    ready = migrate();
  }
  return ready;
}

export default prisma;

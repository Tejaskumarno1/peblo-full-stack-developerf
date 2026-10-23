import type { PrismaClient as PrismaClientType } from '../generated/prisma/index.js';
import { readFileSync, readdirSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

// The database is Postgres (Supabase), shared by every user. DATABASE_URL must be set: in the Electron app's own .env
// next to the packaged server, or in the hosting platform's environment once this is deployed.
if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is not set. Point it at your Postgres connection string ' +
    '(Supabase: Connect > Session pooler, e.g. postgresql://postgres.<ref>:<password>@<host>:5432/postgres).'
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
/**
 * Supabase's session pooler only allows ~15 connections in total, and Prisma opens (CPUs x 2 + 1) per process by default,
 * so a hosted copy plus the desktop app could run it dry (EMAXCONNSESSION). Keep each process to a few; PEBLO_DB_CONNECTIONS changes it,
 * and a connection_limit already in DATABASE_URL wins.
 */
function withPool(url: string): string {
  if (!url || /[?&]connection_limit=/.test(url)) return url;
  const n = Math.max(1, Math.min(20, Number(process.env.PEBLO_DB_CONNECTIONS) || 5));
  return url + (url.includes('?') ? '&' : '?') + 'connection_limit=' + n + '&pool_timeout=30';
}
const prisma = new PrismaClient({ datasources: { db: { url: withPool(process.env.DATABASE_URL || '') } } });

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

/** The schema named in DATABASE_URL (?schema=name), or null for the default one. */
function schemaOf(url: string): string | null {
  const m = /[?&]schema=([A-Za-z0-9_]+)/.exec(url);
  return m ? m[1] : null;
}

/**
 * Applies any pending SQL migrations (NNN_name.sql in `dir`) in order.
 * The applied version is tracked in its own tiny table (_peblo_migrations).
 * Postgres can roll DDL back, so each migration file runs in one transaction together with its version row.
 * A transaction-level advisory lock means only one app migrates at a time (the others wait, then find nothing
 * left to do); it also works through Supabase's pooler, which a session-level lock would not.
 * Statements are split on ";" + newline: write one statement per block, and no functions or triggers.
 */
export async function runMigrations(dir: string = findSqlDir(), lockSeconds = 120): Promise<void> {
  const schema = schemaOf(process.env.DATABASE_URL || '');
  if (schema) await prisma.$executeRawUnsafe(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
  await prisma.$transaction(async (tx: any) => {
    await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = '${Math.max(1, Math.floor(lockSeconds))}s'`);
    await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(7264001)');
    await tx.$executeRawUnsafe('CREATE TABLE IF NOT EXISTS _peblo_migrations (version INTEGER NOT NULL PRIMARY KEY, name TEXT NOT NULL, applied_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP)');
    const files = readdirSync(dir).filter((f) => /^\d+_.*\.sql$/.test(f)).sort();
    const applied: { version: number }[] = await tx.$queryRawUnsafe('SELECT version FROM _peblo_migrations');
    const current = applied.reduce((max, row) => Math.max(max, Number(row.version)), 0);
    for (const file of files) {
      const version = parseInt(file.split('_')[0], 10);
      if (version <= current) continue;
      const sql = readFileSync(path.join(dir, file), 'utf8');
      const statements = sql
        .split(/;\s*(?:\r?\n|$)/)
        .map((st) => st.replace(/^\s*--.*$/gm, '').trim())
        .filter(Boolean);
      // Extensions go in the schema Peblo uses, so CITEXT is found even when DATABASE_URL names its own schema (?schema=peblo)
      for (const stmt of statements) await tx.$executeRawUnsafe(schema ? stmt.replace(/WITH SCHEMA public\b/i, `WITH SCHEMA "${schema}"`) : stmt);
      await tx.$executeRawUnsafe(`INSERT INTO _peblo_migrations (version, name) VALUES (${version}, '${file.replace(/'/g, "''")}') ON CONFLICT DO NOTHING`);
      console.log(`[db] applied migration ${file}`);
    }
  }, { timeout: (lockSeconds + 600) * 1000, maxWait: 30_000 });
}

const migrate = () => runMigrations();

let ready: Promise<void> | null = null;

/** Applies any pending migrations to the shared Postgres database. Call once at startup. */
export function initDatabase(): Promise<void> {
  if (!ready) {
    ready = migrate();
  }
  return ready;
}

export default prisma;

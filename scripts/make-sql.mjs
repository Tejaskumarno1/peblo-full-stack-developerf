// Prints the SQL a NEW migration needs: the difference between your development database and schema.prisma.
// It never overwrites an existing migration (001_init.sql is frozen: apps in the field already ran it).
// Usage:  node scripts/make-sql.mjs > server/prisma/sql/00N_what_changed.sql   then review the file.
// Tips: one statement per block ending in ";" + newline; no procedures or triggers (the runner splits on ";").
import { execSync } from 'node:child_process';

if (!process.env.DATABASE_URL) {
  console.error('Set DATABASE_URL to your development database first (the one that has every migration applied).');
  process.exit(1);
}
const raw = execSync(
  'npx prisma migrate diff --from-url "' + process.env.DATABASE_URL + '" --to-schema-datamodel server/prisma/schema.prisma --script',
  { encoding: 'utf8', maxBuffer: 1 << 26 }
);
const sql = raw
  .split('\n')
  .map((line) => (/\b(TEXT|LONGTEXT)\b/.test(line) ? line.replace(/DEFAULT ('(?:[^']|'')*')/, 'DEFAULT ($1)') : line))
  .join('\n')
  .replace(/(`settings` JSON NOT NULL)/, "$1 DEFAULT ('{}')")
  .replace(/(`tags` JSON NOT NULL)/, "$1 DEFAULT ('[]')");
process.stdout.write(sql);

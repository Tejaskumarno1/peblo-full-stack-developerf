// Regenerates server/prisma/sql/001_init.sql from schema.prisma for MySQL.
// Prisma can't express a literal default on TEXT/JSON columns in MySQL, so those defaults are
// rewritten as expression defaults — DEFAULT ('x') — which MySQL 8 accepts.
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const raw = execSync(
  'npx prisma migrate diff --from-empty --to-schema-datamodel server/prisma/schema.prisma --script',
  { encoding: 'utf8', maxBuffer: 1 << 26 }
);

const sql = raw
  .split('\n')
  .map((line) => {
    if (/\b(TEXT|LONGTEXT)\b/.test(line)) return line.replace(/DEFAULT ('(?:[^']|'')*')/, 'DEFAULT ($1)');
    return line;
  })
  .join('\n')
  // Json columns: the schema carries no default, so add the empty value here.
  .replace(/(`settings` JSON NOT NULL)/, "$1 DEFAULT ('{}')")
  .replace(/(`tags` JSON NOT NULL)/, "$1 DEFAULT ('[]')");

writeFileSync('server/prisma/sql/001_init.sql', sql);
console.log('wrote server/prisma/sql/001_init.sql');

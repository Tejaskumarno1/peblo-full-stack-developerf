#!/usr/bin/env node
// Converts text stored before encryption (and text under a retired key) to the current PEBLO_DATA_KEY.
//   node scripts/encrypt-existing.mjs --dry-run     only counts what would change (writes nothing)
//   node scripts/encrypt-existing.mjs               converts, in batches of 100 rows, safe to repeat and to run while the app is serving
// Needs: DATABASE_URL (server/.env is read), PEBLO_DATA_KEY (and PEBLO_DATA_KEY_OLD while rotating), and a built server (npm run build:server).
// Take a database backup before the first real run. Prints counts only, never any content.
import path from 'path';
import { pathToFileURL } from 'url';
import { fileURLToPath } from 'url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(REPO, process.env.PEBLO_SERVER_DIST || 'dist', 'server');
const dryRun = process.argv.includes('--dry-run');
await import(pathToFileURL(path.join(dist, 'env.js')).href);
const url = process.env.DATABASE_URL || '';
const where = (() => { try { const u = new URL(url); return `${u.hostname}${u.port ? ':' + u.port : ''}${u.pathname}`; } catch { return '(DATABASE_URL not set)'; } })();
console.log(`${dryRun ? 'DRY RUN against' : 'Converting'} ${where}`);
const { convertExisting } = await import(pathToFileURL(path.join(dist, 'services', 'encryptExisting.js')).href);
const { initDataCrypto } = await import(pathToFileURL(path.join(dist, 'dataCrypto.js')).href);
const { default: prisma } = await import(pathToFileURL(path.join(dist, 'db.js')).href);
let code = 0;
try {
  await initDataCrypto(prisma);
  const r = await convertExisting({ dryRun, log: (m) => console.log(m) });
  console.log('\ntable                 present  needing  plaintext  converted  re-keyed  unreadable  changed-meanwhile');
  for (const t of r.tables) console.log(`${t.table.padEnd(21)} ${String(t.present).padEnd(8)} ${String(t.needing).padStart(7)} ${String(t.plaintext).padStart(10)} ${String(t.converted).padStart(10)} ${String(t.rekeyed).padStart(9)} ${String(t.unreadable).padStart(11)} ${String(t.raced).padStart(18)}`);
  if (r.busy) { console.log('\nStopped early: another instance holds the conversion lock.'); code = 3; }
  if (r.tables.some((t) => t.unreadable)) code = code || 4;
} catch (e) {
  console.error('Failed:', e.message);
  code = 1;
}
await prisma.$disconnect();
process.exit(code);

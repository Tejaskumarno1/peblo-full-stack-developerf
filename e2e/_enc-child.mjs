// A second Peblo server process for e2e/encryption.mjs: its own environment (PEBLO_DATA_KEY ...) and database.
// Env: ENC_CHILD_DB (a connection string whose database name contains peblo_test), PEBLO_SERVER_DIST (default dist-enc). Prints "PORT=<n>".
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import { pathToFileURL, fileURLToPath } from 'url';
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const parsed = dotenv.parse(fs.readFileSync(path.join(REPO, 'server', '.env'), 'utf8'));
for (const [k, v] of Object.entries(parsed)) if (!(k in process.env)) process.env[k] = v;
const url = process.env.ENC_CHILD_DB || '';
if (!/peblo_test/.test(url)) { console.error('refusing to run: not a peblo_test database'); process.exit(2); }
process.env.DATABASE_URL = url;
process.env.PEBLO_SQL_DIR = path.join(REPO, 'server', 'prisma', 'sql');
process.env.SIGNUP_RATE_MAX = '1000';
process.env.API_RATE_MAX = '1000000';
delete process.env.OPENAI_API_KEY; delete process.env.GEMINI_API_KEY; delete process.env.GEMINI_API_KEYS;
const { startServer } = await import(pathToFileURL(path.join(REPO, process.env.PEBLO_SERVER_DIST || 'dist-enc', 'server', 'index.js')).href);
const { port } = await startServer({ port: 0 });
console.log('PORT=' + port);
process.stdin.resume();
process.stdin.on('end', () => process.exit(0));

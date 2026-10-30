// Transpiles server/src to ./dist-enc/server (NOT dist) so e2e/encryption.mjs can test the current source: PEBLO_SERVER_DIST=dist-enc
import { build } from 'esbuild';
import { readdirSync, statSync, rmSync } from 'fs';
import path from 'path';
const collect = (d) => readdirSync(d).flatMap((n) => { const f = path.join(d, n); return statSync(f).isDirectory() ? collect(f) : f.endsWith('.ts') && !f.endsWith('.d.ts') ? [f] : []; });
rmSync('dist-enc', { recursive: true, force: true });
await build({ entryPoints: collect('server/src'), outdir: 'dist-enc/server', outbase: 'server/src', platform: 'node', format: 'esm', target: 'node20', logLevel: 'warning' });

// Transpiles server/src to ./dist-xfer/server (NOT dist) so transfer-edge.mjs can test unbuilt source: PEBLO_SERVER_DIST=dist-xfer
import { build } from 'esbuild';
import { readdirSync, statSync, rmSync } from 'fs';
import path from 'path';
const collect = (d) => readdirSync(d).flatMap((n) => { const f = path.join(d, n); return statSync(f).isDirectory() ? collect(f) : f.endsWith('.ts') && !f.endsWith('.d.ts') ? [f] : []; });
rmSync('dist-xfer', { recursive: true, force: true });
await build({ entryPoints: collect('server/src'), outdir: 'dist-xfer/server', outbase: 'server/src', platform: 'node', format: 'esm', target: 'node20', logLevel: 'warning' });

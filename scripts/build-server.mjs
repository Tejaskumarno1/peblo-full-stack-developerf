// Compiles server/src/**/*.ts to dist/server as plain ES modules (no bundling —
// dependencies are loaded from node_modules at runtime).
import { build } from 'esbuild';
import { readdirSync, statSync, rmSync } from 'fs';
import path from 'path';

const srcDir = 'server/src';
const outDir = 'dist/server';

function collect(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return collect(full);
    return full.endsWith('.ts') && !full.endsWith('.d.ts') ? [full] : [];
  });
}

rmSync(outDir, { recursive: true, force: true });
await build({
  entryPoints: collect(srcDir),
  outdir: outDir,
  outbase: srcDir,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  sourcemap: true,
  logLevel: 'info',
});

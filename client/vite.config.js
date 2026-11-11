import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync, existsSync, mkdirSync, copyFileSync, createReadStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The app's version number, shown in Settings -> About.
const appVersion = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

// The in-browser speech engine (onnxruntime-web, WebAssembly) is served from this site at /ort/ so it works offline and under the page's security policy.
const ORT_FILES = ['ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm'];
const here = path.dirname(fileURLToPath(import.meta.url));
const ortDir = [path.join(here, 'node_modules/onnxruntime-web/dist'), path.join(here, '../node_modules/onnxruntime-web/dist')].find((d) => existsSync(d));
const ortAssets = () => ({
  name: 'peblo-ort-assets',
  configureServer(server) {
    server.middlewares.use('/ort/', (req, res, next) => {
      const f = path.basename((req.url || '').split('?')[0]);
      if (!ortDir || !ORT_FILES.includes(f)) return next();
      res.setHeader('Content-Type', f.endsWith('.wasm') ? 'application/wasm' : 'text/javascript');
      createReadStream(path.join(ortDir, f)).pipe(res);
    });
  },
  writeBundle(opts) {
    if (!ortDir) return;
    const out = path.join(opts.dir || path.join(here, 'dist'), 'ort');
    mkdirSync(out, { recursive: true });
    for (const f of ORT_FILES) copyFileSync(path.join(ortDir, f), path.join(out, f));
  },
});

export default defineConfig({
  plugins: [react(), ortAssets()],
  define: { __APP_VERSION__: JSON.stringify(appVersion) },
  server: {
    port: 5173,
    strictPort: false,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/socket.io': {
        target: 'http://localhost:3001',
        ws: true,
      },
    },
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
      'Cross-Origin-Embedder-Policy': 'unsafe-none',
    },
  },
  build: {
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-router-dom'],
          ui: ['lucide-react', 'framer-motion'],
          utils: ['marked', 'axios'],
          pdf: ['html2pdf.js']
        }
      }
    }
  }
});

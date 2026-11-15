// Phase 0 gate: route matrix. Lists every route the server mounts and calls each one with NO sign-in.
// A route that answers anything but 401/403 (or 404 for unknown ids) must be on the PUBLIC list below, on purpose.
// A new route that is open by accident fails this file; a new public route has to be added here by a person.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { boot, REPO } from './lib.mjs';
const b = await boot();
const ok = (c, m, x) => b.check(m, !!c, x);
const PUBLIC = [
  /^\/api\/auth\/(login|signup|forgot-password|reset-password|verify-email|resend-verification|refresh|config)/,
  /^\/api\/public\//, /^\/api\/share\/(public|by-token|link)\//, /^\/api\/oauth\//, /^\/api\/media\/[^/]+$/, /^\/api\/files\/[^/]+$/,
  /^\/api\/health/, /^\/api\/config$/, /^\/api\/media\/[^/]+\/text$/, // media by unguessable id: Phase 2 authorizes team files /^\/api\/collab\/(ticket-public|guest)/,
];
try {
  const { createApp } = await import(pathToFileURL(path.join(REPO, process.env.PEBLO_SERVER_DIST || 'dist', 'server', 'index.js')).href);
  const app = createApp(undefined);
  const mountOf = (layer) => (layer.regexp?.fast_slash ? '' : layer.regexp.source.replace('^\\/', '/').replace(/\\\/\?\(\?=\\\/\|\$\)$/, '').replace(/\\\//g, '/').replace(/\$$/, ''));
  const routes = [];
  const walk = (stack, base) => { for (const l of stack) { if (l.route) for (const m of Object.keys(l.route.methods)) routes.push([m.toUpperCase(), base + (typeof l.route.path === 'string' ? l.route.path : '')]); else if (l.name === 'router' && l.handle?.stack) walk(l.handle.stack, base + mountOf(l)); } };
  walk(app._router.stack, '');
  const api = routes.filter(([, p]) => p.startsWith('/api'));
  ok(api.length > 100, `found ${api.length} /api routes to check`, api.length);
  const open = [];
  for (const [method, p] of api) {
    const url = b.base + p.replace(/:[A-Za-z_]+\??/g, 'x');
    const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: method === 'GET' || method === 'DELETE' ? undefined : '{}' }).catch(() => null);
    if (!res) { open.push(`${method} ${p} (no answer)`); continue; }
    if ([401, 403].includes(res.status)) continue;
    if (PUBLIC.some((re) => re.test(p))) continue;
    open.push(`${method} ${p} -> ${res.status}`);
  }
  ok(open.length === 0, 'every route refuses a caller with no sign-in unless it is on the public list', open.slice(0, 15).join(' | '));
} catch (e) { ok(false, 'route matrix ran', e?.stack || e); }
await b.finish();
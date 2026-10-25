import './env.js';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { existsSync } from 'fs';
import { createServer, Server } from 'http';
import { AddressInfo } from 'net';
import { Server as SocketIOServer } from 'socket.io';
import { pathToFileURL } from 'url';

import prisma, { initDatabase } from './db.js';
import authRoutes from './routes/auth.js';
import profileRoutes from './routes/profile.js';
import notesRoutes from './routes/notes.js';
import tagsRoutes from './routes/tags.js';
import tokensRoutes from './routes/tokens.js';
import aiRoutes, { noteAiRoutes } from './routes/ai.js';
import aiChatRoutes from './routes/aiChat.js';
import dashboardRoutes from './routes/dashboard.js';
import todosRoutes from './routes/todos.js';
import transferRoutes from './routes/transfer.js';
import hubRoutes from './routes/hub.js';
import aiConnectionsRoutes from './routes/aiConnections.js';
import studyRoutes from './routes/study.js';
import riverRoutes from './routes/river.js';
import { shareRoutes, publicRoutes } from './routes/share.js';
import mediaRoutes from './routes/media.js';
import { wellKnown, oauthRoutes, oauthApi, mcpRoutes } from './routes/oauth.js';
import { errorHandler } from './middleware/errorHandler.js';
import { verifyToken } from './middleware/auth.js';
import { securityHeaders, corsDelegate } from './middleware/security.js';
import { apiLimiter } from './middleware/rateLimit.js';
import { protectExistingKeys } from './services/profile.js';

export interface StartOptions {
  /** Port to listen on. 0 picks a free port (what the desktop app uses). */
  port?: number;
  /** Folder with the built React client. When set, it is served at `/`. */
  staticDir?: string;
  /** Interface to listen on. The desktop app stays on 127.0.0.1; a hosted server uses 0.0.0.0. */
  host?: string;
}

export function createApp(staticDir?: string) {
  const app = express();

  // Behind a hosting platform's proxy, TRUST_PROXY=1 makes rate limits see the real client address.
  // "true" used to trust every X-Forwarded-For entry (anyone could fake an address); it now means one proxy hop.
if (process.env.TRUST_PROXY) app.set('trust proxy', process.env.TRUST_PROXY === 'true' ? 1 : (Number(process.env.TRUST_PROXY) || process.env.TRUST_PROXY));

  app.disable('x-powered-by');
  app.use(securityHeaders(staticDir));

  // People paste the address with a full stop, space or slash on the end ("https://host/mcp."). Treat those as the same address.
  app.use((req, _res, next) => {
    const m = /^(\/(?:mcp|oauth\/[\w-]+|\.well-known\/[\w./-]*?))(?:\.|%2E|%20|\s)+(\?.*)?$/i.exec(req.url);
    if (m) req.url = m[1] + (m[2] || '');
    next();
  });

  // MCP sign-in (OAuth) and the hosted MCP endpoint: public by design, so any MCP client may call them from anywhere.
  const open = [cors({ origin: '*', exposedHeaders: ['WWW-Authenticate'], allowedHeaders: ['Authorization', 'Content-Type', 'Mcp-Session-Id', 'MCP-Protocol-Version'] }), apiLimiter(), express.json({ limit: '1mb' })];
  app.use('/.well-known', cors({ origin: '*' })); // so Settings can test the address from the page
  app.use(wellKnown);
  app.use('/oauth', ...open, oauthRoutes);
  app.use('/mcp', ...open, mcpRoutes);

  // Who may call the API from a browser: see middleware/security.ts (own origin, ALLOWED_ORIGINS, any localhost in dev only).
  app.use(cors(corsDelegate));
app.use('/api', apiLimiter());
  app.use(express.json({ limit: '10mb' }));

  // Before the routers: hosting platforms probe this without signing in.
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // Same as /api/health but also runs a query, so an uptime pinger keeps the hosted database awake too.
  app.get('/api/health/db', async (_req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.json({ status: 'ok', db: 'ok', timestamp: new Date().toISOString() });
    } catch {
      res.status(503).json({ status: 'error', db: 'down' });
    }
  });

  // Which address links should use. Share links and the MCP address must work for other people, so they always
  // point at the hosted app (PUBLIC_URL), never at this computer's own address.
  app.get('/api/config', (req, res) => {
    const configured = (process.env.PUBLIC_URL || '').trim().replace(/\/+$/, '');
    const host = req.get('host') || '';
    const local = /^(localhost|127\.|\[::1\])/.test(host);
    // The desktop app runs its own server on this computer, but its notes live in the same database as the hosted app,
    // so a link to the hosted address opens the same note for anyone.
    const publicUrl = configured || (local ? 'https://peblo-stxo.onrender.com' : `${req.protocol}://${host}`);
    res.json({ publicUrl });
  });

  app.use('/api/auth', authRoutes);
  app.use('/api/profile', profileRoutes);
  app.use('/api/ai/hub', hubRoutes);
  app.use('/api/ai/connections', aiConnectionsRoutes);
  app.use('/api/tags', tagsRoutes);
app.use('/api/tokens', tokensRoutes);
  app.use('/api/oauth', oauthApi);
  app.use('/api/notes', notesRoutes);
  app.use('/api/notes', noteAiRoutes);
  app.use('/api/ai', aiRoutes);
  app.use('/api/ai', aiChatRoutes);
  app.use('/api/dashboard', dashboardRoutes);
  app.use('/api/todos', todosRoutes);
  app.use('/api/study', studyRoutes);
  app.use('/api/river', riverRoutes);
app.use('/api/media', mediaRoutes);
app.use('/api/share', shareRoutes);
app.use('/api/public', publicRoutes);
  app.use('/api', transferRoutes);

  // Unknown API paths answer JSON, never an HTML page.
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found.' }));
  app.use('/api', errorHandler);

  if (staticDir && existsSync(staticDir)) {
    // Built files have a hash in their name, so they can be cached for good. A file that does not exist is a real 404:
    // answering with index.html (as the catch-all below would) made an open tab that still wanted a chunk from an
    // older version get a web page instead of JavaScript, which ended as a blank screen until a reload.
    app.use('/assets', express.static(path.join(staticDir, 'assets'), { index: false, immutable: true, maxAge: '1y', fallthrough: true }));
    app.use('/assets', (_req, res) => res.status(404).type('text/plain').send('Not found'));
    app.use(express.static(staticDir, { index: false }));
    // Single-page app: every other non-API route returns index.html. It must never be cached, because it names the
    // current build's files.
    app.get(/^(?!\/api\/).*/, (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache, must-revalidate');
      res.sendFile(path.join(staticDir, 'index.html'));
    });
  }

  app.use(errorHandler);
  return app;
}

export async function startServer({ port = 0, staticDir, host = '127.0.0.1' }: StartOptions = {}): Promise<{ server: Server; port: number }> {
  await initDatabase();
  await protectExistingKeys().catch((e) => console.error('[keys] could not protect existing keys:', e));

  const app = createApp(staticDir);
  const httpServer = createServer(app);

  // Socket.IO lets the server tell the UI to refresh after AI creates notes/tasks.
  // Each connection must carry a valid sign-in token; it only ever hears its own account's events.
  const io = new SocketIOServer(httpServer);
  io.use(async (socket, next) => {
    try {
      const user = await verifyToken(socket.handshake.auth?.token);
      if (!user) return next(new Error('Sign in to continue.'));
      socket.data.userId = user.id;
      next();
    } catch (e) {
      next(new Error('Sign in to continue.'));
    }
  });
  io.on('connection', (socket) => {
    socket.join(socket.data.userId);
  });
  // Used by "sign out everywhere" and password changes to drop sockets that were opened with an old token.
  app.set('disconnectUser', (userId: string) => { io.in(userId).disconnectSockets(true); });
  app.set('io', io);

  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(port, host, () => resolve());
  });

  const actualPort = (httpServer.address() as AddressInfo).port;
  console.log(`Peblo server running on http://${host}:${actualPort}`);
  return { server: httpServer, port: actualPort };
}

// `npm run dev` inside /server runs this file directly.
const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  // Run on its own: `npm run dev:server` while developing, or `npm run serve` (after `npm run build`) on a host.
  // A host should set NODE_ENV=production, DATABASE_URL, JWT_SECRET, ALLOWED_ORIGINS (if the web client is elsewhere)
  // and TRUST_PROXY=1 when it sits behind the platform's proxy. It then serves the web app and the API together.
  // Also worth knowing on a shared host: SERVER_AI_KEYS=off (do not pay for users' AI with OPENAI_API_KEY / GEMINI_API_KEYS),
  // AI_DAILY_LIMIT, AI_BURST_MAX and API_RATE_MAX (limits per account / per address).
  const production = process.env.NODE_ENV === 'production';
  if (production && process.env.SERVER_AI_KEYS === undefined && (process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY) && process.env.ALLOWED_ORIGINS) {
    console.warn('This server holds AI keys of its own and every account can use them. Set SERVER_AI_KEYS=off to use only keys people save themselves, and AI_DAILY_LIMIT to cap what one account can ask.');
  }
  const clientDir = process.env.PEBLO_STATIC_DIR || path.resolve(process.cwd(), 'client', 'dist');
  startServer({
    port: Number(process.env.PORT) || 3001,
    host: process.env.HOST || (production ? '0.0.0.0' : '127.0.0.1'),
    staticDir: production && existsSync(clientDir) ? clientDir : undefined,
  }).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

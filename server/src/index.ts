import './env.js';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { existsSync } from 'fs';
import { createServer, Server } from 'http';
import { AddressInfo } from 'net';
import { Server as SocketIOServer } from 'socket.io';
import { pathToFileURL } from 'url';

import { initDatabase } from './db.js';
import authRoutes from './routes/auth.js';
import profileRoutes from './routes/profile.js';
import notesRoutes from './routes/notes.js';
import aiRoutes, { noteAiRoutes } from './routes/ai.js';
import aiChatRoutes from './routes/aiChat.js';
import dashboardRoutes from './routes/dashboard.js';
import todosRoutes from './routes/todos.js';
import transferRoutes from './routes/transfer.js';
import hubRoutes from './routes/hub.js';
import studyRoutes from './routes/study.js';
import riverRoutes from './routes/river.js';
import { errorHandler } from './middleware/errorHandler.js';
import { verifyToken } from './middleware/auth.js';
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

  // Desktop app (Electron) sends no Origin header, so it's always allowed. The Vite dev
  // server and, once ALLOWED_ORIGINS is set (comma-separated), a hosted web client too.
  const extraOrigins = (process.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  app.use(cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      if (/^https?:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin)) return cb(null, true);
      if (extraOrigins.includes(origin)) return cb(null, true);
      cb(Object.assign(new Error('That origin is not allowed.'), { statusCode: 403 }));
    },
  }));
  app.use(express.json({ limit: '10mb' }));

  // Before the routers: hosting platforms probe this without signing in.
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  app.use('/api/auth', authRoutes);
  app.use('/api/profile', profileRoutes);
  app.use('/api/ai/hub', hubRoutes);
  app.use('/api/notes', notesRoutes);
  app.use('/api/notes', noteAiRoutes);
  app.use('/api/ai', aiRoutes);
  app.use('/api/ai', aiChatRoutes);
  app.use('/api/dashboard', dashboardRoutes);
  app.use('/api/todos', todosRoutes);
  app.use('/api/study', studyRoutes);
  app.use('/api/river', riverRoutes);
  app.use('/api', transferRoutes);

  // Unknown API paths answer JSON, never an HTML page.
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found.' }));
  app.use('/api', errorHandler);

  if (staticDir && existsSync(staticDir)) {
    app.use(express.static(staticDir, { index: false }));
    // Single-page app: every non-API route returns index.html
    app.get(/^(?!\/api\/).*/, (_req, res) => {
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
  const production = process.env.NODE_ENV === 'production';
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

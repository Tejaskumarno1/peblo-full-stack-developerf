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
import profileRoutes from './routes/profile.js';
import notesRoutes from './routes/notes.js';
import aiRoutes from './routes/ai.js';
import aiChatRoutes from './routes/aiChat.js';
import dashboardRoutes from './routes/dashboard.js';
import todosRoutes from './routes/todos.js';
import transferRoutes from './routes/transfer.js';
import { errorHandler } from './middleware/errorHandler.js';

export interface StartOptions {
  /** Port to listen on. 0 picks a free port (what the desktop app uses). */
  port?: number;
  /** Folder with the built React client. When set, it is served at `/`. */
  staticDir?: string;
}

export function createApp(staticDir?: string) {
  const app = express();

  // Only this machine talks to the server; allow the Vite dev server during development.
  app.use(cors({ origin: [/^http:\/\/localhost:\d+$/, /^http:\/\/127\.0\.0\.1:\d+$/] }));
  app.use(express.json({ limit: '10mb' }));

  app.use('/api/profile', profileRoutes);
  app.use('/api/notes', notesRoutes);
  app.use('/api/notes', aiRoutes);
  app.use('/api/ai', aiRoutes);
  app.use('/api/ai', aiChatRoutes);
  app.use('/api/dashboard', dashboardRoutes);
  app.use('/api/todos', todosRoutes);
  app.use('/api', transferRoutes);

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

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

export async function startServer({ port = 0, staticDir }: StartOptions = {}): Promise<{ server: Server; port: number }> {
  await initDatabase();

  const app = createApp(staticDir);
  const httpServer = createServer(app);

  // Socket.IO lets the server tell the UI to refresh after AI creates notes/tasks.
  const io = new SocketIOServer(httpServer);
  io.on('connection', (socket) => {
    socket.on('join', (userId) => socket.join(userId));
  });
  app.set('io', io);

  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(port, '127.0.0.1', () => resolve());
  });

  const actualPort = (httpServer.address() as AddressInfo).port;
  console.log(`Peblo server running on http://127.0.0.1:${actualPort}`);
  return { server: httpServer, port: actualPort };
}

// `npm run dev` inside /server runs this file directly.
const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  startServer({ port: Number(process.env.PORT) || 3001 }).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

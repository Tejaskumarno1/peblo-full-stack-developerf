import './env.js';
import express from 'express';
import cors from 'cors';
import { rateLimit } from 'express-rate-limit';

import authRoutes from './routes/auth.js';
import notesRoutes from './routes/notes.js';
import aiRoutes from './routes/ai.js';
import aiChatRoutes from './routes/aiChat.js';
import shareRoutes from './routes/share.js';
import dashboardRoutes from './routes/dashboard.js';
import todosRoutes from './routes/todos.js';
import calendarRoutes from './routes/calendar.js';
import { errorHandler } from './middleware/errorHandler.js';

const app = express();
const PORT = process.env.PORT || 3001;

// Trust Vercel's proxy so rate limiting works correctly and doesn't throw ValidationError
app.set('trust proxy', 1);

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
});

// Middleware — CORS
const isVercel = !!process.env.VERCEL;
const corsOrigins = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',').map((o) => o.trim())
  : isVercel
    ? true // same-origin on Vercel, allow all
    : [
        'http://localhost:5173',
        'http://localhost:5174',
        'http://localhost:5175',
        'http://localhost:5176',
        'http://localhost:3000',
      ];

app.use(cors({
  origin: corsOrigins,
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));
app.use(limiter);

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/notes', notesRoutes);
app.use('/api/notes', aiRoutes);
app.use('/api/ai', aiChatRoutes);
app.use('/api/shared', shareRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/todos', todosRoutes);
app.use('/api/calendar', calendarRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Error handler
app.use(errorHandler);

// Only start listener locally — Vercel handles this as a serverless function
if (!process.env.VERCEL) {
  const server = app.listen(PORT, () => {
    console.log(`🚀 Peblo Notes API running on http://localhost:${PORT}`);
  });

  server.on('error', (err: any) => {
    if (err.code === 'EADDRINUSE') {
      console.error(
        `\n❌ Port ${PORT} is already in use. Stop the other process first:\n` +
          `   fuser -k ${PORT}/tcp   OR   kill $(lsof -t -i:${PORT})\n` +
          `   Then run: npm run dev\n`
      );
      process.exit(1);
    }
    throw err;
  });

  // Graceful shutdown for tsx watch
  const gracefulShutdown = () => {
    console.log('Shutting down gracefully...');
    server.close(async () => {
      // If you exported prisma from db.js, you can disconnect here.
      console.log('Closed out remaining connections.');
      process.exit(0);
    });

    setTimeout(() => {
      console.error('Could not close connections in time, forcefully shutting down');
      process.exit(1);
    }, 4000);
  };

  process.on('SIGTERM', gracefulShutdown);
  process.on('SIGINT', gracefulShutdown);
}

// Export for Vercel serverless
export default app;

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
import { errorHandler } from './middleware/errorHandler.js';

const app = express();
const PORT = process.env.PORT || 3001;

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
});

// Middleware — allow Vite dev ports (5173–5180) when defaults are in use
const corsOrigins = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',').map((o) => o.trim())
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

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Error handler
app.use(errorHandler);

const server = app.listen(PORT, () => {
  console.log(`🚀 Peblo Notes API running on http://localhost:${PORT}`);
});

server.on('error', (err) => {
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

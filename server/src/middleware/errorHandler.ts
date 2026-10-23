import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';

export function errorHandler(err: any, req: Request, res: Response, next: NextFunction) {
  // Prisma unique constraint violation
  if (err.code === 'P2002') {
    return res.status(409).json({ error: 'A record with this value already exists' });
  }

  // Prisma record not found
  if (err.code === 'P2025') {
    return res.status(404).json({ error: 'Record not found' });
  }

  // Upload limits (multer): too big -> 413, anything else about the upload -> 400
  if (err.name === 'MulterError') {
    const tooBig = err.code === 'LIMIT_FILE_SIZE';
    return res.status(tooBig ? 413 : 400).json({ error: tooBig ? 'That file is too large.' : `Upload problem: ${err.message}` });
  }

  // Errors the server raised on purpose carry a statusCode and a message written for people.
  // Anything else is unexpected (database, library, bug): keep its text in the log, not in the reply.
  if (typeof err.statusCode === 'number' && err.statusCode >= 400 && err.statusCode < 600) {
    console.error('Error:', err.message);
    return res.status(err.statusCode).json({ error: err.message || 'Request failed', ...(process.env.NODE_ENV === 'development' ? { stack: err.stack } : {}) });
  }
  const requestId = crypto.randomBytes(4).toString('hex');
  console.error(`Error [${requestId}] ${req.method} ${req.originalUrl}:`, err.stack || err.message || err);
  res.status(500).json({ error: `Something went wrong. If it keeps happening, quote reference ${requestId}.`, requestId });
}

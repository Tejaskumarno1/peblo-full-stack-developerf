import { Router, raw } from 'express';
import prisma from '../db.js';
import { decField, encField } from '../dataCrypto.js';
import { authenticate } from '../middleware/auth.js';
import { describeImage } from '../services/aiService.js';
import { aiLimit } from '../middleware/rateLimit.js';

// Pictures for notes. Reading is public (the address is a long random id, like a share link) so a picture shows in
// shared pages, exports and the desktop app without any sign-in. Writing needs the person to be signed in.
const router = Router();
const OK = /^image\/(webp|png|jpeg|gif)$/;
const MAX = 6 * 1024 * 1024;
const MAX_TOTAL = 500 * 1024 * 1024; // per account, same ceiling as files

router.get('/:id', async (req, res, next) => {
  try {
    const id = String(req.params.id).replace(/\.\w+$/, '');
    if (!/^[\w-]{8,64}$/.test(id)) return res.status(404).end();
    const rows: any[] = await prisma.$queryRaw`SELECT mime, data FROM media WHERE id = ${id}`;
    if (!rows.length) return res.status(404).end();
    res.set({
      'Content-Type': rows[0].mime,
      'Cache-Control': 'public, max-age=31536000, immutable',
      'Access-Control-Allow-Origin': '*',
      'Cross-Origin-Resource-Policy': 'cross-origin',
    });
    res.send(Buffer.from(rows[0].data));
  } catch (e) { next(e); }
});

// The words that go with a picture (what it shows, and any text in it). Public like the picture itself.
router.get('/:id/text', async (req, res, next) => {
  try {
    const id = String(req.params.id);
    if (!/^[\w-]{8,64}$/.test(id)) return res.status(404).end();
    const rows: any[] = await prisma.$queryRaw`SELECT description FROM media WHERE id = ${id}`;
    if (!rows.length) return res.status(404).end();
    res.json({ id, description: decField('media', 'description', id, rows[0].description) || null });
  } catch (e) { next(e); }
});

// Make (or redo) the words for one of your pictures with your AI.
router.post('/:id/describe', authenticate, ...aiLimit, async (req: any, res, next) => {
  try {
    const id = String(req.params.id);
    if (!/^[\w-]{8,64}$/.test(id)) return res.status(404).end();
    const rows: any[] = await prisma.$queryRaw`SELECT mime, data FROM media WHERE id = ${id} AND user_id = ${req.user.id}`;
    if (!rows.length) return res.status(404).json({ error: 'Picture not found.' });
    const description = await describeImage(req.user.id, Buffer.from(rows[0].data).toString('base64'), rows[0].mime);
    await prisma.$executeRaw`UPDATE media SET description = ${encField('media', 'description', id, description)}, described_at = now() WHERE id = ${id}`;
    res.json({ id, description });
  } catch (e: any) { if (e?.status) return res.status(e.status).json({ error: e.message }); next(e); }
});

router.post('/', authenticate, raw({ type: 'image/*', limit: MAX }), async (req: any, res, next) => {
  try {
    const mime = String(req.headers['content-type'] || '').split(';')[0].trim();
    if (!OK.test(mime)) return res.status(415).json({ error: 'Only WebP, PNG, JPEG and GIF pictures can be stored.' });
    const body: Buffer = req.body;
    if (!Buffer.isBuffer(body) || !body.length) return res.status(400).json({ error: 'No picture came with the request.' });
    if (body.length > MAX) return res.status(413).json({ error: 'That picture is over 6 MB.' });
    const used: any[] = await prisma.$queryRaw`SELECT COALESCE(SUM(size), 0)::float8 AS n FROM media WHERE user_id = ${req.user.id}`;
    if (Number(used[0]?.n || 0) + body.length > MAX_TOTAL) return res.status(413).json({ error: 'Your picture storage is full (500 MB). Delete some notes with pictures first.' });
    const rows: any[] = await prisma.$queryRaw`INSERT INTO media (user_id, mime, size, data) VALUES (${req.user.id}, ${mime}, ${body.length}, ${body}) RETURNING id`;
    res.status(201).json({ id: rows[0].id, url: `/api/media/${rows[0].id}`, size: body.length, mime });
  } catch (e) { next(e); }
});

export default router;

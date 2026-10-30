import { Router, raw } from 'express';
import prisma from '../db.js';
import { authenticate } from '../middleware/auth.js';

// Files added to notes. Reading is public (the address is a long random id, like a share link) so the file shows in shared pages
// and the desktop app without any sign-in. Writing needs the person to be signed in. The original bytes always come back unchanged.
const router = Router();
export const MAX_FILE = 25 * 1024 * 1024;
const MAX_TOTAL = 500 * 1024 * 1024;
const SAFE_MIME = /^[\w.+-]+\/[\w.+-]+$/;
const RISKY = /^(text\/html|application\/xhtml|image\/svg|text\/xml|application\/xml|text\/javascript|application\/javascript)/i;

const clean = (s: string) => String(s || '').replace(/[\\/\u0000-\u001f"]/g, '_').trim().slice(0, 180) || 'file';

router.get('/:id', async (req, res, next) => {
  try {
    const id = String(req.params.id).replace(/\.\w+$/, '');
    if (!/^[\w-]{8,64}$/.test(id)) return res.status(404).end();
    const rows: any[] = await prisma.$queryRaw`SELECT name, mime, data FROM files WHERE id = ${id}`;
    if (!rows.length) return res.status(404).end();
    const { name, mime, data } = rows[0];
    const type = RISKY.test(mime) ? 'application/octet-stream' : mime;
    const inline = type === 'application/pdf' && req.query.dl !== '1';
    res.set({
      'Content-Type': type,
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${clean(name).replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(clean(name))}`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'public, max-age=31536000, immutable',
      'Access-Control-Allow-Origin': '*',
      'Cross-Origin-Resource-Policy': 'cross-origin',
    });
    res.send(Buffer.from(data));
  } catch (e) { next(e); }
});

router.post('/', authenticate, raw({ type: () => true, limit: MAX_FILE + 1024 }), async (req: any, res, next) => {
  try {
    const body: Buffer = req.body;
    if (!Buffer.isBuffer(body) || !body.length) return res.status(400).json({ error: 'No file came with the request.' });
    if (body.length > MAX_FILE) return res.status(413).json({ error: 'That file is over 25 MB.' });
    const used: any[] = await prisma.$queryRaw`SELECT COALESCE(SUM(size), 0)::float8 AS n FROM files WHERE user_id = ${req.user.id}`;
    if (Number(used[0]?.n || 0) + body.length > MAX_TOTAL) return res.status(413).json({ error: 'Your file storage is full (500 MB). Delete some files first.' });
    let name = 'file';
    try { name = clean(decodeURIComponent(String(req.headers['x-file-name'] || 'file'))); } catch { /* keep the default */ }
    const asked = String(req.headers['x-file-type'] || '').split(';')[0].trim().toLowerCase();
    const mime = SAFE_MIME.test(asked) ? asked : 'application/octet-stream';
    const rows: any[] = await prisma.$queryRaw`INSERT INTO files (user_id, name, mime, size, data) VALUES (${req.user.id}, ${name}, ${mime}, ${body.length}, ${body}) RETURNING id`;
    res.status(201).json({ id: rows[0].id, url: `/api/files/${rows[0].id}`, name, size: body.length, mime });
  } catch (e: any) {
    if (e?.type === 'entity.too.large') return res.status(413).json({ error: 'That file is over 25 MB.' });
    next(e);
  }
});

export default router;

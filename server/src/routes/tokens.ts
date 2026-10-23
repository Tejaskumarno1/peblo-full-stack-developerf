import { Router } from 'express';
import crypto from 'crypto';
import prisma from '../db.js';
import { authenticate, TOKEN_PREFIX, hashToken } from '../middleware/auth.js';

/*
 * Personal access tokens (PEB-95): let the Peblo MCP server (Claude Desktop, Cursor...) or a script act for this
 * account. Made and revoked here with a real sign-in only; a token cannot make more tokens (see authenticate).
 */
const router = Router();
router.use(authenticate);

const MAX_TOKENS = 10;

// GET /api/tokens -> the account's tokens (never the secret)
router.get('/', async (req, res, next) => {
  try {
    const tokens = await prisma.apiToken.findMany({
      where: { userId: req.user!.id },
      select: { id: true, name: true, prefix: true, scope: true, createdAt: true, lastUsedAt: true },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ tokens });
  } catch (error) { next(error); }
});

// GET /api/tokens/activity -> the last things connected apps did (newest first)
router.get('/activity', async (req, res, next) => {
  try {
    const rows = await prisma.$queryRaw<any[]>`SELECT id, app, tool, summary, ok, at FROM mcp_activity WHERE user_id = ${req.user!.id} ORDER BY at DESC LIMIT 100`;
    res.json({ activity: rows });
  } catch (error) { next(error); }
});

// DELETE /api/tokens/activity -> clear the log
router.delete('/activity', async (req, res, next) => {
  try {
    await prisma.$executeRaw`DELETE FROM mcp_activity WHERE user_id = ${req.user!.id}`;
    res.json({ ok: true });
  } catch (error) { next(error); }
});

// POST /api/tokens { name } -> { token } shown once
router.post('/', async (req, res, next) => {
  try {
    const name = String(req.body?.name || '').trim().slice(0, 60);
    if (!name) return res.status(400).json({ error: 'Give the token a name, for example "Claude Desktop".' });
    const scope = req.body?.scope === 'read' ? 'read' : 'full';
    const count = await prisma.apiToken.count({ where: { userId: req.user!.id } });
    if (count >= MAX_TOKENS) return res.status(400).json({ error: `You can have ${MAX_TOKENS} tokens. Remove one you no longer use first.` });
    const token = TOKEN_PREFIX + crypto.randomBytes(24).toString('base64url');
    const row = await prisma.apiToken.create({
      data: { userId: req.user!.id, name, scope, tokenHash: hashToken(token), prefix: token.slice(0, 10) },
      select: { id: true, name: true, prefix: true, scope: true, createdAt: true, lastUsedAt: true },
    });
    res.status(201).json({ token, ...row });
  } catch (error) { next(error); }
});

// DELETE /api/tokens/:id
router.delete('/:id', async (req, res, next) => {
  try {
    const r = await prisma.apiToken.deleteMany({ where: { id: req.params.id, userId: req.user!.id } });
    if (!r.count) return res.status(404).json({ error: 'Token not found.' });
    res.json({ ok: true });
  } catch (error) { next(error); }
});

export default router;

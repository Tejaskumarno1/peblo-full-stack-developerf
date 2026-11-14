/*
 * Board columns: the Kanban columns of a team (shared, edited by a team lead) or of Personal (yours).
 *   GET /api/todos/board            -> { columns: [{ key, name, tone }], canEdit }
 *   PUT /api/todos/board { columns }  To do is always first and Done always last; everything between is yours.
 */
import prisma from '../db.js';
import { spaceAccess, can } from '../utils/access.js';
import { COLUMN_KEY } from '../utils/taskAccess.js';

export const DEFAULT_COLUMNS = [
  { key: 'todo', name: 'To do', tone: 'sand' },
  { key: 'doing', name: 'In progress', tone: 'butter' },
  { key: 'review', name: 'In review', tone: 'lilac' },
  { key: 'done', name: 'Done', tone: 'mint' },
];
const TONES = ['sand', 'butter', 'lilac', 'mint', 'sky', 'peach'];

async function who(req: any, res: any) {
  const userId = req.user?.id as string;
  if (!userId) { res.status(401).json({ error: 'Not signed in' }); return null; }
  const raw = String(req.headers['x-peblo-space'] ?? req.query?.space ?? '').trim();
  if (!raw || raw === 'personal' || req.user.viaToken) return { scope: `u:${userId}`, canEdit: true };
  const acc = await spaceAccess(userId, raw);
  if (!acc) { res.status(404).json({ error: 'Team not found.' }); return null; }
  return { scope: raw, canEdit: can('space.manage', acc.org, acc.role) };
}

export async function getBoard(req: any, res: any, next: any) {
  try {
    const w = await who(req, res); if (!w) return;
    const rows = await prisma.$queryRaw<any[]>`SELECT columns FROM board_columns WHERE scope = ${w.scope}`;
    res.json({ columns: rows[0]?.columns || DEFAULT_COLUMNS, canEdit: w.canEdit });
  } catch (e) { next(e); }
}

export async function putBoard(req: any, res: any, next: any) {
  try {
    const w = await who(req, res); if (!w) return;
    if (!w.canEdit) return res.status(403).json({ error: 'Only a team lead can change the board columns.' });
    const given = Array.isArray(req.body?.columns) ? req.body.columns : [];
    const seen = new Set<string>(['todo', 'done']);
    const middle: { key: string; name: string; tone: string }[] = [];
    for (const c of given) {
      const key = typeof c?.key === 'string' ? c.key : '';
      if (key === 'todo' || key === 'done') continue;
      if (!COLUMN_KEY.test(key) || seen.has(key)) continue;
      const name = String(c?.name ?? '').replace(/\s+/g, ' ').trim().slice(0, 30);
      if (!name) continue;
      seen.add(key);
      middle.push({ key, name, tone: TONES.includes(c?.tone) ? c.tone : 'sand' });
    }
    if (middle.length > 10) return res.status(400).json({ error: 'A board can have up to 12 columns.' });
    const nameOf = (k: string, d: string) => { const c = given.find((x: any) => x?.key === k); const n = String(c?.name ?? '').replace(/\s+/g, ' ').trim().slice(0, 30); return n || d; };
    const columns = [{ key: 'todo', name: nameOf('todo', 'To do'), tone: 'sand' }, ...middle, { key: 'done', name: nameOf('done', 'Done'), tone: 'mint' }];
    await prisma.$executeRaw`INSERT INTO board_columns (scope, columns) VALUES (${w.scope}, ${JSON.stringify(columns)}::jsonb) ON CONFLICT (scope) DO UPDATE SET columns = ${JSON.stringify(columns)}::jsonb, updated_at = NOW()`;
    res.json({ columns, canEdit: true });
  } catch (e) { next(e); }
}

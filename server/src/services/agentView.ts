import type { Request, Response, NextFunction } from 'express';
import prisma from '../db.js';
import { accessFor } from './shareAccess.js';
import { describeImage } from './aiService.js';

/*
 * A shared note, for bots and other programs: the same link gives plain Markdown or JSON when the caller asks for it
 * (Accept: text/markdown, a .md / .json / .txt ending, ?format=, or a known crawler or AI agent). People still get the page.
 * Pictures come with a text description (made once with the owner's AI when one is set up, then kept).
 */
const TOKEN = /^[A-Za-z0-9_-]{20,40}$/;
const BOT = /bot|crawler|spider|gpt|claude|anthropic|openai|perplexity|gemini|llm|agent|curl|wget|python-requests|axios|node-fetch|go-http-client|okhttp|httpx/i;
const MEDIA = /\/api\/media\/([\w-]{8,64})/g;
const MAX_DESCRIBE = 12;

export function origin(req: Request) {
  const proto = String(req.headers['x-forwarded-proto'] || req.protocol).split(',')[0];
  return `${proto}://${req.get('host')}`;
}

type Img = { id: string; url: string; description: string | null };

// Anonymous readers must not be able to run up the owner's AI bill: a picture is tried once per 10 minutes (even when the AI fails),
// and one owner's AI describes at most 30 pictures per hour through share links. Successful descriptions are stored and never redone.
const tried = new Map<string, number>();
const spent = new Map<string, { n: number; reset: number }>();
const allowDescribe = (userId: string, id: string) => {
  const now = Date.now();
  if (tried.size > 2000) for (const [k, t] of tried) if (t < now - 600_000) tried.delete(k);
  if ((tried.get(id) ?? 0) > now - 600_000) return false;
  const s = spent.get(userId);
  if (!s || s.reset < now) spent.set(userId, { n: 1, reset: now + 3_600_000 });
  else if (s.n >= 30) return false;
  else s.n++;
  tried.set(id, now);
  return true;
};

async function imagesOf(content: string, userId: string, base: string): Promise<Img[]> {
  const ids = [...new Set([...content.matchAll(MEDIA)].map((m) => m[1]))];
  const out: Img[] = [];
  for (const [i, id] of ids.entries()) {
    const rows = (await prisma.$queryRaw`SELECT description, mime, size FROM media WHERE id = ${id} AND user_id = ${userId}`.catch(() => [])) as any[];
    if (!rows.length) continue;
    let description: string | null = rows[0].description || null;
    if (!description && i < MAX_DESCRIBE && rows[0].size < 4_000_000 && allowDescribe(userId, id)) {
      try {
        const data: any[] = await prisma.$queryRaw`SELECT data FROM media WHERE id = ${id} AND user_id = ${userId}`;
        description = await describeImage(userId, Buffer.from(data[0].data).toString('base64'), rows[0].mime);
        if (description) await prisma.$executeRaw`UPDATE media SET description = ${description}, described_at = now() WHERE id = ${id} AND user_id = ${userId}`;
      } catch { /* no AI set up, or it failed: the picture is still listed with its address */ }
    }
    out.push({ id, url: `${base}/api/media/${id}`, description });
  }
  return out;
}

export function toMarkdown(note: { title: string; content: string; author: string | null; updatedAt: Date; canEdit: boolean; link: string }, imgs: Img[], base: string) {
  const by = new Map(imgs.map((i) => [i.id, i]));
  const body = (note.content || '')
    .replace(/<figure>[\s\S]*?<\/figure>/g, (f) => { const m = /\/api\/media\/([\w-]{8,64})/.exec(f); return m ? `![picture](${base}/api/media/${m[1]})` : ''; })
    .replace(/!\[([^\]]*)\]\((\/api\/media\/([\w-]{8,64}))\)/g, (_s, alt, p, id) => {
      const d = by.get(id)?.description;
      return `![${alt || 'picture'}](${base}${p})${d ? `\n\n> Picture description: ${d.replace(/\n+/g, '\n> ')}\n` : ''}`;
    });
  return [
    `# ${note.title || 'Untitled'}`,
    '',
    `- Shared by: ${note.author || 'unknown'}`,
    `- Last updated: ${note.updatedAt.toISOString()}`,
    `- Can be edited through this link: ${note.canEdit ? 'yes' : 'no'}`,
    `- Link: ${note.link}`,
    '',
    '---',
    '',
    body,
    '',
  ].join('\n');
}

export async function agentNote(req: Request, res: Response, next: NextFunction) {
  try {
    const m = /^([A-Za-z0-9_-]{20,40})(?:\.(md|json|txt))?$/.exec(String(req.params.tok));
    if (!m) return next();
    const [, token, ext] = m;
    const q = String(req.query.format || '');
    const accept = String(req.headers.accept || '');
    const fmt = ext || (['md', 'json', 'txt'].includes(q) ? q : /text\/markdown/.test(accept) ? 'md' : /application\/json/.test(accept) && !/text\/html/.test(accept) ? 'json' : (!/text\/html/.test(accept) && /text\/plain/.test(accept)) || BOT.test(String(req.headers['user-agent'] || '')) && !/text\/html/.test(accept) ? 'md' : '');
    if (!fmt) return next();
    if (!TOKEN.test(token)) return res.status(404).type('text/plain').send('This link is not shared any more.');
    const note = await prisma.note.findFirst({
      where: { shareToken: token, isDeleted: false, OR: [{ shareExpiresAt: null }, { shareExpiresAt: { gt: new Date() } }] },
      select: { userId: true, title: true, content: true, updatedAt: true, shareEdit: true, user: { select: { name: true } } },
    });
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.setHeader('Cache-Control', 'no-store');
    if (!note) return res.status(404).type('text/plain').send('This link is not shared any more.');
    const acc = await accessFor('note', token, req.query.sid, !!note.shareEdit, false);
    if (!acc.allowed) return res.status(403).type('text/plain').send('The owner has to let you in before this page can be read.');
    const base = origin(req);
    const link = `${base}/s/note/${token}`;
    const imgs = await imagesOf(note.content || '', note.userId, base);
    const data = { title: note.title, author: note.user?.name || null, updatedAt: note.updatedAt, canEdit: acc.canEdit, link };
    if (fmt === 'json') {
      return res.json({ ...data, markdown: toMarkdown({ ...note, ...data, author: data.author } as any, imgs, base), images: imgs.map((i) => ({ url: i.url, description: i.description })) });
    }
    res.type(fmt === 'txt' ? 'text/plain; charset=utf-8' : 'text/markdown; charset=utf-8').send(toMarkdown({ ...note, ...data } as any, imgs, base));
  } catch (e) { next(e); }
}

import { Request, Response, NextFunction } from 'express';
import { notify } from '../utils/notify.js';
import prisma from '../db.js';
import * as aiService from '../services/aiService.js';
import { saveVersion } from '../services/noteVersions.js';
import { saveNoteMerged } from '../services/noteSave.js';
import { cleanNoteMeta } from '../utils/meta.js';

// prisma imported from db.js

// Optimized helper to sync tags: checks for changes first, resolves concurrently, and uses bulk insertions.
// Tags are scoped per user (userId), so two users can each have their own "work" tag.
export async function syncTags(userId: any, noteId: any, tagNames: any) {
  const normalizedInput = Array.from(
    new Set((tagNames || []).map((t: any) => t.trim().toLowerCase()).filter(Boolean))
  ).sort() as string[];

  // Fetch current tag names associated with the note
  const currentAssociations = await prisma.noteTag.findMany({
    where: { noteId },
    include: { tag: true }
  });
  const normalizedCurrent = currentAssociations.map((ca: any) => ca.tag.name.trim().toLowerCase()).sort();

  // If tags are identical, do nothing (bypasses up to 7-10 redundant DB queries)
  if (JSON.stringify(normalizedInput) === JSON.stringify(normalizedCurrent)) {
    return;
  }

  // Remove existing associations
  await prisma.noteTag.deleteMany({ where: { noteId } });

  if (normalizedInput.length === 0) return;

  // Bulk fetch existing tags (this user's own) to avoid N+1 sequential queries
  const existingTags = await prisma.tag.findMany({
    where: { userId, name: { in: normalizedInput } }
  });

  const existingTagNames = existingTags.map((t: any) => t.name);
  const missingTagNames = normalizedInput.filter((name: any) => !existingTagNames.includes(name)) as string[];

  let newTags: any[] = [];
  if (missingTagNames.length > 0) {
    // Bulk create missing tags (Prisma createMany returns count, not records, so we re-fetch)
    await prisma.tag.createMany({
      data: missingTagNames.map((name: any) => ({ userId, name }))
    });
    newTags = await prisma.tag.findMany({
      where: { userId, name: { in: missingTagNames } }
    });
  }

  const allResolvedTags = [...existingTags, ...newTags];

  // Bulk associate tags with the note
  await prisma.noteTag.createMany({
    data: allResolvedTags.map((tag: any) => ({ noteId, tagId: tag.id }))
  });
}

// Include clause for notes with tags and AI metadata
const noteInclude = {
  tags: {
    include: { tag: true }
  },
  aiGenerations: {
    select: { type: true }
  },
  linkedTodos: {
    select: { id: true, text: true, priority: true, deadline: true, completed: true }
  }
};

// Format note for API response
function formatNote(note: any) {
  return {
    ...note,
    tags: note.tags ? note.tags.map((nt: any) => nt.tag.name) : [],
    taskCount: note._count ? note._count.linkedTodos : undefined,
    hasSummary: note.aiGenerations ? note.aiGenerations.some((ai: any) => ai.type === 'summary') : false,
    linkedTodos: note.linkedTodos || []
  };
}

// ---------- links between notes ----------
const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Rewrites the list of notes this note links to. A failure here never blocks saving: the next save rebuilds it. */
async function syncLinks(userId: string, noteId: string, content: string) {
  try {
    const ids = [...new Set([...String(content || '').matchAll(/\]\(\/notes\/([\w-]+)(?:#[^)]*)?\)/g)].map((m) => m[1]))].filter((x) => x !== noteId).slice(0, 200);
    await prisma.$executeRaw`DELETE FROM note_links WHERE source_id = ${noteId}`;
    if (!ids.length) return;
    const valid = await prisma.note.findMany({ where: { id: { in: ids }, userId }, select: { id: true } });
    for (const v of valid) await prisma.$executeRaw`INSERT INTO note_links (source_id, target_id) VALUES (${noteId}, ${v.id}) ON CONFLICT DO NOTHING`;
  } catch { /* rebuilt by the next save */ }
}

/** Other notes that say this note's title but do not link to it yet. */
export async function getMentions(req: any, res: any, next: any) {
  try {
    const id = String(req.params.id);
    const me = await prisma.note.findFirst({ where: { id, userId: req.user.id }, select: { title: true } });
    const title = (me?.title || '').trim();
    if (!me || title.length < 3 || /^untitled/i.test(title)) return res.json({ mentions: [] });
    const rows = await prisma.note.findMany({
      where: { userId: req.user.id, isDeleted: false, id: { not: id }, content: { contains: title, mode: 'insensitive' } },
      select: { id: true, title: true, content: true },
      orderBy: { updatedAt: 'desc' },
      take: 40,
    });
    const re = new RegExp(`(?<![\\[\\w])${escRe(title)}(?![\\]\\w])`, 'i');
    const out: any[] = [];
    for (const r of rows) {
      if ((r.content || '').includes(`](/notes/${id})`)) continue;
      const text = stripMedia(r.content || '').replace(/\s+/g, ' ');
      const m = re.exec(text);
      if (!m) continue;
      const start = Math.max(0, m.index - 50);
      out.push({ id: r.id, title: r.title, snippet: (start > 0 ? '…' : '') + text.slice(start, m.index + title.length + 60) + '…' });
      if (out.length >= 10) break;
    }
    res.json({ mentions: out });
  } catch (error) {
    next(error);
  }
}

/** Turns the first plain mention of this note's title, in another note, into a link to this note. */
export async function linkMention(req: any, res: any, next: any) {
  try {
    const id = String(req.params.id);
    const otherId = String(req.params.otherId);
    const me = await prisma.note.findFirst({ where: { id, userId: req.user.id }, select: { title: true } });
    const other = await prisma.note.findFirst({ where: { id: otherId, userId: req.user.id, isDeleted: false }, select: { content: true } });
    if (!me || !other) return res.status(404).json({ error: 'Note not found' });
    const title = (me.title || '').trim();
    const content = other.content || '';
    const m = title ? new RegExp(`(?<![\\[\\w])${escRe(title)}(?![\\]\\w])`, 'i').exec(content) : null;
    if (!m) return res.status(404).json({ error: 'That note no longer mentions this one.' });
    const next2 = content.slice(0, m.index) + `[${m[0]}](/notes/${id})` + content.slice(m.index + m[0].length);
    await saveVersion(otherId, content, { force: true }).catch(() => {});
    await prisma.note.update({ where: { id: otherId }, data: { content: next2 }, select: { id: true } });
    await syncLinks(req.user.id, otherId, next2);
    notify(req, 'notes_changed');
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
}

// ---------- search ----------
// Several words match in any order; results are ranked (exact title > title start > title > tags > text), a near-miss
// in a title ("meetng") is still found, and each result carries the line around the match with pictures removed.
const stripMedia = (s: string) => (s || '')
  .replace(/<figure>[\s\S]*?<\/figure>/g, ' ')
  .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
  .replace(/data:[a-z]+\/[\w.+-]+;base64,[A-Za-z0-9+/=]+/g, ' ');
const searchWords = (q: string) => [...new Set(q.toLowerCase().replace(/#/g, ' ').split(/\s+/).filter(Boolean))].slice(0, 6);
function lev(a: string, b: string) {
  const d: number[] = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0]; d[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = d[j];
      d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return d[b.length];
}
function nearTitle(title: string, words: string[]) {
  const toks = (title || '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  return words.some((w) => w.length >= 4 && toks.some((t) => Math.abs(t.length - w.length) <= 2 && lev(t, w) <= (w.length >= 7 ? 2 : 1)));
}
function rankNotes(list: any[], q: string, words: string[], fuzzy: Set<string>) {
  const full = q.toLowerCase().replace(/#/g, ' ').replace(/\s+/g, ' ').trim();
  const now = Date.now();
  return list.map((n) => {
    const title = (n.title || '').toLowerCase();
    const flat = stripMedia(n.content || '').replace(/[#*_>`|]+/g, ' ').replace(/\s+/g, ' ').trim();
    const lower = flat.toLowerCase();
    const tags: string[] = n.tags || [];
    let s = 0;
    if (full) {
      if (title === full) s += 100; else if (title.startsWith(full)) s += 70; else if (title.includes(full)) s += 50;
      if (lower.includes(full)) s += 10;
    }
    let hitsAll = true;
    for (const w of words) {
      const inT = title.includes(w);
      const inTag = tags.some((t) => t.toLowerCase().includes(w));
      let c = 0; let i = lower.indexOf(w);
      while (i >= 0 && c < 8) { c++; i = lower.indexOf(w, i + w.length); }
      if (inT) s += 15;
      if (inTag) s += 12;
      s += c * 2;
      if (!inT && !inTag && !c) hitsAll = false;
    }
    if (hitsAll && words.length > 1) s += 20;
    if (fuzzy.has(n.id)) s += 25;
    s += Math.max(0, 5 - (now - new Date(n.updatedAt).getTime()) / 86400000 / 30);
    let at = -1;
    for (const w of words) { at = lower.indexOf(w); if (at >= 0) break; }
    let matchSnippet: string | null = null;
    if (at >= 0) {
      const start = Math.max(0, at - 40);
      matchSnippet = (start > 0 ? '…' : '') + flat.slice(start, start + 160) + (start + 160 < flat.length ? '…' : '');
    }
    return { ...n, matchSnippet, score: Math.round(s * 10) / 10 };
  }).sort((a, b) => b.score - a.score);
}

export async function getNotes(req: any, res: any, next: any) {
  try {
    const { search, tag, category, sort = 'updated', archived, deleted, snippet } = req.query;
    const userId = req.user.id;
    const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? ''), 10) || 0, 0), 500);
    const offset = Math.max(parseInt(String(req.query.offset ?? ''), 10) || 0, 0);

    const where: any = { userId };

    // Archive filter
    where.isArchived = archived === 'true';

    // Deleted filter
    where.isDeleted = deleted === 'true';

    // Category filter
    if (category) {
      where.category = category;
    }

    // Tag filter
    if (tag) {
      where.tags = {
        some: { tag: { name: tag.toLowerCase() } }
      };
    }

    // Search filter
    if (search) {
      // Title, text and tags, ignoring case.
      const q = String(search).trim();
      const words = searchWords(q);
      where.OR = (words.length ? words : [q]).flatMap((w) => [
        { title: { contains: w, mode: 'insensitive' } },
        { content: { contains: w, mode: 'insensitive' } },
        { tags: { some: { tag: { name: { contains: w, mode: 'insensitive' } } } } }
      ]);
    }

    // Sort
    let orderBy = {};
    switch (sort) {
      case 'created':
        orderBy = { createdAt: 'desc' };
        break;
      case 'title':
        orderBy = { title: 'asc' };
        break;
      default:
        orderBy = { updatedAt: 'desc' };
    }

    const notes = await prisma.note.findMany({
      where,
      select: {
        id: true,
        title: true,
        content: true, // Restored to render the sidebar snippet preview correctly
        category: true,
        isArchived: true,
        isDeleted: true,
        deletedAt: true,
        meta: true,
        createdAt: true,
        updatedAt: true,
        tags: {
          select: { tag: true }
        },
        aiGenerations: {
          select: { type: true }
        },
        _count: { select: { linkedTodos: true } }
      },
      orderBy,
      // Optional paging. Without `limit` every note comes back: the sidebar and the editor
      // open notes from that full list, so it must stay complete.
      ...(limit ? { take: limit, skip: offset } : {})
    });

    let found: any[] = notes;
    const fuzzy = new Set<string>();
    const sq = search ? String(search).trim() : '';
    if (sq && found.length < 3 && sq.length >= 4) {
      // Few hits: also look for titles that are one or two letters off (typing "meetng" finds "Meeting").
      const words = searchWords(sq);
      const titles = await prisma.note.findMany({ where: { userId, isArchived: where.isArchived, isDeleted: where.isDeleted }, select: { id: true, title: true } });
      const have = new Set(found.map((n: any) => n.id));
      const near = titles.filter((t) => !have.has(t.id) && nearTitle(t.title, words)).slice(0, 10).map((t) => t.id);
      if (near.length) {
        near.forEach((id) => fuzzy.add(id));
        found = found.concat(await prisma.note.findMany({ where: { id: { in: near }, userId }, include: noteInclude }));
      }
    }
    let out: any[] = found.map(formatNote);
    if (sq) out = rankNotes(out, sq, searchWords(sq), fuzzy);
    // `snippet=1`: list views that only show a preview get the first 400 characters, not whole notes.
    // Never open or save a note from a snippet list (it is cut short) — use GET /notes/:id.
    if (snippet === '1' || snippet === 'true') {
      out = out.map((n) => ({
        ...n,
        content: n.content && n.content.length > 400 ? n.content.slice(0, 400) : n.content,
        truncated: !!n.content && n.content.length > 400,
      }));
    }
    res.json({ notes: out, ...(limit ? { limit, offset } : {}) });
  } catch (error) {
    next(error);
  }
}

export async function getNote(req: any, res: any, next: any) {
  try {
    const note = await prisma.note.findFirst({
      where: { id: req.params.id, userId: req.user.id },
      include: noteInclude
    });

    if (!note) {
      return res.status(404).json({ error: 'Note not found' });
    }

    res.json({ note: formatNote(note) });
  } catch (error) {
    next(error);
  }
}

export async function createNote(req: any, res: any, next: any) {
  try {
    const { title, content, category, tags, meta } = req.body;
    const cleanMeta = cleanNoteMeta(meta);

    const note = await prisma.note.create({
      data: {
        userId: req.user.id,
        title: title || 'Untitled',
        content: content || '',
        category: category || null,
        ...(Object.keys(cleanMeta).length ? { meta: cleanMeta } : {})
      },
      include: noteInclude
    });

    if (tags && tags.length > 0) {
      await syncTags(req.user.id, note.id, tags);
    }

    await syncLinks(req.user.id, note.id, content || '');

    // Re-fetch with tags
    const updated = await prisma.note.findUnique({
      where: { id: note.id },
      include: noteInclude
    });

    // Lets other open windows (e.g. after quick capture) refresh their note list.
    const io = req.app.get('io');
    if (io) io.to(req.user.id).emit('notes_changed');

    res.status(201).json({ note: formatNote(updated) });
  } catch (error) {
    next(error);
  }
}

export async function updateNote(req: any, res: any, next: any) {
  try {
    const { title, content, category, isArchived, tags, meta, baseUpdatedAt, baseContent, force, keepBoth } = req.body;

    // An editor that tells us what it started from gets a safe save: if the note changed elsewhere meanwhile
    // (another window, a shared-link editor), the changes are merged instead of one side being overwritten.
    let merged: { status: string; content: string; updatedAt: Date } | null = null;
    if (typeof content === 'string' && baseUpdatedAt) {
      const r = await saveNoteMerged(
        { id: req.params.id, userId: req.user.id },
        { content, title: typeof title === 'string' ? title : undefined, baseUpdatedAt, baseContent: typeof baseContent === 'string' ? baseContent : null, force: !!force, keepBoth: !!keepBoth },
      );
      if (r.status === 'missing') return res.status(404).json({ error: 'Note not found' });
      if (r.status === 'conflict') return res.status(409).json({ error: 'This note changed somewhere else while you were editing.', latest: r.latest });
      merged = r;
      await syncLinks(req.user.id, req.params.id, r.content);
    }

    const data: any = {};
    if (title !== undefined && !merged) data.title = title;
    if (content !== undefined && !merged) data.content = content;
    if (category !== undefined) data.category = category || null;
    if (isArchived !== undefined) data.isArchived = isArchived;
    if (meta !== undefined) {
      // a favourite or an emoji is not an edit of the text: keep the "last edited" time as it was
      const cur = await prisma.note.findFirst({ where: { id: req.params.id, userId: req.user.id }, select: { meta: true, updatedAt: true } });
      if (cur) {
        data.meta = cleanNoteMeta(meta, cur.meta);
        if (Object.keys(data).length === 1 && tags === undefined) data.updatedAt = cur.updatedAt;
      }
    }

    // the text before this edit is kept as a version (at most one every 10 minutes while editing)
    const before = content !== undefined && !merged
      ? await prisma.note.findFirst({ where: { id: req.params.id, userId: req.user.id }, select: { content: true } })
      : null;

    // Changing only the tags still counts as an edit. (An empty update would match nothing and wrongly answer 404.)
    if (tags !== undefined && Object.keys(data).length === 0) data.updatedAt = new Date();

    // Use updateMany to enforce userId ownership safely in a single query
    const { count } = Object.keys(data).length
      ? await prisma.note.updateMany({ where: { id: req.params.id, userId: req.user.id }, data })
      : { count: await prisma.note.count({ where: { id: req.params.id, userId: req.user.id } }) };

    if (count === 0) {
      return res.status(404).json({ error: 'Note not found' });
    }
    if (before && before.content !== content) await saveVersion(req.params.id, before.content || '').catch(() => {});
    if (content !== undefined && !merged) await syncLinks(req.user.id, req.params.id, content);

    if (tags !== undefined) {
      await syncTags(req.user.id, req.params.id, tags);
    }

    notify(req, 'notes_changed');
    // Return early to save an extra sequential database lookup
    if (merged) {
      const fresh = Object.keys(data).length ? await prisma.note.findUnique({ where: { id: req.params.id }, select: { updatedAt: true } }) : null;
      return res.json({ message: 'Note updated', status: merged.status, updatedAt: fresh?.updatedAt ?? merged.updatedAt, ...(merged.status !== 'saved' ? { content: merged.content } : {}) });
    }
    res.json({ message: 'Note updated' });
  } catch (error) {
    next(error);
  }
}

export async function deleteNote(req: any, res: any, next: any) {
  try {
    const noteId = req.params.id;
    const userId = req.user.id;

    // Try soft-delete first (move to trash) — single query with ownership check
    const { count: softDeleted } = await prisma.note.updateMany({
      where: { id: noteId, userId, isDeleted: false },
      data: { isDeleted: true, deletedAt: new Date(), isArchived: false }
    });

    if (softDeleted > 0) {
      notify(req, 'notes_changed');
      return res.json({ message: 'Note moved to trash' });
    }

    // If not soft-deleted, it might already be in trash — permanently delete
    const { count: hardDeleted } = await prisma.note.deleteMany({
      where: { id: noteId, userId, isDeleted: true }
    });

    if (hardDeleted > 0) {
      notify(req, 'notes_changed');
      return res.json({ message: 'Note permanently deleted' });
    }

    return res.status(404).json({ error: 'Note not found' });
  } catch (error) {
    next(error);
  }
}

export async function restoreNote(req: any, res: any, next: any) {
  try {
    // Single updateMany enforces ownership without a separate findFirst
    const { count } = await prisma.note.updateMany({
      where: { id: req.params.id, userId: req.user.id },
      data: { isDeleted: false, deletedAt: null }
    });

    if (count === 0) {
      return res.status(404).json({ error: 'Note not found' });
    }

    // Fetch the restored note for the response
    const note = await prisma.note.findUnique({
      where: { id: req.params.id },
      include: noteInclude
    });

    notify(req, 'notes_changed');
    res.json({ note: formatNote(note) });
  } catch (error) {
    next(error);
  }
}

export async function archiveNote(req: any, res: any, next: any) {
  try {
    const existing = await prisma.note.findFirst({
      where: { id: req.params.id, userId: req.user.id }
    });
    if (!existing) {
      return res.status(404).json({ error: 'Note not found' });
    }

    const note = await prisma.note.update({
      where: { id: req.params.id },
      data: { isArchived: !existing.isArchived },
      include: noteInclude
    });

    notify(req, 'notes_changed');
    res.json({ note: formatNote(note) });
  } catch (error) {
    next(error);
  }
}

export async function getBackups(req: any, res: any, next: any) {
  try {
    // Metadata only (the text of one version is fetched on demand). If the note is not the user's, the JOIN returns 0 rows.
    const rows: any[] = await prisma.$queryRaw`
      SELECT b.id AS id, b.created_at AS "createdAt", CHAR_LENGTH(b.content) AS size, LEFT(b.content, 140) AS preview
      FROM note_backups b JOIN notes n ON n.id = b.note_id
      WHERE b.note_id = ${req.params.id} AND n.user_id = ${req.user.id}
      ORDER BY b.created_at DESC LIMIT 100`;
    res.json({ backups: rows.map((r) => ({ id: r.id, createdAt: r.createdAt, size: Number(r.size), preview: r.preview })) });
  } catch (error) {
    next(error);
  }
}

export async function getBackup(req: any, res: any, next: any) {
  try {
    const backup = await prisma.noteBackup.findFirst({
      where: { id: req.params.backupId, noteId: req.params.id, note: { userId: req.user.id } },
      select: { id: true, content: true, createdAt: true },
    });
    if (!backup) return res.status(404).json({ error: 'Backup not found' });
    res.json({ backup });
  } catch (error) {
    next(error);
  }
}

export async function revertBackup(req: any, res: any, next: any) {
  try {
    const existing = await prisma.note.findFirst({
      where: { id: req.params.id, userId: req.user.id }
    });
    if (!existing) return res.status(404).json({ error: 'Note not found' });

    const backup = await prisma.noteBackup.findUnique({
      where: { id: req.params.backupId }
    });
    if (!backup || backup.noteId !== req.params.id) {
      return res.status(404).json({ error: 'Backup not found' });
    }

    // the text being replaced is kept first, so a restore can itself be undone
    await saveVersion(req.params.id, existing.content || '', { force: true });
    const note = await prisma.note.update({
      where: { id: req.params.id },
      data: { content: backup.content },
      include: noteInclude
    });
    await syncLinks(req.user.id, req.params.id, backup.content || '');

    notify(req, 'notes_changed');
    res.json({ note: formatNote(note) });
  } catch (error) {
    next(error);
  }
}

export async function saveEmbeddingForNote(userId: string, noteId: string, title: string, content: string) {
  try {
    // a #private note (or one in the Trash) is never sent to a model, not even to be indexed
    const here = await prisma.note.findFirst({ where: { id: noteId, userId, isDeleted: false }, select: { tags: { select: { tag: { select: { name: true } } } } } });
    if (!here || here.tags.some((t) => t.tag.name === 'private')) return;
    const text = `Title: ${title}\n\nContent: ${content}`;
    const embedding = await aiService.generateEmbedding(userId, text);
    if (embedding && embedding.length > 0) {
      await prisma.noteEmbedding.upsert({
        where: { noteId },
        update: { vector: JSON.stringify(embedding) },
        create: { noteId, vector: JSON.stringify(embedding) }
      });
    }
  } catch (error) {
    console.error('Failed to save embedding for note:', noteId, error);
  }
}

/** Notes that link to this one. A link is written as a normal Markdown link to /notes/<id>, so it survives export and import. */
export async function getBacklinks(req: any, res: any, next: any) {
  try {
    const id = String(req.params.id);
    const rows = await prisma.$queryRaw`
      SELECT n.id, n.title, n.updated_at AS "updatedAt"
      FROM note_links l JOIN notes n ON n.id = l.source_id
      WHERE l.target_id = ${id} AND n.user_id = ${req.user.id} AND n.is_deleted = false AND n.id <> ${id}
      ORDER BY n.updated_at DESC LIMIT 50`;
    res.json({ backlinks: rows });
  } catch (error) {
    next(error);
  }
}

const DAILY_BODY = '## Today I did\n\n- \n\n## What I learned\n\n- \n\n## Tomorrow\n\n- \n\n';

/** Today's note: opens it if it exists, otherwise makes it. The client sends its own local date so time zones cannot shift the day. */
export async function openDailyNote(req: any, res: any, next: any) {
  try {
    const date = String(req.body?.date || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'date must look like 2026-10-21' });
    const title = `Daily note ${date}`;
    const existing = await prisma.note.findFirst({ where: { userId: req.user.id, isDeleted: false, title }, include: noteInclude });
    if (existing) return res.json({ note: formatNote(existing), created: false });
    const made = await prisma.note.create({ data: { userId: req.user.id, title, content: DAILY_BODY }, include: noteInclude });
    res.status(201).json({ note: formatNote(made), created: true });
  } catch (error) {
    next(error);
  }
}

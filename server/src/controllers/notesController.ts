import { Request, Response, NextFunction } from 'express';
import prisma from '../db.js';
import { v4 as uuidv4 } from 'uuid';
import * as aiService from '../services/aiService.js';

// prisma imported from db.js

// Optimized helper to sync tags: checks for changes first, resolves concurrently, and uses bulk insertions
export async function syncTags(noteId: any, tagNames: any) {
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

  // Bulk fetch existing tags to avoid N+1 sequential queries
  const existingTags = await prisma.tag.findMany({
    where: { name: { in: normalizedInput } }
  });
  
  const existingTagNames = existingTags.map((t: any) => t.name);
  const missingTagNames = normalizedInput.filter((name: any) => !existingTagNames.includes(name)) as string[];

  let newTags: any[] = [];
  if (missingTagNames.length > 0) {
    // Bulk create missing tags (Prisma createMany returns count, not records, so we re-fetch)
    await prisma.tag.createMany({
      data: missingTagNames.map((name: any) => ({ name })),
      skipDuplicates: true
    });
    newTags = await prisma.tag.findMany({
      where: { name: { in: missingTagNames } }
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
    hasSummary: note.aiGenerations ? note.aiGenerations.some((ai: any) => ai.type === 'summary') : false,
    linkedTodos: note.linkedTodos || []
  };
}

export async function getNotes(req: any, res: any, next: any) {
  try {
    const { search, tag, category, sort = 'updated', archived, deleted } = req.query;
    const userId = req.user.id;

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
      where.OR = [
        { title: { contains: search } },
        { content: { contains: search } }
      ];
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
        isPublic: true,
        createdAt: true,
        updatedAt: true,
        tags: {
          select: { tag: true }
        },
        aiGenerations: {
          select: { type: true }
        }
      },
      orderBy,
      take: 50 // Limit notes returned to optimize Workspace sidebar loading speed
    });

    res.json({ notes: notes.map(formatNote) });
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
    const { title, content, category, tags } = req.body;

    const note = await prisma.note.create({
      data: {
        userId: req.user.id,
        title: title || 'Untitled',
        content: content || '',
        category: category || null
      },
      include: noteInclude
    });

    if (tags && tags.length > 0) {
      await syncTags(note.id, tags);
    }

    // Re-fetch with tags
    const updated = await prisma.note.findUnique({
      where: { id: note.id },
      include: noteInclude
    });

    res.status(201).json({ note: formatNote(updated) });
  } catch (error) {
    next(error);
  }
}

export async function updateNote(req: any, res: any, next: any) {
  try {
    const { title, content, category, isArchived, isPublic, tags } = req.body;

    const data: any = {};
    if (title !== undefined) data.title = title;
    if (content !== undefined) data.content = content;
    if (category !== undefined) data.category = category || null;
    if (isArchived !== undefined) data.isArchived = isArchived;
    if (isPublic !== undefined) data.isPublic = isPublic;

    // Use updateMany to enforce userId ownership safely in a single query
    const { count } = await prisma.note.updateMany({
      where: { id: req.params.id, userId: req.user.id },
      data
    });

    if (count === 0) {
      return res.status(404).json({ error: 'Note not found' });
    }

    if (tags !== undefined) {
      await syncTags(req.params.id, tags);
    }

    // Return early to save an extra sequential database lookup
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
      return res.json({ message: 'Note moved to trash' });
    }

    // If not soft-deleted, it might already be in trash — permanently delete
    const { count: hardDeleted } = await prisma.note.deleteMany({
      where: { id: noteId, userId, isDeleted: true }
    });

    if (hardDeleted > 0) {
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

    res.json({ note: formatNote(note) });
  } catch (error) {
    next(error);
  }
}

export async function shareNote(req: any, res: any, next: any) {
  try {
    const existing = await prisma.note.findFirst({
      where: { id: req.params.id, userId: req.user.id }
    });
    if (!existing) {
      return res.status(404).json({ error: 'Note not found' });
    }

    // Toggle sharing
    const isPublic = !existing.isPublic;
    const shareId = isPublic ? uuidv4().slice(0, 12) : null;

    const note = await prisma.note.update({
      where: { id: req.params.id },
      data: { isPublic, shareId },
      include: noteInclude
    });

    res.json({ note: formatNote(note) });
  } catch (error) {
    next(error);
  }
}

export async function getBackups(req: any, res: any, next: any) {
  try {
    // Single query — if the note doesn't belong to the user, the JOIN returns 0 rows
    const backups = await prisma.$queryRaw<any[]>`
      SELECT b.id, b.content, b.created_at AS "createdAt"
      FROM note_backups b
      JOIN notes n ON n.id = b.note_id
      WHERE b.note_id = ${req.params.id} AND n.user_id = ${req.user.id}
      ORDER BY b.created_at DESC
    `;

    res.json({ backups });
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

    const note = await prisma.note.update({
      where: { id: req.params.id },
      data: { content: backup.content },
      include: noteInclude
    });

    res.json({ note: formatNote(note) });
  } catch (error) {
    next(error);
  }
}

export async function saveEmbeddingForNote(userId: string, noteId: string, title: string, content: string) {
  try {
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

import prisma from '../db.js';
import { v4 as uuidv4 } from 'uuid';

// prisma imported from db.js

// Optimized helper to sync tags: checks for changes first, resolves concurrently, and uses bulk insertions
async function syncTags(noteId, tagNames) {
  const normalizedInput = Array.from(
    new Set((tagNames || []).map((t) => t.trim().toLowerCase()).filter(Boolean))
  ).sort();

  // Fetch current tag names associated with the note
  const currentAssociations = await prisma.noteTag.findMany({
    where: { noteId },
    include: { tag: true }
  });
  const normalizedCurrent = currentAssociations.map((ca) => ca.tag.name.trim().toLowerCase()).sort();

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
  
  const existingTagNames = existingTags.map(t => t.name);
  const missingTagNames = normalizedInput.filter(name => !existingTagNames.includes(name));

  let newTags = [];
  if (missingTagNames.length > 0) {
    // Bulk create missing tags (Prisma createMany returns count, not records, so we re-fetch)
    await prisma.tag.createMany({
      data: missingTagNames.map(name => ({ name })),
      skipDuplicates: true
    });
    newTags = await prisma.tag.findMany({
      where: { name: { in: missingTagNames } }
    });
  }

  const allResolvedTags = [...existingTags, ...newTags];

  // Bulk associate tags with the note
  await prisma.noteTag.createMany({
    data: allResolvedTags.map((tag) => ({ noteId, tagId: tag.id }))
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
function formatNote(note) {
  return {
    ...note,
    tags: note.tags ? note.tags.map(nt => nt.tag.name) : [],
    hasSummary: note.aiGenerations ? note.aiGenerations.some(ai => ai.type === 'summary') : false,
    linkedTodos: note.linkedTodos || []
  };
}

export async function getNotes(req, res, next) {
  try {
    const { search, tag, category, sort = 'updated', archived } = req.query;
    const userId = req.user.id;

    const where = { userId };

    // Archive filter
    where.isArchived = archived === 'true';

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

export async function getNote(req, res, next) {
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

export async function createNote(req, res, next) {
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

export async function updateNote(req, res, next) {
  try {
    const { title, content, category, isArchived, isPublic, tags } = req.body;

    const data = {};
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

export async function deleteNote(req, res, next) {
  try {
    const existing = await prisma.note.findFirst({
      where: { id: req.params.id, userId: req.user.id }
    });
    if (!existing) {
      return res.status(404).json({ error: 'Note not found' });
    }

    await prisma.note.delete({ where: { id: req.params.id } });
    res.json({ message: 'Note deleted' });
  } catch (error) {
    next(error);
  }
}

export async function archiveNote(req, res, next) {
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

export async function shareNote(req, res, next) {
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

export async function getBackups(req, res, next) {
  try {
    const existing = await prisma.note.findFirst({
      where: { id: req.params.id, userId: req.user.id }
    });
    if (!existing) return res.status(404).json({ error: 'Note not found' });

    const backups = await prisma.noteBackup.findMany({
      where: { noteId: req.params.id },
      orderBy: { createdAt: 'desc' }
    });

    res.json({ backups });
  } catch (error) {
    next(error);
  }
}

export async function revertBackup(req, res, next) {
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

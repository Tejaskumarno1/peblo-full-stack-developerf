import { PrismaClient } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';

const prisma = new PrismaClient();

// Helper to sync tags: find-or-create each tag, then connect to note
async function syncTags(noteId, tagNames) {
  // Remove existing tag associations
  await prisma.noteTag.deleteMany({ where: { noteId } });

  if (!tagNames || tagNames.length === 0) return;

  for (const name of tagNames) {
    const trimmed = name.trim().toLowerCase();
    if (!trimmed) continue;

    let tag = await prisma.tag.findUnique({ where: { name: trimmed } });
    if (!tag) {
      tag = await prisma.tag.create({ data: { name: trimmed } });
    }
    await prisma.noteTag.create({ data: { noteId, tagId: tag.id } });
  }
}

// Include clause for notes with tags and AI metadata
const noteInclude = {
  tags: {
    include: { tag: true }
  },
  aiGenerations: {
    select: { type: true }
  }
};

// Format note for API response
function formatNote(note) {
  return {
    ...note,
    tags: note.tags ? note.tags.map(nt => nt.tag.name) : [],
    hasSummary: note.aiGenerations ? note.aiGenerations.some(ai => ai.type === 'summary') : false
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
      orderBy
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
    const { title, content, category, tags } = req.body;

    // Verify ownership
    const existing = await prisma.note.findFirst({
      where: { id: req.params.id, userId: req.user.id }
    });
    if (!existing) {
      return res.status(404).json({ error: 'Note not found' });
    }

    const data = {};
    if (title !== undefined) data.title = title;
    if (content !== undefined) data.content = content;
    if (category !== undefined) data.category = category || null;

    await prisma.note.update({
      where: { id: req.params.id },
      data
    });

    if (tags !== undefined) {
      await syncTags(req.params.id, tags);
    }

    const note = await prisma.note.findUnique({
      where: { id: req.params.id },
      include: noteInclude
    });

    res.json({ note: formatNote(note) });
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

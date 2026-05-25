import { PrismaClient } from '@prisma/client';
import * as aiService from '../services/aiService.js';

const prisma = new PrismaClient();

const noteInclude = {
  tags: { include: { tag: true } },
  aiGenerations: { select: { type: true } },
};

function formatNote(note) {
  return {
    ...note,
    tags: note.tags ? note.tags.map((nt) => nt.tag.name) : [],
    hasSummary: note.aiGenerations?.some((ai) => ai.type === 'summary') ?? false,
  };
}

async function syncTags(noteId, tagNames) {
  await prisma.noteTag.deleteMany({ where: { noteId } });
  if (!tagNames?.length) return;

  for (const name of tagNames) {
    const trimmed = name.trim().toLowerCase();
    if (!trimmed) continue;
    let tag = await prisma.tag.findUnique({ where: { name: trimmed } });
    if (!tag) tag = await prisma.tag.create({ data: { name: trimmed } });
    await prisma.noteTag.create({ data: { noteId, tagId: tag.id } });
  }
}

async function createNoteForUser(userId, { title, content, category, tags }) {
  const note = await prisma.note.create({
    data: {
      userId,
      title: title || 'Untitled',
      content: content || '',
      category: category || null,
    },
    include: noteInclude,
  });

  if (tags?.length) await syncTags(note.id, tags);

  const updated = await prisma.note.findUnique({
    where: { id: note.id },
    include: noteInclude,
  });

  return formatNote(updated);
}

export async function chatAndCreateNotes(req, res, next) {
  try {
    const { message, mode = 'create', noteId } = req.body;

    if (!message?.trim()) {
      return res.status(400).json({ error: 'Message is required' });
    }

    const userId = req.user.id;

    const recentNotes = await prisma.note.findMany({
      where: { userId, isArchived: false },
      select: { id: true, title: true },
      orderBy: { updatedAt: 'desc' },
      take: 25,
    });

    let targetNote = null;
    if (mode === 'append' && noteId) {
      targetNote = await prisma.note.findFirst({
        where: { id: noteId, userId },
        select: { id: true, title: true, content: true },
      });
      if (!targetNote) {
        return res.status(404).json({ error: 'Note not found' });
      }
    }

    const plan = await aiService.chatPlanNotes({
      message: message.trim(),
      mode: mode === 'append' ? 'append' : 'create',
      targetNote,
      existingNotes: recentNotes.map((n) => ({ id: n.id, title: n.title })),
    });

    const createdNotes = [];
    let updatedNote = null;

    const updateExistingNote = async (id, appendContent, replaceContent) => {
      const existing = await prisma.note.findFirst({
        where: { id, userId },
      });
      if (!existing || (!appendContent?.trim() && !replaceContent?.trim())) return null;

      let newContent = existing.content || '';
      if (replaceContent?.trim()) {
        newContent = replaceContent.trim();
      } else if (appendContent?.trim()) {
        const separator = existing.content?.trim() ? '\n\n---\n\n' : '';
        newContent = `${existing.content || ''}${separator}${appendContent.trim()}`;
      }

      await prisma.noteBackup.create({
        data: { noteId: existing.id, content: existing.content || '' }
      });

      const oldBackups = await prisma.noteBackup.findMany({
        where: { noteId: existing.id },
        orderBy: { createdAt: 'desc' },
        skip: 5
      });
      if (oldBackups.length > 0) {
        await prisma.noteBackup.deleteMany({
          where: { id: { in: oldBackups.map(b => b.id) } }
        });
      }

      await prisma.note.update({
        where: { id: existing.id },
        data: { content: newContent },
      });

      await prisma.aiGeneration.create({
        data: {
          noteId: existing.id,
          userId,
          type: 'chat',
          result: JSON.stringify({ source: 'dashboard_chat_update' }),
        },
      });

      const refetched = await prisma.note.findUnique({
        where: { id: existing.id },
        include: noteInclude,
      });
      return formatNote(refetched);
    };

    if (plan.updateNote?.noteId && (plan.updateNote.appendContent || plan.updateNote.replaceContent)) {
      updatedNote = await updateExistingNote(plan.updateNote.noteId, plan.updateNote.appendContent, plan.updateNote.replaceContent);
    } else if (mode === 'append' && targetNote) {
      const appendContent = plan.notes[0]?.content || `## AI addition\n\n${message.trim()}`;
      updatedNote = await updateExistingNote(targetNote.id, appendContent, null);
      plan.notes = [];
    }

    for (const draft of plan.notes) {
      if (!draft?.title && !draft?.content) continue;
      const note = await createNoteForUser(userId, draft);
      createdNotes.push(note);

      await prisma.aiGeneration.create({
        data: {
          noteId: note.id,
          userId,
          type: 'chat',
          result: JSON.stringify({ source: 'dashboard_chat', message: message.trim() }),
        },
      });
    }

    res.json({
      reply: plan.reply,
      notes: createdNotes,
      updatedNote,
    });
  } catch (error) {
    next(error);
  }
}

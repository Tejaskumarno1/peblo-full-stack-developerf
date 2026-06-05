import prisma from '../db.js';
import * as aiService from '../services/aiService.js';
import pdf from 'pdf-parse/lib/pdf-parse.js';

// prisma imported from db.js

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

export async function chatStream(req, res, next) {
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

    // Call the streaming service! This function will pipe 'chunk' events to `res`
    const plan = await aiService.chatPlanNotesStream({
      message: message.trim(),
      mode: mode === 'append' ? 'append' : 'create',
      targetNote,
      existingNotes: recentNotes.map((n) => ({ id: n.id, title: n.title })),
    }, res);

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

    // Send final completion event with the DB records
    res.write(`data: ${JSON.stringify({ done: true, reply: plan.reply, notes: createdNotes, updatedNote })}\n\n`);
    res.end();
  } catch (error) {
    console.error('Streaming error:', error);
    res.write(`data: ${JSON.stringify({ error: 'AI processing failed' })}\n\n`);
    res.end();
  }
}

export async function smartIntake(req, res, next) {
  try {
    const { rawData, template } = req.body;

    if (!rawData?.trim()) {
      return res.status(400).json({ error: 'Raw data is required' });
    }

    const userId = req.user.id;

    // Step 1: AI analyzes and organizes the raw data
    const result = await aiService.analyzeAndOrganize(rawData.trim(), template || 'auto');

    // Step 2: Create the note
    const note = await createNoteForUser(userId, result.note);

    // Log AI generation
    await prisma.aiGeneration.create({
      data: {
        noteId: note.id,
        userId,
        type: 'smart_intake',
        result: JSON.stringify({ source: 'smart_intake', tasksExtracted: result.tasks.length }),
      },
    });

    // Step 3: Create all extracted todos linked to this note
    const createdTodos = [];
    for (const task of result.tasks) {
      const validPriorities = ['high', 'medium', 'low'];
      let deadline = null;
      if (task.deadline) {
        try {
          const parsed = new Date(task.deadline);
          if (!isNaN(parsed.getTime())) deadline = parsed;
        } catch (e) { /* skip invalid dates */ }
      }

      const todo = await prisma.todo.create({
        data: {
          text: task.text.trim(),
          priority: validPriorities.includes(task.priority) ? task.priority : 'medium',
          deadline,
          startTime: task.startTime || null,
          endTime: task.endTime || null,
          todoTags: Array.isArray(task.tags) ? task.tags.map(t => t.trim()).filter(Boolean) : [],
          noteId: note.id,
          userId,
        },
        include: { note: { select: { id: true, title: true } } }
      });
      createdTodos.push(todo);
    }

    res.json({
      reply: result.reply,
      note,
      todos: createdTodos,
    });
  } catch (error) {
    next(error);
  }
}

export async function smartIntakeUpload(req, res, next) {
  try {
    const userId = req.user.id;
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    let rawData = '';
    
    // Simple MIME type check
    if (req.file.mimetype === 'application/pdf') {
      const data = await pdf(req.file.buffer);
      rawData = data.text;
    } else if (req.file.mimetype === 'text/plain') {
      rawData = req.file.buffer.toString('utf8');
    } else {
      return res.status(400).json({ error: 'Unsupported file type. Please upload a PDF or TXT file.' });
    }

    if (!rawData || !rawData.trim()) {
      return res.status(400).json({ error: 'Could not extract any text from the file.' });
    }

    // Call the same AI service logic
    const result = await aiService.generateSmartIntake(rawData, 'auto');

    // Step 1: Create Note
    const note = await prisma.note.create({
      data: {
        title: result.title || 'Parsed File Intake',
        content: result.content || '',
        userId,
      },
    });

    if (result.tags && result.tags.length > 0) {
      await syncTags(note.id, result.tags);
    }

    await prisma.aiGeneration.create({
      data: {
        noteId: note.id,
        userId,
        type: 'smart_intake_file',
        result: JSON.stringify({ source: 'file_upload', tasksExtracted: result.tasks.length }),
      },
    });

    // Step 2: Create Todos
    const createdTodos = [];
    for (const task of result.tasks) {
      const validPriorities = ['high', 'medium', 'low'];
      let deadline = null;
      if (task.deadline) {
        try {
          const parsed = new Date(task.deadline);
          if (!isNaN(parsed.getTime())) deadline = parsed;
        } catch (e) { /* skip */ }
      }

      const todo = await prisma.todo.create({
        data: {
          text: task.text.trim(),
          priority: validPriorities.includes(task.priority) ? task.priority : 'medium',
          deadline,
          startTime: task.startTime || null,
          endTime: task.endTime || null,
          todoTags: Array.isArray(task.tags) ? task.tags.map(t => t.trim()).filter(Boolean) : [],
          noteId: note.id,
          userId,
        },
        include: { note: { select: { id: true, title: true } } }
      });
      createdTodos.push(todo);
    }

    res.json({
      reply: `I successfully processed your file! ${result.reply}`,
      note,
      todos: createdTodos,
    });
  } catch (error) {
    next(error);
  }
}

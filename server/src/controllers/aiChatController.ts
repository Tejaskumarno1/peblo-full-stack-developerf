import { Request, Response, NextFunction } from 'express';
import { notify } from '../utils/notify.js';
import { tzOf } from '../utils/userTime.js';
import prisma from '../db.js';
import { saveVersion } from '../services/noteVersions.js';
import * as aiService from '../services/aiService.js';
import pdf from 'pdf-parse/lib/pdf-parse.js';
import { aiReadableWhere, noteAiAccess, decideChatUpdate, PRIVATE_MESSAGE } from '../utils/aiAccess.js';

// prisma imported from db.js

const noteInclude = {
  tags: { include: { tag: true } },
  aiGenerations: { select: { type: true } },
};

function formatNote(note: any) {
  return {
    ...note,
    tags: note.tags ? note.tags.map((nt: any) => nt.tag.name) : [],
    hasSummary: note.aiGenerations?.some((ai: any) => ai.type === 'summary') ?? false,
  };
}

// Tags are scoped per user, so two users can each have their own tag of the same name.
async function syncTags(userId: string, noteId: string, tagNames: string[] | undefined) {
  await prisma.noteTag.deleteMany({ where: { noteId } });
  if (!tagNames?.length) return;

  const seen = new Set<string>();
  for (const name of tagNames) {
    const trimmed = typeof name === 'string' ? name.trim().toLowerCase() : '';
    if (!trimmed || seen.has(trimmed)) continue; // a repeated tag would break the (note, tag) pair
    seen.add(trimmed);
    let tag = await prisma.tag.findUnique({ where: { userId_name: { userId, name: trimmed } } });
    if (!tag) tag = await prisma.tag.create({ data: { userId, name: trimmed } });
    await prisma.noteTag.create({ data: { noteId, tagId: tag.id } });
  }
}

async function createNoteForUser(userId: string, { title, content, category, tags }: { title?: string; content?: string; category?: string | null; tags?: string[] }) {
  const note = await prisma.note.create({
    data: {
      userId,
      title: title || 'Untitled',
      content: content || '',
      category: category || null,
    },
    include: noteInclude,
  });

  if (tags?.length) await syncTags(userId, note.id, tags);

  const updated = await prisma.note.findUnique({
    where: { id: note.id },
    include: noteInclude,
  });

  return formatNote(updated);
}

/**
 * Adds to, or rewrites, one of this person's notes. The text before the change is kept as a version (the last 5),
 * so it can be undone from the note's history. Notes in the Trash are left alone.
 */
export async function applyNoteUpdate(userId: string, id: string, appendContent: string | null, replaceContent: string | null) {
  const existing = await prisma.note.findFirst({ where: { id, userId, isDeleted: false, deletedAt: null } });
  if (!existing || (!appendContent?.trim() && !replaceContent?.trim())) return null;

  let newContent = existing.content || '';
  if (replaceContent?.trim()) {
    newContent = replaceContent.trim();
  } else if (appendContent?.trim()) {
    const separator = existing.content?.trim() ? '\n\n---\n\n' : '';
    newContent = `${existing.content || ''}${separator}${appendContent.trim()}`;
  }

  await saveVersion(existing.id, existing.content || '', { force: true });

  await prisma.note.update({ where: { id: existing.id }, data: { content: newContent } });
  await prisma.aiGeneration.create({
    data: { noteId: existing.id, userId, type: 'chat', result: JSON.stringify({ source: 'dashboard_chat_update' }) },
  });
  const refetched = await prisma.note.findUnique({ where: { id: existing.id }, include: noteInclude });
  return formatNote(refetched);
}

/** The person said yes to a suggested change to one of their notes. */
export async function applyChatUpdate(req: Request, res: Response, next: NextFunction) {
  try {
    const { noteId, appendContent, replaceContent } = req.body || {};
    if (typeof noteId !== 'string' || !noteId) return res.status(400).json({ error: 'Which note?' });
    const add = typeof appendContent === 'string' ? appendContent : null;
    const rewrite = typeof replaceContent === 'string' ? replaceContent : null;
    if (!add?.trim() && !rewrite?.trim()) return res.status(400).json({ error: 'There is nothing to add.' });
    if (Math.max(add?.length || 0, rewrite?.length || 0) > 200_000) return res.status(413).json({ error: 'That is too long for one note.' });
    const note = await applyNoteUpdate(req.user!.id, noteId, add, rewrite);
    if (!note) return res.status(404).json({ error: 'Note not found' });
    notify(req, 'notes_changed');
    res.json({ note });
  } catch (error) {
    next(error);
  }
}

export async function chatAndCreateNotes(req: Request, res: Response, next: NextFunction) {
  try {
    const { message, mode = 'create', noteId } = req.body;

    if (!message?.trim()) {
      return res.status(400).json({ error: 'Message is required' });
    }

    const userId = req.user!.id;

    const recentNotes = await prisma.note.findMany({
      where: { ...aiReadableWhere(userId), isArchived: false },
      select: { id: true, title: true },
      orderBy: { updatedAt: 'desc' },
      take: 25,
    });

    let targetNote: any = null;
    if (mode === 'append' && noteId) {
      const access = await noteAiAccess(userId, noteId as string);
      if (access === 'private') return res.status(400).json({ error: PRIVATE_MESSAGE });
      targetNote = access === 'ok' ? await prisma.note.findFirst({
        where: { id: noteId as string, userId },
        select: { id: true, title: true, content: true },
      }) : null;
      if (!targetNote) {
        return res.status(404).json({ error: 'Note not found' });
      }
    }

    const plan = await aiService.chatPlanNotes(userId, {
      message: message.trim(),
      mode: mode === 'append' ? 'append' : 'create',
      targetNote,
      existingNotes: recentNotes.map((n) => ({ id: n.id, title: n.title })),
    });

    const createdNotes: any[] = [];
    let updatedNote: any = null;

    const updateExistingNote = (id: string, appendContent: string | null, replaceContent: string | null) => applyNoteUpdate(userId, id, appendContent, replaceContent);

    // A change to the note the person picked is applied (and can be undone from its history); a change to any
    // other note is only suggested, and the person decides.
    const decision = decideChatUpdate({ targetNoteId: mode === 'append' ? targetNote?.id : null, plan: plan.updateNote, offered: recentNotes });
    const suggestedUpdate = decision.suggest;
    if (decision.apply) {
      updatedNote = await updateExistingNote(decision.apply.noteId, decision.apply.appendContent, decision.apply.replaceContent);
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

    notify(req, 'notes_changed', 'todos_changed');
    res.json({
      reply: plan.reply,
      notes: createdNotes,
      updatedNote,
      suggestedUpdate,
    });
  } catch (error) {
    next(error);
  }
}

export async function chatStream(req: Request, res: Response, next: NextFunction) {
  try {
    const { message, mode = 'create', noteId } = req.body;

    if (!message?.trim()) {
      return res.status(400).json({ error: 'Message is required' });
    }

    const userId = req.user!.id;

    const recentNotes = await prisma.note.findMany({
      where: { ...aiReadableWhere(userId), isArchived: false },
      select: { id: true, title: true },
      orderBy: { updatedAt: 'desc' },
      take: 25,
    });

    let targetNote: any = null;
    if (mode === 'append' && noteId) {
      const access = await noteAiAccess(userId, noteId as string);
      if (access === 'private') return res.status(400).json({ error: PRIVATE_MESSAGE });
      targetNote = access === 'ok' ? await prisma.note.findFirst({
        where: { id: noteId as string, userId },
        select: { id: true, title: true, content: true },
      }) : null;
      if (!targetNote) {
        return res.status(404).json({ error: 'Note not found' });
      }
    }

    // Call the streaming service! This function will pipe 'chunk' events to `res`
    const plan = await aiService.chatPlanNotesStream(userId, {
      message: message.trim(),
      mode: mode === 'append' ? 'append' : 'create',
      targetNote,
      existingNotes: recentNotes.map((n) => ({ id: n.id, title: n.title })),
    }, res);

    const createdNotes: any[] = [];
    let updatedNote: any = null;

    const updateExistingNote = (id: string, appendContent: string | null, replaceContent: string | null) => applyNoteUpdate(userId, id, appendContent, replaceContent);

    // A change to the note the person picked is applied (and can be undone from its history); a change to any
    // other note is only suggested, and the person decides.
    const decision = decideChatUpdate({ targetNoteId: mode === 'append' ? targetNote?.id : null, plan: plan.updateNote, offered: recentNotes });
    const suggestedUpdate = decision.suggest;
    if (decision.apply) {
      updatedNote = await updateExistingNote(decision.apply.noteId, decision.apply.appendContent, decision.apply.replaceContent);
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

    notify(req, 'notes_changed', 'todos_changed');
    // Send final completion event with the DB records
    res.write(`data: ${JSON.stringify({ done: true, reply: plan.reply, notes: createdNotes, updatedNote, suggestedUpdate })}\n\n`);
    res.end();
  } catch (error) {
    console.error('Streaming error:', error);
    if (!res.headersSent) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
    }
    const message = (error as any)?.code === 'NO_AI_KEY' ? (error as any).message : 'AI processing failed';
    res.write(`data: ${JSON.stringify({ error: message })}\n\n`);
    res.end();
  }
}

export async function smartIntake(req: Request, res: Response, next: NextFunction) {
  try {
    const { rawData, template } = req.body;

    if (!rawData?.trim()) {
      return res.status(400).json({ error: 'Raw data is required' });
    }

    const userId = req.user!.id;

    // Step 1: AI analyzes and organizes the raw data
    const result = await aiService.analyzeAndOrganize(userId, rawData.trim(), template || 'auto', tzOf(req));

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

    // Step 3: Create all extracted todos linked to this note using createManyAndReturn
    const todosData = result.tasks.map((task: any) => {
      const validPriorities = ['high', 'medium', 'low'];
      let deadline: Date | null = null;
      if (task.deadline) {
        try {
          const parsed = new Date(task.deadline);
          if (!isNaN(parsed.getTime())) deadline = parsed;
        } catch (e) { /* skip invalid dates */ }
      }

      return {
        text: task.text.trim(),
        priority: validPriorities.includes(task.priority) ? task.priority : 'medium',
        deadline,
        startTime: task.startTime || null,
        endTime: task.endTime || null,
        todoTags: Array.isArray(task.tags) ? (task.tags as string[]).map(t => t.trim()).filter(Boolean) : [],
        noteId: note.id,
        userId,
      };
    });

    let createdTodos: any[] = [];
    if (todosData.length > 0) {
      // MySQL has no createManyAndReturn, so create them in one transaction and keep the rows.
      const inserted = await prisma.$transaction(todosData.map((data: any) => prisma.todo.create({ data })));
      createdTodos = inserted.map((t) => ({
        ...t,
        note: { id: note.id, title: note.title }
      }));
    }

    notify(req, 'notes_changed', 'todos_changed');
    res.json({
      reply: result.reply,
      note,
      todos: createdTodos,
    });
  } catch (error) {
    next(error);
  }
}

export async function smartIntakeUpload(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.id;
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
    const result = await aiService.analyzeAndOrganize(userId, rawData, 'auto', tzOf(req));

    // Step 1: Create Note
    const note = await prisma.note.create({
      data: {
        title: result.note.title || 'Parsed File Intake',
        content: result.note.content || '',
        userId,
      },
    });

    if (result.note.tags && result.note.tags.length > 0) {
      await syncTags(userId, note.id, result.note.tags);
    }

    await prisma.aiGeneration.create({
      data: {
        noteId: note.id,
        userId,
        type: 'smart_intake_file',
        result: JSON.stringify({ source: 'file_upload', tasksExtracted: result.tasks.length }),
      },
    });

    // Step 2: Create Todos using createManyAndReturn
    const todosData = result.tasks.map((task: any) => {
      const validPriorities = ['high', 'medium', 'low'];
      let deadline: Date | null = null;
      if (task.deadline) {
        try {
          const parsed = new Date(task.deadline);
          if (!isNaN(parsed.getTime())) deadline = parsed;
        } catch (e) { /* skip */ }
      }

      return {
        text: task.text.trim(),
        priority: validPriorities.includes(task.priority) ? task.priority : 'medium',
        deadline,
        startTime: task.startTime || null,
        endTime: task.endTime || null,
        todoTags: Array.isArray(task.tags) ? (task.tags as string[]).map(t => t.trim()).filter(Boolean) : [],
        noteId: note.id,
        userId,
      };
    });

    let createdTodos: any[] = [];
    if (todosData.length > 0) {
      // MySQL has no createManyAndReturn, so create them in one transaction and keep the rows.
      const inserted = await prisma.$transaction(todosData.map((data: any) => prisma.todo.create({ data })));
      createdTodos = inserted.map((t) => ({
        ...t,
        note: { id: note.id, title: note.title }
      }));
    }

    notify(req, 'notes_changed', 'todos_changed');
    res.json({
      reply: `I successfully processed your file! ${result.reply}`,
      note,
      todos: createdTodos,
    });
  } catch (error) {
    next(error);
  }
}

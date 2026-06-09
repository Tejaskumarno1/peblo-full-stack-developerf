import { Request, Response, NextFunction } from 'express';
import prisma from '../db.js';
import * as aiService from '../services/aiService.js';
import { syncTags, saveEmbeddingForNote } from './notesController.js';

export async function generateSummary(req: Request, res: Response, next: NextFunction) {
  try {
    const note = await prisma.note.findFirst({
      where: { id: req.params.id as string, userId: req.user!.id }
    });
    if (!note) {
      return res.status(404).json({ error: 'Note not found' });
    }
    const title = req.body?.title ?? note.title;
    const content = req.body?.content ?? note.content;

    if (!content || content.trim().length === 0) {
      return res.status(400).json({ error: 'Note has no content to summarize' });
    }

    const result = await aiService.generateSummary(req.user!.id, title, content);

    // Store the AI generation
    await prisma.aiGeneration.create({
      data: {
        noteId: note.id,
        userId: req.user!.id,
        type: 'summary',
        result: JSON.stringify(result)
      }
    });

    res.json(result);
  } catch (error) {
    next(error);
  }
}

export async function extractActions(req: Request, res: Response, next: NextFunction) {
  try {
    const note = await prisma.note.findFirst({
      where: { id: req.params.id as string, userId: req.user!.id }
    });
    if (!note) {
      return res.status(404).json({ error: 'Note not found' });
    }
    const title = req.body?.title ?? note.title;
    const content = req.body?.content ?? note.content;

    if (!content || content.trim().length === 0) {
      return res.status(400).json({ error: 'Note has no content to analyze' });
    }

    const result = await aiService.extractActionItems(req.user!.id, title, content);

    await prisma.aiGeneration.create({
      data: {
        noteId: note.id,
        userId: req.user!.id,
        type: 'action_items',
        result: JSON.stringify(result)
      }
    });

    res.json(result);
  } catch (error) {
    next(error);
  }
}

export async function suggestTitle(req: Request, res: Response, next: NextFunction) {
  try {
    const note = await prisma.note.findFirst({
      where: { id: req.params.id as string, userId: req.user!.id }
    });
    if (!note) {
      return res.status(404).json({ error: 'Note not found' });
    }
    const content = req.body?.content ?? note.content;

    if (!content || content.trim().length === 0) {
      return res.status(400).json({ error: 'Note has no content to generate title from' });
    }

    const result = await aiService.suggestTitle(req.user!.id, content);

    await prisma.aiGeneration.create({
      data: {
        noteId: note.id,
        userId: req.user!.id,
        type: 'title',
        result: JSON.stringify(result)
      }
    });

    res.json(result);
  } catch (error) {
    next(error);
  }
}

export async function processBlockAI(req: Request, res: Response, next: NextFunction) {
  try {
    const { text, command } = req.body;
    if (!text || !command) {
      return res.status(400).json({ error: "Text and command are required" });
    }
    const result = await aiService.processTextCommand(req.user!.id, text, command);
    res.json({ result });
  } catch (error) {
    next(error);
  }
}

export async function processVoiceCommand(req: Request, res: Response, next: NextFunction) {
  try {
    const { transcript, timezone, localTime } = req.body;
    if (!transcript) {
      return res.status(400).json({ error: "Transcript is required" });
    }

    // Fetch user's current incomplete tasks and active notes to provide context to the AI
    const [tasks, notes] = await Promise.all([
      prisma.todo.findMany({
        where: { userId: req.user!.id, completed: false },
        select: { id: true, text: true, deadline: true }
      }),
      prisma.note.findMany({
        where: { userId: req.user!.id, isArchived: false },
        select: { id: true, title: true }
      })
    ]);

    // Send to Gemini
    const result = await aiService.processVoiceCallCommand(req.user!.id, transcript, tasks, notes, localTime, timezone);

    // Execute the actions returned by AI if clarification is not needed
    let isSnooze = false;
    let snoozeMinutes = 10;

    if (!result.needClarification && result.actions && Array.isArray(result.actions)) {
      for (const action of result.actions) {
        if (action.type === 'RESCHEDULE' && action.taskId) {
          await prisma.todo.update({
            where: { id: action.taskId, userId: req.user!.id },
            data: { deadline: new Date(action.newDate) }
          });
        } else if (action.type === 'COMPLETE' && action.taskId) {
          await prisma.todo.update({
            where: { id: action.taskId, userId: req.user!.id },
            data: { completed: true }
          });
        } else if (action.type === 'CREATE' && action.text) {
          await prisma.todo.create({
            data: {
              userId: req.user!.id,
              text: action.text,
              completed: false,
              deadline: action.newDate ? new Date(action.newDate) : null,
              priority: 'medium'
            }
          });
        } else if (action.type === 'CREATE_NOTE' && action.content) {
          const newNote = await prisma.note.create({
            data: {
              userId: req.user!.id,
              title: action.title || 'Untitled Voice Note',
              content: action.content || '',
              category: 'Voice Notes'
            }
          });
          if (action.tags && action.tags.length > 0) {
            await syncTags(newNote.id, action.tags);
          }
          saveEmbeddingForNote(req.user!.id, newNote.id, newNote.title, newNote.content);
        } else if (action.type === 'READ_NOTE' && action.noteId) {
          const note = await prisma.note.findUnique({
            where: { id: action.noteId }
          });
          if (note) {
            const summaryText = await aiService.generateVerbalNoteSummary(req.user!.id, note.title, note.content);
            result.responseSpeech = `Here is a summary of your note "${note.title}": ${summaryText}`;
          } else {
            result.responseSpeech = "Sorry, I couldn't find that note in your database.";
          }
        } else if (action.type === 'SNOOZE') {
          isSnooze = true;
          snoozeMinutes = action.minutes || 10;
        }
      }

      // Broadcast changes if any actions were taken (and it's not just a snooze)
      const nonSnoozeActions = result.actions.filter((a: any) => a.type !== 'SNOOZE');
      if (nonSnoozeActions.length > 0) {
        const io = req.app.get('io');
        if (io) {
          const hasTodo = nonSnoozeActions.some((a: any) => ['COMPLETE', 'RESCHEDULE', 'CREATE'].includes(a.type));
          const hasNote = nonSnoozeActions.some((a: any) => a.type === 'CREATE_NOTE');
          if (hasTodo) io.to(req.user!.id).emit('todos_changed');
          if (hasNote) io.to(req.user!.id).emit('notes_changed');
        }
      }
    } else if (result.needClarification && result.actions) {
      const snoozeAction = result.actions.find((a: any) => a.type === 'SNOOZE');
      if (snoozeAction) {
        isSnooze = true;
        snoozeMinutes = snoozeAction.minutes || 10;
      }
    }

    res.json({ 
      responseSpeech: result.responseSpeech || "Done!",
      needClarification: !!result.needClarification,
      snooze: isSnooze,
      snoozeMinutes,
      actions: result.actions
    });
  } catch (error) {
    next(error);
  }
}

export async function suggestTagForNote(req: Request, res: Response, next: NextFunction) {
  try {
    const note = await prisma.note.findFirst({
      where: { id: req.params.id as string, userId: req.user!.id }
    });
    if (!note) {
      return res.status(404).json({ error: 'Note not found' });
    }
    const title = req.body?.title ?? note.title;
    const content = req.body?.content ?? note.content;

    if (!content || content.trim().length === 0) {
      return res.status(400).json({ error: 'Note has no content' });
    }

    const result = await aiService.suggestTag(req.user!.id, title, content);
    res.json(result);
  } catch (error) {
    next(error);
  }
}

export async function getLinkPreview(req: Request, res: Response, next: NextFunction) {
  try {
    const { url } = req.query;
    if (!url || typeof url !== 'string') {
      return res.status(400).json({ error: 'URL query parameter is required' });
    }

    let targetUrl = url;
    if (!/^https?:\/\//i.test(targetUrl)) {
      targetUrl = 'https://' + targetUrl;
    }

    const response = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36'
      }
    });

    const html = await response.text();

    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim() : '';

    const ogTitleMatch = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i) || 
                         html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i);
    const ogTitle = ogTitleMatch ? ogTitleMatch[1] : '';

    const ogDescriptionMatch = html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i) || 
                               html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:description["']/i);
    const ogDescription = ogDescriptionMatch ? ogDescriptionMatch[1] : '';

    const ogImageMatch = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) || 
                         html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
    const ogImage = ogImageMatch ? ogImageMatch[1] : '';

    const domain = new URL(targetUrl).hostname;

    res.json({
      title: ogTitle || title || domain,
      description: ogDescription || 'No description available.',
      image: ogImage || '',
      url: targetUrl,
      domain
    });
  } catch (error) {
    res.json({
      title: req.query.url,
      description: 'Could not load link preview.',
      image: '',
      url: req.query.url,
      domain: ''
    });
  }
}

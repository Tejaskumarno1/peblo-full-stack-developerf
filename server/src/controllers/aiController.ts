import { Request, Response, NextFunction } from 'express';
import { safeFetchHtml } from '../utils/safeFetch.js';
import prisma from '../db.js';
import * as aiService from '../services/aiService.js';
import { syncTags, saveEmbeddingForNote } from './notesController.js';
import { aiReadableWhere, noteAiAccess, PRIVATE_MESSAGE } from '../utils/aiAccess.js';

/** The note a per-note AI action works on: it must exist, not be in the Trash and not be #private. Answers the request itself when it cannot be used. */
async function noteForAi(req: Request, res: Response) {
  const access = await noteAiAccess(req.user!.id, req.params.id as string);
  if (access === 'private') { res.status(400).json({ error: PRIVATE_MESSAGE }); return null; }
  if (access === 'missing') { res.status(404).json({ error: 'Note not found' }); return null; }
  const note = await prisma.note.findFirst({ where: { id: req.params.id as string, userId: req.user!.id } });
  if (!note) { res.status(404).json({ error: 'Note not found' }); return null; }
  return note;
}

export async function generateSummary(req: Request, res: Response, next: NextFunction) {
  try {
    const note = await noteForAi(req, res);
    if (!note) return;
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
    const note = await noteForAi(req, res);
    if (!note) return;
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
    const note = await noteForAi(req, res);
    if (!note) return;
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

/** Speech to text for the AI assistant's microphone: a short WAV recording in, the words out. */
export async function transcribe(req: Request, res: Response, next: NextFunction) {
  try {
    const { audio, mime } = req.body || {};
    if (typeof audio !== 'string' || audio.length < 8) return res.status(400).json({ error: 'No recording was sent.' });
    if (audio.length > 6_000_000) return res.status(413).json({ error: 'That recording is too long. Keep it under a minute.' });
    const text = await aiService.transcribeAudio(req.user!.id, audio, typeof mime === 'string' ? mime : 'audio/wav');
    res.json({ text });
  } catch (error) {
    next(error);
  }
}

export async function suggestTagForNote(req: Request, res: Response, next: NextFunction) {
  try {
    const note = await noteForAi(req, res);
    if (!note) return;
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

    // Only public web pages (PEB-24): no internal addresses, bounded time and size, redirects re-checked.
    const fetched = await safeFetchHtml(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36'
      }
    });
    targetUrl = fetched.url;
    const html = fetched.html;

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

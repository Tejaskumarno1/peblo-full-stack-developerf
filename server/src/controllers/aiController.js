import { PrismaClient } from '@prisma/client';
import * as aiService from '../services/aiService.js';

const prisma = new PrismaClient();

export async function generateSummary(req, res, next) {
  try {
    const note = await prisma.note.findFirst({
      where: { id: req.params.id, userId: req.user.id }
    });
    if (!note) {
      return res.status(404).json({ error: 'Note not found' });
    }
    const title = req.body?.title ?? note.title;
    const content = req.body?.content ?? note.content;

    if (!content || content.trim().length === 0) {
      return res.status(400).json({ error: 'Note has no content to summarize' });
    }

    const result = await aiService.generateSummary(title, content);

    // Store the AI generation
    await prisma.aiGeneration.create({
      data: {
        noteId: note.id,
        userId: req.user.id,
        type: 'summary',
        result: JSON.stringify(result)
      }
    });

    res.json(result);
  } catch (error) {
    next(error);
  }
}

export async function extractActions(req, res, next) {
  try {
    const note = await prisma.note.findFirst({
      where: { id: req.params.id, userId: req.user.id }
    });
    if (!note) {
      return res.status(404).json({ error: 'Note not found' });
    }
    const title = req.body?.title ?? note.title;
    const content = req.body?.content ?? note.content;

    if (!content || content.trim().length === 0) {
      return res.status(400).json({ error: 'Note has no content to analyze' });
    }

    const result = await aiService.extractActionItems(title, content);

    await prisma.aiGeneration.create({
      data: {
        noteId: note.id,
        userId: req.user.id,
        type: 'action_items',
        result: JSON.stringify(result)
      }
    });

    res.json(result);
  } catch (error) {
    next(error);
  }
}

export async function suggestTitle(req, res, next) {
  try {
    const note = await prisma.note.findFirst({
      where: { id: req.params.id, userId: req.user.id }
    });
    if (!note) {
      return res.status(404).json({ error: 'Note not found' });
    }
    const content = req.body?.content ?? note.content;

    if (!content || content.trim().length === 0) {
      return res.status(400).json({ error: 'Note has no content to generate title from' });
    }

    const result = await aiService.suggestTitle(content);

    await prisma.aiGeneration.create({
      data: {
        noteId: note.id,
        userId: req.user.id,
        type: 'title',
        result: JSON.stringify(result)
      }
    });

    res.json(result);
  } catch (error) {
    next(error);
  }
}

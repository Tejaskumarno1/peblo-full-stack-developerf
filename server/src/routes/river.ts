import { Router } from 'express';
import prisma from '../db.js';
import { authenticate } from '../middleware/auth.js';
import { findPromises, meetingBrief } from '../services/aiService.js';
import { retrieve, sourcesPrompt } from '../services/retrieval.js';
import { carryOverPromiseState } from '../services/promiseState.js';

/*
 * River style: briefs before meetings, and promises found in notes.
 * Promises are kept in ai_generations (type "promises") so they survive restarts.
 * Notes tagged #private are never sent to any model.
 */
const router = Router();
router.use(authenticate);

const isPrivate = (n: any) => (n.tags || []).some((t: any) => t.tag.name === 'private');
const parse = (s: string, fallback: any) => { try { return JSON.parse(s); } catch { return fallback; } };

// POST /api/river/brief { todoId }: points to read before a meeting, from the user's notes
router.post('/brief', async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const todo = await prisma.todo.findFirst({ where: { id: String(req.body?.todoId || ''), userId } });
    if (!todo) return res.status(404).json({ error: 'Meeting not found' });

    const tags = Array.isArray(todo.todoTags) ? (todo.todoTags as string[]) : [];
    const found = await retrieve(userId, [todo.text, ...tags].join(' '), { maxNotes: 5 });
    const notes = found.sources.filter((s) => s.kind === 'note').map((s, i) => ({ ...s, n: i + 1 }));
    if (!notes.length) return res.json({ points: [], sources: [] });

    const when = todo.deadline ? todo.deadline.toDateString() + (todo.startTime ? ` ${todo.startTime}` : '') : 'no date';
    const brief = await meetingBrief(userId, todo.text, when, sourcesPrompt(notes));
    res.json({
      points: brief.points.map((p) => ({ ...p, cite: p.cite.filter((n) => n >= 1 && n <= notes.length) })),
      sources: notes.map((s) => ({ n: s.n, id: s.id, title: s.title })),
    });
  } catch (error) {
    next(error);
  }
});

function promiseView(gen: any, noteTitle?: string) {
  const data = parse(gen.result, { items: [] });
  return { id: gen.id, noteId: gen.noteId, noteTitle, createdAt: gen.createdAt, items: data.items || [] };
}

// POST /api/river/notes/:id/promises: reads the note and finds who promised what
router.post('/notes/:id/promises', async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const note = await prisma.note.findFirst({
      where: { id: req.params.id, userId },
      include: { tags: { include: { tag: true } } },
    });
    if (!note) return res.status(404).json({ error: 'Note not found' });
    if (isPrivate(note)) return res.status(400).json({ error: 'This note is #private, so Peblo does not show it to any AI.' });
    if ((note.content || '').trim().length < 20) return res.json({ id: null, noteId: note.id, items: [] });

    // Reading again must not bring back promises you already added or ignored: carry their state over by wording.
    const prevGen = await prisma.aiGeneration.findFirst({ where: { noteId: note.id, userId, type: 'promises' }, orderBy: { createdAt: 'desc' } });
    const items = carryOverPromiseState(
      parse(prevGen?.result || '', { items: [] }).items || [],
      await findPromises(userId, note.title, note.content, note.createdAt),
    );
    const gen = await prisma.aiGeneration.create({
      data: { noteId: note.id, userId, type: 'promises', result: JSON.stringify({ items }) },
    });
    res.json(promiseView(gen, note.title));
  } catch (error) {
    next(error);
  }
});

// GET /api/river/promises[?noteId=]: the latest promises per note (open ones, unless a note is asked for)
router.get('/promises', async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const noteId = typeof req.query.noteId === 'string' ? req.query.noteId : null;
    const gens = await prisma.aiGeneration.findMany({
      where: { userId, type: 'promises', ...(noteId ? { noteId } : { createdAt: { gte: new Date(Date.now() - 30 * 86400000) } }) },
      include: { note: { select: { title: true, isDeleted: true } } },
      orderBy: { createdAt: 'desc' },
    });
    const latest = new Map<string, any>();
    for (const g of gens) if (!latest.has(g.noteId) && !g.note.isDeleted) latest.set(g.noteId, g);
    const list = [...latest.values()].map((g) => promiseView(g, g.note.title));
    res.json({ promises: list });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/river/promises/:id { index, status: "added" | "ignored" | "open", todoId? }
router.patch('/promises/:id', async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const i = Number(req.body?.index);
    const status = String(req.body?.status || '');
    if (!Number.isInteger(i) || !['added', 'ignored', 'open'].includes(status)) return res.status(400).json({ error: 'Bad request' });
    // A todoId must be one of this user's own tasks
    const wantedTodo = req.body?.todoId ? String(req.body.todoId) : null;
    if (wantedTodo && !(await prisma.todo.findFirst({ where: { id: wantedTodo, userId }, select: { id: true } }))) {
      return res.status(400).json({ error: 'Bad request' });
    }
    // Read-modify-write of one JSON blob: only write if nobody changed it meanwhile, otherwise read again and retry
    for (let attempt = 0; attempt < 5; attempt++) {
      const gen = await prisma.aiGeneration.findFirst({ where: { id: req.params.id, userId, type: 'promises' } });
      if (!gen) return res.status(404).json({ error: 'Not found' });
      const data = parse(gen.result, { items: [] });
      if (!data.items?.[i]) return res.status(400).json({ error: 'Bad request' });
      data.items[i] = { ...data.items[i], status, todoId: wantedTodo || data.items[i].todoId || null };
      const next = JSON.stringify(data);
      const won = await prisma.aiGeneration.updateMany({ where: { id: gen.id, result: gen.result }, data: { result: next } });
      if (won.count === 1) return res.json(promiseView({ ...gen, result: next }));
    }
    res.status(409).json({ error: 'That changed while you were saving it. Try again.' });
  } catch (error) {
    next(error);
  }
});

export default router;

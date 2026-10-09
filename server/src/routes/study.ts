import { Router } from 'express';
import prisma from '../db.js';
import { authenticate } from '../middleware/auth.js';
import { makeQuiz } from '../services/aiService.js';

/*
 * Orbit style: quizzes made from a topic's notes, and a 0–100 mastery score per topic.
 * A topic is a tag. Notes tagged #private are never sent to any model.
 */
const router = Router();
router.use(authenticate);

const clean = (t: unknown) => String(t || '').trim().replace(/^#/, '').toLowerCase().slice(0, 60);
const parse = (s: string | null, fallback: any) => { try { return s ? JSON.parse(s) : fallback; } catch { return fallback; } };

function shape(m: any) {
  return {
    topic: m.topic,
    score: m.score,
    quizzes: m.quizzes,
    lastCorrect: m.lastCorrect,
    lastTotal: m.lastTotal,
    missed: parse(m.missed, []),
    updatedAt: m.updatedAt,
  };
}

// GET /api/study/mastery: every topic that has been quizzed
router.get('/mastery', async (req, res, next) => {
  try {
    const rows = await prisma.topicMastery.findMany({ where: { userId: req.user!.id } });
    res.json({ mastery: rows.map(shape) });
  } catch (error) {
    next(error);
  }
});

// POST /api/study/quiz { topic, count? }: writes a new quiz from the topic's notes
router.post('/quiz', async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const topic = clean(req.body?.topic);
    if (!topic) return res.status(400).json({ error: 'Pick a topic to quiz.' });
    const count = Math.min(Math.max(parseInt(req.body?.count, 10) || 10, 3), 15);

    const notes = await prisma.note.findMany({
      where: { userId, isDeleted: false, tags: { some: { tag: { name: topic } } } },
      select: { id: true, title: true, content: true, tags: { select: { tag: { select: { name: true } } } } },
      orderBy: { updatedAt: 'desc' },
      take: 12,
    });
    const usable = notes.filter((n) => !n.tags.some((t) => t.tag.name === 'private') && (n.content || '').trim().length > 40);
    if (!usable.length) {
      const why = notes.length ? 'Its notes are #private or too short to quiz.' : 'No notes have this tag yet.';
      return res.status(400).json({ error: `Nothing to quiz on #${topic}. ${why}` });
    }

    const questions = await makeQuiz(userId, topic, usable.map((n) => ({ title: n.title, content: n.content })), count);
    if (!questions.length) return res.status(502).json({ error: 'The AI did not write any questions. Try again.' });

    const stored = questions.map((q) => ({ ...q, noteId: q.note ? usable[q.note - 1].id : null, noteTitle: q.note ? usable[q.note - 1].title : null }));
    const run = await prisma.quizRun.create({
      data: { userId, topic, questions: JSON.stringify(stored), total: stored.length },
    });
    res.json({
      id: run.id,
      topic,
      questions: stored.map(({ note, ...q }) => q),
      fromNotes: usable.length,
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/study/quiz/:id/answers { answers: number[] }: marks the quiz and updates mastery
router.post('/quiz/:id/answers', async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const run = await prisma.quizRun.findFirst({ where: { id: req.params.id, userId } });
    if (!run) return res.status(404).json({ error: 'Quiz not found' });

    const questions: any[] = parse(run.questions, []);
    const answers: number[] = (Array.isArray(req.body?.answers) ? req.body.answers : []).map((a: any) => (Number.isInteger(a) ? a : -1));
    let correct = 0;
    const missed = new Map<string, number>();
    questions.forEach((q, i) => {
      if (answers[i] === q.answer) correct++;
      else missed.set(q.concept, (missed.get(q.concept) || 0) + 1);
    });
    const total = questions.length || 1;
    const pct = Math.round((correct / total) * 100);

    // Claim the run first: only the request that flips finishedAt from null may touch mastery.
    // A repeat (double click, replayed request) gets 409 and changes nothing.
    const claimed = await prisma.quizRun.updateMany({
      where: { id: run.id, userId, finishedAt: null },
      data: { answers: JSON.stringify(answers), correct, finishedAt: new Date() },
    });
    if (claimed.count === 0) return res.status(409).json({ error: 'This quiz was already submitted.' });

    const prev = await prisma.topicMastery.findUnique({ where: { userId_topic: { userId, topic: run.topic } } });
    // Recent quizzes count most, so the score moves as you learn.
    const score = prev ? Math.round(prev.score * 0.4 + pct * 0.6) : pct;
    const missedList = [...missed.entries()].sort((a, b) => b[1] - a[1]).map(([concept, n]) => ({ concept, n }));
    const row = await prisma.topicMastery.upsert({
      where: { userId_topic: { userId, topic: run.topic } },
      create: { userId, topic: run.topic, score, quizzes: 1, lastCorrect: correct, lastTotal: total, missed: JSON.stringify(missedList) },
      update: { score, quizzes: { increment: 1 }, lastCorrect: correct, lastTotal: total, missed: JSON.stringify(missedList) },
    });
    res.json({ correct, total, pct, before: prev ? prev.score : null, mastery: shape(row) });
  } catch (error) {
    next(error);
  }
});

// GET /api/study/notes/:id/questions: how many quiz questions came from one note
router.get('/notes/:id/questions', async (req, res, next) => {
  try {
    const runs = await prisma.quizRun.findMany({ where: { userId: req.user!.id }, select: { questions: true } });
    let count = 0;
    for (const r of runs) for (const q of parse(r.questions, [])) if (q.noteId === req.params.id) count++;
    res.json({ count });
  } catch (error) {
    next(error);
  }
});

export default router;

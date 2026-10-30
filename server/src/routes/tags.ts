import { Router } from 'express';
import prisma from '../db.js';
import { authenticate } from '../middleware/auth.js';

/*
 * Topic (tag) manager: list with counts, rename or merge, delete. A topic is a note tag; tasks keep their
 * topics as a list of names in todos.todoTags, so those are rewritten too. inbox and private are built in.
 */
const router = Router();
router.use(authenticate);

const PROTECTED = ['inbox', 'private'];
const clean = (t: unknown) => String(t || '').trim().replace(/^#/, '').toLowerCase().slice(0, 60);
const tagList = (v: unknown): string[] => (Array.isArray(v) ? (v as unknown[]).filter((x): x is string => typeof x === 'string') : []);

// GET /api/tags -> [{ name, notes, todos }]
router.get('/', async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const tags = await prisma.tag.findMany({
      where: { userId },
      select: { name: true, notes: { select: { note: { select: { isDeleted: true } } } } },
    });
    const todos = await prisma.todo.findMany({ where: { userId }, select: { todoTags: true } });
    const todoCount = new Map<string, number>();
    for (const t of todos) for (const n of new Set(tagList(t.todoTags))) todoCount.set(n, (todoCount.get(n) || 0) + 1);
    const out = tags.map((t) => ({ name: t.name, notes: t.notes.filter((x) => !x.note.isDeleted).length, todos: todoCount.get(t.name) || 0 }));
    for (const [name, n] of todoCount) if (!out.some((o) => o.name === name)) out.push({ name, notes: 0, todos: n });
    res.json({ tags: out.sort((a, b) => a.name.localeCompare(b.name)) });
  } catch (error) {
    next(error);
  }
});

// POST /api/tags/rename { from, to }: renames, or merges into `to` if it already exists
router.post('/rename', async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const from = clean(req.body?.from);
    const to = clean(req.body?.to);
    if (!from || !to) return res.status(400).json({ error: 'Give the topic and its new name.' });
    if (from === to) return res.json({ ok: true, merged: false });
    if (PROTECTED.includes(from) || PROTECTED.includes(to)) return res.status(400).json({ error: 'inbox and private are built in and cannot be renamed.' });

    const src = await prisma.tag.findUnique({ where: { userId_name: { userId, name: from } } });
    const dst = await prisma.tag.findUnique({ where: { userId_name: { userId, name: to } } });
    let merged = false;
    // Every write below goes in one transaction, so a merge never stops half way (notes moved but tasks not, or the reverse).
    const ops: any[] = [];
    if (src && !dst) {
      ops.push(prisma.tag.update({ where: { id: src.id }, data: { name: to } }));
    } else if (src && dst) {
      merged = true;
      const onDst = (await prisma.noteTag.findMany({ where: { tagId: dst.id }, select: { noteId: true } })).map((x) => x.noteId);
      ops.push(
        prisma.noteTag.deleteMany({ where: { tagId: src.id, noteId: { in: onDst } } }),
        prisma.noteTag.updateMany({ where: { tagId: src.id }, data: { tagId: dst.id } }),
        prisma.tag.delete({ where: { id: src.id } }),
      );
    }

    // Only tasks that carry the topic are read; repeating series keep a copy for the tasks they will still create.
    const has = { array_contains: [from] } as any;
    const todos = await prisma.todo.findMany({ where: { userId, todoTags: has }, select: { id: true, todoTags: true } });
    for (const t of todos) {
      const tags = tagList(t.todoTags);
      if (!tags.includes(from)) continue;
      ops.push(prisma.todo.update({ where: { id: t.id }, data: { todoTags: [...new Set(tags.map((x) => (x === from ? to : x)))] } }));
    }
    const series = await prisma.todoSeries.findMany({ where: { userId, endedAt: null, todoTags: has }, select: { id: true, todoTags: true } });
    for (const s of series) {
      const tags = tagList(s.todoTags);
      if (!tags.includes(from)) continue;
      ops.push(prisma.todoSeries.update({ where: { id: s.id }, data: { todoTags: [...new Set(tags.map((x) => (x === from ? to : x)))] } }));
    }
    if (ops.length) await prisma.$transaction(ops);
    try {
      const other = await prisma.topicMastery.findFirst({ where: { userId, topic: to } });
      if (other) await prisma.topicMastery.deleteMany({ where: { userId, topic: from } });
      else await prisma.topicMastery.updateMany({ where: { userId, topic: from }, data: { topic: to } });
    } catch { /* the score is rebuilt by the next quiz */ }
    res.json({ ok: true, merged });
  } catch (error) {
    next(error);
  }
});

// POST /api/tags/delete { name }: takes the topic off every note and task (nothing else is deleted)
router.post('/delete', async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const name = clean(req.body?.name);
    if (!name) return res.status(400).json({ error: 'Which topic?' });
    if (PROTECTED.includes(name)) return res.status(400).json({ error: 'inbox and private are built in and cannot be deleted.' });
    const tag = await prisma.tag.findUnique({ where: { userId_name: { userId, name } } });
    const ops: any[] = [];
    if (tag) ops.push(prisma.tag.delete({ where: { id: tag.id } }));
    const has = { array_contains: [name] } as any;
    const todos = await prisma.todo.findMany({ where: { userId, todoTags: has }, select: { id: true, todoTags: true } });
    for (const t of todos) {
      const tags = tagList(t.todoTags);
      if (tags.includes(name)) ops.push(prisma.todo.update({ where: { id: t.id }, data: { todoTags: tags.filter((x) => x !== name) } }));
    }
    const series = await prisma.todoSeries.findMany({ where: { userId, endedAt: null, todoTags: has }, select: { id: true, todoTags: true } });
    for (const s of series) {
      const tags = tagList(s.todoTags);
      if (tags.includes(name)) ops.push(prisma.todoSeries.update({ where: { id: s.id }, data: { todoTags: tags.filter((x) => x !== name) } }));
    }
    ops.push(prisma.topicMastery.deleteMany({ where: { userId, topic: name } }));
    await prisma.$transaction(ops);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

export default router;

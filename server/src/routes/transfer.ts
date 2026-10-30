import { Router } from 'express';
import multer from 'multer';
import prisma from '../db.js';
import { authenticate } from '../middleware/auth.js';
import { syncTags } from '../controllers/notesController.js';
import { parseUploads, buildMarkdownExport } from '../services/importService.js';
import { cleanNoteMeta, cleanTodoMeta, scrub } from '../utils/meta.js';

const router = Router();

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024, files: 200 } });
// multer buffers uploads in memory: refuse a request that declares more than 150 MB in total before reading any of it
const capTotal = (req: any, res: any, next: any) => (Number(req.headers['content-length']) > 150 * 1024 * 1024 ? res.status(413).json({ error: 'Those files are too large to import together (limit 150 MB).' }) : next());

// POST /api/import — Notion export .zip, Obsidian vault .zip, or loose .md/.txt/.csv files
router.post('/import', authenticate, capTotal, upload.array('files'), async (req, res, next) => {
  const created: { id: string; title: string }[] = [];
  try {
    const files = (req.files as Express.Multer.File[]) || [];
    if (files.length === 0) return res.status(400).json({ error: 'Choose a Notion export (.zip) or Markdown files to import.' });

    // Browsers send UTF-8 names as latin1 in multipart; fix non-ASCII titles.
    for (const f of files) f.originalname = Buffer.from(f.originalname, 'latin1').toString('utf8');

    const parsed = parseUploads(files);
    const userId = req.user!.id;

    for (const n of parsed.notes) {
      const note = await prisma.note.create({
        data: {
          userId,
          title: scrub(n.title || 'Untitled') || 'Untitled',
          content: scrub(n.content),
          ...(n.archived ? { isArchived: true } : {}),
          ...(n.createdAt ? { createdAt: n.createdAt } : {}),
        },
        select: { id: true, title: true },
      });
      await syncTags(userId, note.id, [...n.tags, 'imported']);
      created.push(note);
    }

    const io = req.app.get('io');
    if (io) io.to(userId).emit('notes_changed');

    res.json({
      imported: created.length,
      notes: created.slice(0, 50),
      skippedImages: parsed.skippedImages,
      skippedFiles: parsed.skippedFiles.slice(0, 20),
    });
  } catch (error) {
    await prisma.note.deleteMany({ where: { userId: req.user!.id, id: { in: created.map((c) => c.id) } } }).catch(() => {}); // a failed import leaves nothing half-added
    next(error);
  }
});

// GET /api/export — every note (not trash) as Markdown files in a .zip
router.get('/export', authenticate, async (req, res, next) => {
  try {
    const notes = await prisma.note.findMany({
      where: { userId: req.user!.id, isDeleted: false },
      include: { tags: { include: { tag: true } } },
      orderBy: { createdAt: 'asc' },
    });
    const zip = buildMarkdownExport(
      notes.map((n) => ({ ...n, tags: n.tags.map((t) => t.tag.name) }))
    );
    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="peblo-notes-${stamp}.zip"`);
    res.send(zip);
  } catch (error) {
    next(error);
  }
});

// GET /api/backup — notes (not trash), tasks and topics as one JSON file
router.get('/backup', authenticate, async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const notes = await prisma.note.findMany({
      where: { userId, isDeleted: false },
      include: { tags: { include: { tag: true } } },
      orderBy: { createdAt: 'asc' },
    });
    const todos = await prisma.todo.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } });
    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Disposition', `attachment; filename="peblo-backup-${stamp}.json"`);
    res.json({
      format: 'peblo-backup',
      version: 1,
      exportedAt: new Date().toISOString(),
      notes: notes.map((n) => ({
        id: n.id, title: n.title, content: n.content, tags: n.tags.map((t) => t.tag.name),
        isArchived: n.isArchived, meta: n.meta ?? {}, createdAt: n.createdAt, updatedAt: n.updatedAt,
      })),
      todos: todos.map((t) => ({
        text: t.text, completed: t.completed, priority: t.priority, deadline: t.deadline,
        tags: Array.isArray(t.todoTags) ? t.todoTags : [], noteId: t.noteId,
        startTime: t.startTime, endTime: t.endTime, meta: t.meta ?? {}, createdAt: t.createdAt,
      })),
    });
  } catch (error) {
    next(error);
  }
});

const asDate = (v: any): Date | undefined => {
  if (typeof v !== 'string') return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d;
};
const strs = (v: any): string[] => (Array.isArray(v) ? v.filter((x) => typeof x === 'string').map((x) => x.trim().toLowerCase()).filter(Boolean).slice(0, 30) : []);

// POST /api/restore — add everything from a backup file. Nothing existing is changed or deleted.
router.post('/restore', authenticate, async (req, res, next) => {
  const madeNoteIds: string[] = [];
  const madeTodoIds: string[] = [];
  try {
    const b = req.body;
    if (!b || b.format !== 'peblo-backup' || b.version !== 1 || !Array.isArray(b.notes) || !Array.isArray(b.todos)) {
      return res.status(400).json({ error: 'That does not look like a Peblo backup file.' });
    }
    if (b.notes.length > 5000 || b.todos.length > 20000) return res.status(400).json({ error: 'That backup is too large to restore in one go.' });
    const userId = req.user!.id;
    const idMap = new Map<string, string>();
    let notes = 0;
    let todos = 0;
    for (const n of b.notes) {
      if (!n || typeof n !== 'object') continue;
      const created = await prisma.note.create({
        data: {
          userId,
          title: typeof n.title === 'string' && n.title.trim() ? scrub(n.title).slice(0, 500) || 'Untitled' : 'Untitled',
          content: typeof n.content === 'string' ? scrub(n.content) : '',
          isArchived: n.isArchived === true,
          meta: cleanNoteMeta(n.meta, {}),
          ...(asDate(n.createdAt) ? { createdAt: asDate(n.createdAt) } : {}),
        },
        select: { id: true },
      });
      madeNoteIds.push(created.id);
      if (typeof n.id === 'string') idMap.set(n.id, created.id);
      await syncTags(userId, created.id, strs(n.tags));
      notes += 1;
    }
    for (const t of b.todos) {
      if (!t || typeof t.text !== 'string' || !t.text.trim()) continue;
      const madeTodo = await prisma.todo.create({
        data: {
          userId,
          text: t.text.slice(0, 2000),
          completed: t.completed === true,
          priority: ['low', 'medium', 'high'].includes(t.priority) ? t.priority : 'medium',
          deadline: asDate(t.deadline) ?? null,
          todoTags: strs(t.tags),
          noteId: typeof t.noteId === 'string' ? idMap.get(t.noteId) ?? null : null,
          startTime: typeof t.startTime === 'string' ? t.startTime.slice(0, 5) : null,
          endTime: typeof t.endTime === 'string' ? t.endTime.slice(0, 5) : null,
          meta: cleanTodoMeta(t.meta, {}),
        },
        select: { id: true },
      });
      madeTodoIds.push(madeTodo.id);
      todos += 1;
    }
    const io = req.app.get('io');
    if (io) io.to(userId).emit('notes_changed');
    res.json({ restored: { notes, todos } });
  } catch (error) {
    await prisma.todo.deleteMany({ where: { userId: req.user!.id, id: { in: madeTodoIds } } }).catch(() => {}); // a failed restore leaves nothing half-added
    await prisma.note.deleteMany({ where: { userId: req.user!.id, id: { in: madeNoteIds } } }).catch(() => {});
    next(error);
  }
});

const EXAMPLE_TAG = 'example-data';
const EXAMPLE_NOTES = [
  { title: 'Normal forms', tags: ['sample-dbms'], content: '# Normal forms\n\nFirst normal form: every cell holds one value.\n\nSecond normal form: no partial dependencies on part of a key.\n\nThird normal form: no transitive dependencies.' },
  { title: 'SQL joins', tags: ['sample-dbms'], content: '# SQL joins\n\nAn inner join keeps rows that match in both tables.\n\nA left join keeps every row of the left table.' },
  { title: 'Process scheduling', tags: ['sample-os'], content: '# Process scheduling\n\nRound robin gives each process a fixed time slice.\n\nShortest job first minimises average waiting time.' },
  { title: 'Deadlocks', tags: ['sample-os'], content: '# Deadlocks\n\nFour conditions: mutual exclusion, hold and wait, no pre-emption, circular wait.' },
];
const EXAMPLE_TODOS = [
  { text: 'Revise normal forms (example)', tags: ['sample-dbms'], note: 'Normal forms', days: 1, priority: 'high' },
  { text: 'Practise 5 join queries (example)', tags: ['sample-dbms'], note: 'SQL joins', days: 3, priority: 'medium' },
  { text: 'Read about scheduling algorithms (example)', tags: ['sample-os'], note: 'Process scheduling', days: 2, priority: 'medium' },
];

// POST /api/example — add a small set of sample notes and tasks, all tagged "example-data"
router.post('/example', authenticate, async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const already = await prisma.noteTag.count({ where: { note: { userId, isDeleted: false }, tag: { name: EXAMPLE_TAG, userId } } });
    if (already > 0) return res.status(409).json({ error: 'Example data is already there. Clear it first to add it again.' });
    const ids = new Map<string, string>();
    for (const n of EXAMPLE_NOTES) {
      const c = await prisma.note.create({ data: { userId, title: n.title, content: n.content }, select: { id: true } });
      ids.set(n.title, c.id);
      await syncTags(userId, c.id, [...n.tags, EXAMPLE_TAG]);
    }
    for (const t of EXAMPLE_TODOS) {
      await prisma.todo.create({
        data: {
          userId, text: t.text, priority: t.priority, todoTags: [...t.tags, EXAMPLE_TAG],
          noteId: ids.get(t.note) ?? null, deadline: new Date(Date.now() + t.days * 86400000),
        },
      });
    }
    const io = req.app.get('io');
    if (io) io.to(userId).emit('notes_changed');
    res.json({ added: { notes: EXAMPLE_NOTES.length, todos: EXAMPLE_TODOS.length } });
  } catch (error) {
    next(error);
  }
});

// POST /api/example/clear — remove only what /api/example added (never anything else)
router.post('/example/clear', authenticate, async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const noteRows = await prisma.note.findMany({ where: { userId, tags: { some: { tag: { name: EXAMPLE_TAG } } } }, select: { id: true } });
    const noteIds = noteRows.map((n) => n.id);
    const todoRows = await prisma.todo.findMany({ where: { userId }, select: { id: true, todoTags: true } });
    const todoIds = todoRows.filter((t) => Array.isArray(t.todoTags) && (t.todoTags as any[]).includes(EXAMPLE_TAG)).map((t) => t.id);
    if (todoIds.length) await prisma.todo.deleteMany({ where: { userId, id: { in: todoIds } } });
    if (noteIds.length) await prisma.note.deleteMany({ where: { userId, id: { in: noteIds } } });
    await prisma.topicMastery.deleteMany({ where: { userId, topic: { in: ['sample-dbms', 'sample-os'] } } });
    const io = req.app.get('io');
    if (io) io.to(userId).emit('notes_changed');
    res.json({ removed: { notes: noteIds.length, todos: todoIds.length } });
  } catch (error) {
    next(error);
  }
});

export default router;

import { Router } from 'express';
import multer from 'multer';
import prisma from '../db.js';
import { authenticate } from '../middleware/auth.js';
import { syncTags } from '../controllers/notesController.js';
import { parseUploads, buildMarkdownExport } from '../services/importService.js';

const router = Router();
router.use(authenticate);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 500 * 1024 * 1024, files: 500 } });

// POST /api/import — Notion export .zip, Obsidian vault .zip, or loose .md/.txt/.csv files
router.post('/import', upload.array('files'), async (req, res, next) => {
  try {
    const files = (req.files as Express.Multer.File[]) || [];
    if (files.length === 0) return res.status(400).json({ error: 'Choose a Notion export (.zip) or Markdown files to import.' });

    // Browsers send UTF-8 names as latin1 in multipart; fix non-ASCII titles.
    for (const f of files) f.originalname = Buffer.from(f.originalname, 'latin1').toString('utf8');

    const parsed = parseUploads(files);
    const userId = req.user!.id;
    const created: { id: string; title: string }[] = [];

    for (const n of parsed.notes) {
      const note = await prisma.note.create({
        data: {
          userId,
          title: n.title || 'Untitled',
          content: n.content,
          ...(n.createdAt ? { createdAt: n.createdAt } : {}),
        },
        select: { id: true, title: true },
      });
      await syncTags(note.id, [...n.tags, 'imported']);
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
    next(error);
  }
});

// GET /api/export — every note (not trash) as Markdown files in a .zip
router.get('/export', async (req, res, next) => {
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

export default router;

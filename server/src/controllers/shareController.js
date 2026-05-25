import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function getSharedNote(req, res, next) {
  try {
    const note = await prisma.note.findUnique({
      where: { shareId: req.params.shareId },
      include: {
        tags: { include: { tag: true } },
        user: { select: { name: true } }
      }
    });

    if (!note || !note.isPublic) {
      return res.status(404).json({ error: 'Shared note not found' });
    }

    res.json({
      note: {
        title: note.title,
        content: note.content,
        category: note.category,
        tags: note.tags.map(nt => nt.tag.name),
        author: note.user.name,
        updatedAt: note.updatedAt,
        createdAt: note.createdAt
      }
    });
  } catch (error) {
    next(error);
  }
}

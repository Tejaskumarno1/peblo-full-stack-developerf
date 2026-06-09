import { Request, Response, NextFunction } from 'express';
import prisma from '../db.js';

export async function getSharedNote(req: Request, res: Response, next: NextFunction) {
  try {
    const note = await prisma.note.findUnique({
      where: { shareId: req.params.shareId as string },
      include: {
        tags: { include: { tag: true } },
        user: { select: { name: true } }
      }
    }) as any;

    if (!note || !note.isPublic) {
      return res.status(404).json({ error: 'Shared note not found' });
    }

    res.json({
      note: {
        title: note.title,
        content: note.content,
        category: note.category,
        tags: note.tags.map((nt: any) => nt.tag.name),
        author: note.user.name,
        updatedAt: note.updatedAt,
        createdAt: note.createdAt
      }
    });
  } catch (error) {
    next(error);
  }
}

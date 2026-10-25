import { z } from 'zod';

export const noteSchemas = {
  create: {
    body: z.object({
      title: z.string().optional(),
      content: z.string().optional(),
      tags: z.array(z.string()).optional(),
      category: z.string().optional(),
      isArchived: z.boolean().optional(),
      meta: z.record(z.string(), z.any()).optional()
    })
  },
  update: {
    body: z.object({
      title: z.string().optional(),
      content: z.string().optional(),
      tags: z.array(z.string()).optional(),
      category: z.string().optional(),
      isArchived: z.boolean().optional(),
      meta: z.record(z.string(), z.any()).optional(),
      // safe saving when someone else may be editing too (see services/noteSave.ts)
      baseUpdatedAt: z.string().nullable().optional(),
      baseContent: z.string().nullable().optional(),
      force: z.boolean().optional(),
      keepBoth: z.boolean().optional()
    })
  }
};

export const todoSchemas = {
  create: {
    body: z.object({
      text: z.string().min(1, "Task text is required"),
      priority: z.enum(['low', 'medium', 'high']).optional(),
      deadline: z.string().refine((s) => !Number.isNaN(Date.parse(s)), 'Invalid date').nullable().optional(),
      startTime: z.string().nullable().optional(),
      endTime: z.string().nullable().optional(),
      recurrence: z.enum(['none', 'daily', 'weekdays', 'weekly', 'monthly', 'yearly']).optional(),
      tags: z.array(z.string()).optional(),
      noteId: z.string().nullable().optional(),
      meta: z.record(z.string(), z.any()).optional()
    })
  },
  update: {
    body: z.object({
      text: z.string().optional(),
      priority: z.enum(['low', 'medium', 'high']).optional(),
      completed: z.boolean().optional(),
      deadline: z.string().refine((s) => !Number.isNaN(Date.parse(s)), 'Invalid date').nullable().optional(),
      startTime: z.string().nullable().optional(),
      endTime: z.string().nullable().optional(),
      recurrence: z.enum(['none', 'daily', 'weekdays', 'weekly', 'monthly', 'yearly']).optional(),
      scope: z.enum(['this', 'following', 'all']).optional(),
      tags: z.array(z.string()).optional(),
      noteId: z.string().nullable().optional(),
      meta: z.record(z.string(), z.any()).optional()
    })
  }
};

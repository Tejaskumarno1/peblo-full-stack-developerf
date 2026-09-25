import { z } from 'zod';

export const noteSchemas = {
  create: {
    body: z.object({
      title: z.string().optional(),
      content: z.string().optional(),
      tags: z.array(z.string()).optional(),
      category: z.string().optional(),
      isArchived: z.boolean().optional()
    })
  },
  update: {
    body: z.object({
      title: z.string().optional(),
      content: z.string().optional(),
      tags: z.array(z.string()).optional(),
      category: z.string().optional(),
      isArchived: z.boolean().optional()
    })
  }
};

export const todoSchemas = {
  create: {
    body: z.object({
      text: z.string().min(1, "Task text is required"),
      priority: z.enum(['low', 'medium', 'high']).optional(),
      deadline: z.string().nullable().optional(),
      startTime: z.string().nullable().optional(),
      endTime: z.string().nullable().optional(),
      recurrence: z.enum(['none', 'daily', 'weekly', 'monthly', 'yearly']).optional(),
      tags: z.array(z.string()).optional(),
      noteId: z.string().nullable().optional()
    })
  },
  update: {
    body: z.object({
      text: z.string().optional(),
      priority: z.enum(['low', 'medium', 'high']).optional(),
      completed: z.boolean().optional(),
      deadline: z.string().nullable().optional(),
      startTime: z.string().nullable().optional(),
      endTime: z.string().nullable().optional(),
      recurrence: z.enum(['none', 'daily', 'weekly', 'monthly', 'yearly']).optional(),
      tags: z.array(z.string()).optional(),
      noteId: z.string().nullable().optional()
    })
  }
};

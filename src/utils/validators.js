const { z } = require('zod');

const loginSchema = z.object({
  emailOrUsername: z.string().trim().min(1, 'Email or username is required.'),
  password: z.string().min(1, 'Password is required.'),
});

const normalizeTags = (value) => {
  if (!Array.isArray(value)) {
    return [];
  }

  return [...new Set(value.map((tag) => String(tag).trim()).filter(Boolean))];
};

const timeEntrySchema = z.object({
  name: z.string().trim().min(1, 'Name is required.'),
  project: z.string().trim().min(1, 'Project is required.'),
  tags: z.array(z.string()).optional().default([]).transform(normalizeTags),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must use YYYY-MM-DD format.'),
  durationSeconds: z.coerce.number().int().min(60, 'Duration must be at least 60 seconds.'),
  type: z.enum(['manual', 'timer']),
});

const exportQuerySchema = z.object({
  search: z.string().trim().optional().default(''),
});

module.exports = {
  loginSchema,
  timeEntrySchema,
  exportQuerySchema,
  normalizeTags,
};

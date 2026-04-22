const { z } = require('zod');
const { normalizeName } = require('./catalog');

const loginSchema = z.object({
  emailOrUsername: z.string().trim().min(1, 'Email or username is required.'),
  password: z.string().min(1, 'Password is required.'),
});

const normalizeTags = (value) => {
  if (!Array.isArray(value)) {
    return [];
  }

  const normalized = [];
  const seen = new Set();

  for (const tag of value) {
    const name = String(tag || '').trim();
    const normalizedName = normalizeName(name);

    if (!normalizedName || seen.has(normalizedName)) {
      continue;
    }

    seen.add(normalizedName);
    normalized.push(name);
  }

  return normalized;
};

const isoDateTimeSchema = z
  .string()
  .datetime({ offset: true, message: 'Datetime must be a valid ISO 8601 string with timezone.' });

const uuidSchema = z.string().uuid('Please provide a valid id.');

const baseTimeEntrySchema = {
  name: z.string().trim().min(1, 'Name is required.'),
  projectId: uuidSchema,
  tags: z.array(z.string()).optional().default([]).transform(normalizeTags),
  type: z.enum(['manual', 'timer']),
};

const manualTimeEntrySchema = z
  .object({
    ...baseTimeEntrySchema,
    type: z.literal('manual'),
    startAt: isoDateTimeSchema,
    endAt: isoDateTimeSchema,
  })
  .superRefine((value, ctx) => {
    const startAt = Date.parse(value.startAt);
    const endAt = Date.parse(value.endAt);

    if (!Number.isFinite(startAt) || !Number.isFinite(endAt)) {
      return;
    }

    if (endAt <= startAt) {
      ctx.addIssue({
        code: 'custom',
        path: ['endAt'],
        message: 'End time must be after the start time.',
      });
    }

    if (endAt - startAt < 60_000) {
      ctx.addIssue({
        code: 'custom',
        path: ['endAt'],
        message: 'Duration must be at least 1 minute.',
      });
    }
  });

const timerStartSchema = z.object({
  name: z.string().trim().min(1, 'Name is required.'),
  projectId: uuidSchema,
  tags: z.array(z.string()).optional().default([]).transform(normalizeTags),
});

const timeEntryUpdateSchema = z
  .object({
    ...baseTimeEntrySchema,
    startAt: isoDateTimeSchema,
    endAt: isoDateTimeSchema.nullable(),
  })
  .superRefine((value, ctx) => {
    const startAt = Date.parse(value.startAt);
    const endAt = value.endAt ? Date.parse(value.endAt) : null;

    if (!Number.isFinite(startAt) || (value.endAt && !Number.isFinite(endAt))) {
      return;
    }

    if (endAt !== null) {
      if (endAt <= startAt) {
        ctx.addIssue({
          code: 'custom',
          path: ['endAt'],
          message: 'End time must be after the start time.',
        });
      }

      if (endAt - startAt < 60_000) {
        ctx.addIssue({
          code: 'custom',
          path: ['endAt'],
          message: 'Duration must be at least 1 minute.',
        });
      }
    }

    if (value.type === 'manual' && value.endAt === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['endAt'],
        message: 'Manual entries must include an end time.',
      });
    }
  });

const exportQuerySchema = z.object({
  search: z.string().trim().optional().default(''),
});

const catalogNameSchema = z
  .string()
  .trim()
  .min(1, 'Name is required.')
  .max(80, 'Name must be 80 characters or fewer.');

const createProjectSchema = z.object({
  name: catalogNameSchema,
});

const updateProjectSchema = z.object({
  name: catalogNameSchema,
});

const createTagSchema = z.object({
  name: catalogNameSchema,
});

const updateTagSchema = z.object({
  name: catalogNameSchema,
});

module.exports = {
  loginSchema,
  manualTimeEntrySchema,
  timerStartSchema,
  timeEntryUpdateSchema,
  exportQuerySchema,
  normalizeTags,
  createProjectSchema,
  updateProjectSchema,
  createTagSchema,
  updateTagSchema,
};

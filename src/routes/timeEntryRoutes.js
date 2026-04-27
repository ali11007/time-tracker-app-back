const express = require('express');
const { pool } = require('../db/pool');
const { createTimeEntryId } = require('../db/init');
const { authenticate } = require('../middleware/authenticate');
const { HttpError } = require('../utils/httpError');
const { buildCsv } = require('../utils/export');
const { mapTimeEntry } = require('../utils/serializers');
const {
  exportQuerySchema,
  manualTimeEntrySchema,
  timerStartSchema,
  timeEntryUpdateSchema,
} = require('../utils/validators');
const { ensureTagsExist, resolveProjectOrThrow } = require('../utils/catalog');

const router = express.Router();

router.use(authenticate);

const selectFields = `
  te.id,
  te.user_id,
  u.email AS user_email,
  u.username AS user_username,
  u.name AS user_name,
  te.name,
  te.project,
  te.project_id,
  p.name AS project_name,
  te.tags,
  te.start_at,
  te.end_at,
  te.type,
  te.created_at,
  te.updated_at
`;

const selectFromClause = `
  FROM time_entries te
  JOIN projects p ON p.id = te.project_id
  JOIN users u ON u.id = te.user_id
`;

const getEntryById = async (userId, entryId) => {
  const { rows } = await pool.query(
    `
      SELECT ${selectFields}
      ${selectFromClause}
      WHERE te.user_id = $1 AND te.id = $2
      LIMIT 1
    `,
    [userId, entryId],
  );

  return rows[0] || null;
};

const buildEntrySearchClause = (search, values, userId = null) => {
  const where = [];

  if (userId !== null) {
    values.push(userId);
    where.push(`te.user_id = $${values.length}`);
  }

  if (search) {
    values.push(`%${search.toLowerCase()}%`);
    const index = values.length;
    where.push(`(
      LOWER(te.name) LIKE $${index}
      OR LOWER(COALESCE(p.name, te.project)) LIKE $${index}
      OR LOWER(te.start_at::text) LIKE $${index}
      OR LOWER(COALESCE(te.end_at::text, '')) LIKE $${index}
      OR LOWER(u.email) LIKE $${index}
      OR LOWER(u.username) LIKE $${index}
      OR LOWER(u.name) LIKE $${index}
      OR EXISTS (
        SELECT 1
        FROM jsonb_array_elements_text(te.tags) AS tag
        WHERE LOWER(tag) LIKE $${index}
      )
    )`);
  }

  return where.length ? where.join(' AND ') : 'TRUE';
};

const insertManualEntry = async (userId, payload, { canCreateTags = false } = {}) => {
  const project = await resolveProjectOrThrow(payload.projectId);
  const tags = await ensureTagsExist(payload.tags, { canCreate: canCreateTags });
  const entryId = createTimeEntryId();

  await pool.query(
    `
      INSERT INTO time_entries (id, user_id, name, project, project_id, tags, start_at, end_at, type)
      VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9)
    `,
    [
      entryId,
      userId,
      payload.name,
      project.name,
      project.id,
      JSON.stringify(tags),
      payload.startAt,
      payload.endAt,
      payload.type,
    ],
  );

  return getEntryById(userId, entryId);
};

router.get('/', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `
        SELECT ${selectFields}
        ${selectFromClause}
        WHERE te.user_id = $1
        ORDER BY te.start_at DESC, te.created_at DESC
      `,
      [req.auth.userId],
    );

    res.json(rows.map(mapTimeEntry));
  } catch (error) {
    next(error);
  }
});

router.post('/manual', async (req, res, next) => {
  try {
    const entry = manualTimeEntrySchema.parse(req.body);
    const row = await insertManualEntry(req.auth.userId, entry, { canCreateTags: req.auth.isAdmin });
    res.status(201).json(mapTimeEntry(row));
  } catch (error) {
    next(error);
  }
});

router.post('/timer/start', async (req, res, next) => {
  try {
    const entry = timerStartSchema.parse(req.body);
    const project = await resolveProjectOrThrow(entry.projectId);
    const tags = await ensureTagsExist(entry.tags, { canCreate: req.auth.isAdmin });

    const activeEntry = await pool.query(
      'SELECT id FROM time_entries WHERE user_id = $1 AND end_at IS NULL LIMIT 1',
      [req.auth.userId],
    );

    if (activeEntry.rowCount) {
      throw new HttpError(409, 'You already have an active timer. Stop it before starting another one.');
    }

    const entryId = createTimeEntryId();

    await pool.query(
      `
        INSERT INTO time_entries (id, user_id, name, project, project_id, tags, start_at, end_at, type)
        VALUES ($1, $2, $3, $4, $5, $6::jsonb, NOW(), NULL, 'timer')
      `,
      [entryId, req.auth.userId, entry.name, project.name, project.id, JSON.stringify(tags)],
    );

    const createdEntry = await getEntryById(req.auth.userId, entryId);
    res.status(201).json(mapTimeEntry(createdEntry));
  } catch (error) {
    next(error);
  }
});

router.post('/:id/stop', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `
        UPDATE time_entries
        SET end_at = NOW(), updated_at = NOW()
        WHERE id = $1 AND user_id = $2 AND end_at IS NULL
        RETURNING id
      `,
      [req.params.id, req.auth.userId],
    );

    if (!rows[0]) {
      throw new HttpError(404, 'Active time entry not found.');
    }

    const entry = mapTimeEntry(await getEntryById(req.auth.userId, rows[0].id));

    if (entry.durationSeconds < 60) {
      await pool.query('DELETE FROM time_entries WHERE id = $1 AND user_id = $2', [req.params.id, req.auth.userId]);
      throw new HttpError(400, 'Timer entries must run for at least 1 minute before they can be saved.');
    }

    res.json(entry);
  } catch (error) {
    next(error);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const entry = manualTimeEntrySchema.parse(req.body);
    const row = await insertManualEntry(req.auth.userId, entry, { canCreateTags: req.auth.isAdmin });
    res.status(201).json(mapTimeEntry(row));
  } catch (error) {
    next(error);
  }
});

router.put('/:id', async (req, res, next) => {
  try {
    const entry = timeEntryUpdateSchema.parse(req.body);
    const project = await resolveProjectOrThrow(entry.projectId);
    const tags = await ensureTagsExist(entry.tags, { canCreate: req.auth.isAdmin });
    const { rows } = await pool.query(
      `
        UPDATE time_entries
        SET
          name = $3,
          project = $4,
          project_id = $5,
          tags = $6::jsonb,
          start_at = $7,
          end_at = $8,
          type = $9,
          updated_at = NOW()
        WHERE id = $1 AND user_id = $2
        RETURNING id
      `,
      [
        req.params.id,
        req.auth.userId,
        entry.name,
        project.name,
        project.id,
        JSON.stringify(tags),
        entry.startAt,
        entry.endAt,
        entry.type,
      ],
    );

    if (!rows[0]) {
      throw new HttpError(404, 'Time entry not found.');
    }

    res.json(mapTimeEntry(await getEntryById(req.auth.userId, rows[0].id)));
  } catch (error) {
    next(error);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const { rowCount } = await pool.query(
      'DELETE FROM time_entries WHERE id = $1 AND user_id = $2',
      [req.params.id, req.auth.userId],
    );

    if (!rowCount) {
      throw new HttpError(404, 'Time entry not found.');
    }

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

router.get('/export/json', async (req, res, next) => {
  try {
    const { search } = exportQuerySchema.parse(req.query);
    const values = [];
    const whereClause = buildEntrySearchClause(search, values, req.auth.isAdmin ? null : req.auth.userId);
    const { rows } = await pool.query(
      `
        SELECT ${req.auth.isAdmin ? 'TRUE AS include_user,' : ''} ${selectFields}
        ${selectFromClause}
        WHERE ${whereClause}
        ORDER BY te.start_at DESC, te.created_at DESC
      `,
      values,
    );

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="time-entries.json"');
    res.send(JSON.stringify(rows.map(mapTimeEntry), null, 2));
  } catch (error) {
    next(error);
  }
});

router.get('/export/csv', async (req, res, next) => {
  try {
    const { search } = exportQuerySchema.parse(req.query);
    const values = [];
    const whereClause = buildEntrySearchClause(search, values, req.auth.isAdmin ? null : req.auth.userId);
    const { rows } = await pool.query(
      `
        SELECT ${req.auth.isAdmin ? 'TRUE AS include_user,' : ''} ${selectFields}
        ${selectFromClause}
        WHERE ${whereClause}
        ORDER BY te.start_at DESC, te.created_at DESC
      `,
      values,
    );

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="time-entries.csv"');
    res.send(buildCsv(rows.map(mapTimeEntry), { includeUsers: req.auth.isAdmin }));
  } catch (error) {
    next(error);
  }
});

module.exports = {
  timeEntryRoutes: router,
};

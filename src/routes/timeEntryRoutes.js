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

const router = express.Router();

router.use(authenticate);

const selectFields = `
  id,
  name,
  project,
  tags,
  start_at,
  end_at,
  type,
  created_at,
  updated_at
`;

const buildEntrySearchClause = (search, values, userId) => {
  const where = ['user_id = $1'];
  values.push(userId);

  if (search) {
    values.push(`%${search.toLowerCase()}%`);
    const index = values.length;
    where.push(`(
      LOWER(name) LIKE $${index}
      OR LOWER(project) LIKE $${index}
      OR LOWER(start_at::text) LIKE $${index}
      OR LOWER(COALESCE(end_at::text, '')) LIKE $${index}
      OR EXISTS (
        SELECT 1
        FROM jsonb_array_elements_text(tags) AS tag
        WHERE LOWER(tag) LIKE $${index}
      )
    )`);
  }

  return where.join(' AND ');
};

const insertManualEntry = async (userId, payload) => {
  const { rows } = await pool.query(
    `
      INSERT INTO time_entries (id, user_id, name, project, tags, start_at, end_at, type)
      VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8)
      RETURNING ${selectFields}
    `,
    [
      createTimeEntryId(),
      userId,
      payload.name,
      payload.project,
      JSON.stringify(payload.tags),
      payload.startAt,
      payload.endAt,
      payload.type,
    ],
  );

  return rows[0];
};

router.get('/', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `
        SELECT ${selectFields}
        FROM time_entries
        WHERE user_id = $1
        ORDER BY start_at DESC, created_at DESC
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
    const row = await insertManualEntry(req.auth.userId, entry);
    res.status(201).json(mapTimeEntry(row));
  } catch (error) {
    next(error);
  }
});

router.post('/timer/start', async (req, res, next) => {
  try {
    const entry = timerStartSchema.parse(req.body);

    const activeEntry = await pool.query(
      'SELECT id FROM time_entries WHERE user_id = $1 AND end_at IS NULL LIMIT 1',
      [req.auth.userId],
    );

    if (activeEntry.rowCount) {
      throw new HttpError(409, 'You already have an active timer. Stop it before starting another one.');
    }

    const { rows } = await pool.query(
      `
        INSERT INTO time_entries (id, user_id, name, project, tags, start_at, end_at, type)
        VALUES ($1, $2, $3, $4, $5::jsonb, NOW(), NULL, 'timer')
        RETURNING ${selectFields}
      `,
      [createTimeEntryId(), req.auth.userId, entry.name, entry.project, JSON.stringify(entry.tags)],
    );

    res.status(201).json(mapTimeEntry(rows[0]));
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
        RETURNING ${selectFields}
      `,
      [req.params.id, req.auth.userId],
    );

    if (!rows[0]) {
      throw new HttpError(404, 'Active time entry not found.');
    }

    const entry = mapTimeEntry(rows[0]);

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
    const row = await insertManualEntry(req.auth.userId, entry);
    res.status(201).json(mapTimeEntry(row));
  } catch (error) {
    next(error);
  }
});

router.put('/:id', async (req, res, next) => {
  try {
    const entry = timeEntryUpdateSchema.parse(req.body);
    const { rows } = await pool.query(
      `
        UPDATE time_entries
        SET
          name = $3,
          project = $4,
          tags = $5::jsonb,
          start_at = $6,
          end_at = $7,
          type = $8,
          updated_at = NOW()
        WHERE id = $1 AND user_id = $2
        RETURNING ${selectFields}
      `,
      [
        req.params.id,
        req.auth.userId,
        entry.name,
        entry.project,
        JSON.stringify(entry.tags),
        entry.startAt,
        entry.endAt,
        entry.type,
      ],
    );

    if (!rows[0]) {
      throw new HttpError(404, 'Time entry not found.');
    }

    res.json(mapTimeEntry(rows[0]));
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
    const whereClause = buildEntrySearchClause(search, values, req.auth.userId);
    const { rows } = await pool.query(
      `
        SELECT ${selectFields}
        FROM time_entries
        WHERE ${whereClause}
        ORDER BY start_at DESC, created_at DESC
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
    const whereClause = buildEntrySearchClause(search, values, req.auth.userId);
    const { rows } = await pool.query(
      `
        SELECT ${selectFields}
        FROM time_entries
        WHERE ${whereClause}
        ORDER BY start_at DESC, created_at DESC
      `,
      values,
    );

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="time-entries.csv"');
    res.send(buildCsv(rows.map(mapTimeEntry)));
  } catch (error) {
    next(error);
  }
});

module.exports = {
  timeEntryRoutes: router,
};

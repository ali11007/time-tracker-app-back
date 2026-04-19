const express = require('express');
const { pool } = require('../db/pool');
const { authenticate } = require('../middleware/authenticate');
const { HttpError } = require('../utils/httpError');
const { buildCsv } = require('../utils/export');
const { mapTimeEntry } = require('../utils/serializers');
const { exportQuerySchema, timeEntrySchema } = require('../utils/validators');

const router = express.Router();

router.use(authenticate);

const buildEntrySearchClause = (search, values, userId) => {
  const where = ['user_id = $1'];
  values.push(userId);

  if (search) {
    values.push(`%${search.toLowerCase()}%`);
    const index = values.length;
    where.push(`(
      LOWER(name) LIKE $${index}
      OR LOWER(project) LIKE $${index}
      OR LOWER(date::text) LIKE $${index}
      OR EXISTS (
        SELECT 1
        FROM jsonb_array_elements_text(tags) AS tag
        WHERE LOWER(tag) LIKE $${index}
      )
    )`);
  }

  return where.join(' AND ');
};

router.get('/', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `
        SELECT id, name, project, tags, date, duration_seconds, type, created_at, updated_at
        FROM time_entries
        WHERE user_id = $1
        ORDER BY date DESC, created_at DESC
      `,
      [req.auth.userId],
    );

    res.json(rows.map(mapTimeEntry));
  } catch (error) {
    next(error);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const entry = timeEntrySchema.parse(req.body);
    const { rows } = await pool.query(
      `
        INSERT INTO time_entries (user_id, name, project, tags, date, duration_seconds, type)
        VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7)
        RETURNING id, name, project, tags, date, duration_seconds, type, created_at, updated_at
      `,
      [
        req.auth.userId,
        entry.name,
        entry.project,
        JSON.stringify(entry.tags),
        entry.date,
        entry.durationSeconds,
        entry.type,
      ],
    );

    res.status(201).json(mapTimeEntry(rows[0]));
  } catch (error) {
    next(error);
  }
});

router.put('/:id', async (req, res, next) => {
  try {
    const entry = timeEntrySchema.parse(req.body);
    const { rows } = await pool.query(
      `
        UPDATE time_entries
        SET
          name = $3,
          project = $4,
          tags = $5::jsonb,
          date = $6,
          duration_seconds = $7,
          type = $8,
          updated_at = NOW()
        WHERE id = $1 AND user_id = $2
        RETURNING id, name, project, tags, date, duration_seconds, type, created_at, updated_at
      `,
      [
        req.params.id,
        req.auth.userId,
        entry.name,
        entry.project,
        JSON.stringify(entry.tags),
        entry.date,
        entry.durationSeconds,
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
        SELECT id, name, project, tags, date, duration_seconds, type, created_at, updated_at
        FROM time_entries
        WHERE ${whereClause}
        ORDER BY date DESC, created_at DESC
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
        SELECT id, name, project, tags, date, duration_seconds, type, created_at, updated_at
        FROM time_entries
        WHERE ${whereClause}
        ORDER BY date DESC, created_at DESC
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
